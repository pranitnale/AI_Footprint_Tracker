"""Bounded offline secret-pattern checks. No credential validity or binary-content certification."""

from __future__ import annotations

import argparse
import hashlib
import json
import re
import stat
import struct
import zlib
from collections import Counter
from pathlib import Path, PurePosixPath
from urllib.parse import unquote

try:
    from privacy_git import GitReadError
    from privacy_git import git as bounded_git
except ModuleNotFoundError:
    from tools.privacy_git import GitReadError
    from tools.privacy_git import git as bounded_git

EXCLUDED = {
    ".git",
    "node_modules",
    ".venv",
    ".test-runtime",
    ".wxt",
    ".output",
    "__pycache__",
    ".pytest_cache",
    ".ruff_cache",
    ".local-calibration-deps",
    "coverage",
    "dist",
}
BINARY = {
    ".png",
    ".jpg",
    ".jpeg",
    ".gif",
    ".webp",
    ".mp4",
    ".ico",
    ".pdf",
    ".woff",
    ".woff2",
    ".ttf",
    ".zip",
}
PRIVATE_KEY = re.compile(
    r"-----BEGIN (?:RSA |EC |OPENSSH |DSA |ENCRYPTED )?PRIVATE KEY-----"
)
PROVIDER_KEY = re.compile(
    r"(?<![A-Za-z0-9])(?:sk-(?:proj-|ant-api\d+-)?[A-Za-z0-9_-]{24,}|xkeysib-[A-Za-z0-9_-]{25,}|gh[pousr]_[A-Za-z0-9]{30,}|github_pat_[A-Za-z0-9_]{35,}|AKIA[A-Z0-9]{16})(?![A-Za-z0-9])"
)
JWT = r"eyJ[A-Za-z0-9_-]{12,}\.[A-Za-z0-9_-]{12,}\.[A-Za-z0-9_-]{12,}"
SIGNED_QUERY = re.compile(
    r"(?i)(?:\?|&|&amp;)(?:accessToken|access_token|token|jwt|auth)=(" + JWT + r")"
)
URL = re.compile(r"https?://[^\s\"<>]+", re.IGNORECASE)
# This exact identity is nonfunctional and limited to one dedicated scanner test file.
SYNTHETIC_KEY = "sk-" + "SYNTHETIC-PRIVACY-SCAN-FIXTURE-ONLY-000000000000"
ALLOWLIST = {
    (
        "tools/test_privacy_scan.py",
        "provider_credential_candidate",
        SYNTHETIC_KEY,
    ): "Dedicated nonfunctional scanner fixture; no other test path or key is exempt."
}


class ScanError(Exception):
    def __init__(self, code: str, path: str = ""):
        self.code, self.path = code, path


def decoded(value: str) -> str | None:
    for _ in range(8):
        if not re.search(r"%[0-9a-fA-F]{2}", value):
            return value
        value = unquote(value)
    return None if re.search(r"%[0-9a-fA-F]{2}", value) else value


def safe_path(value: str) -> str:
    value = decoded(value)
    if value is None:
        return "[redacted-encoded-path]"
    value = PROVIDER_KEY.sub("[redacted-credential]", value)
    value = re.sub(JWT, "[redacted-signed-token]", value)
    value = PRIVATE_KEY.sub("[redacted-key-marker]", value)
    value = re.sub(r"[?&#].*", "[redacted-path-suffix]", value)
    return value[:500]


def safe_name(name: str) -> bool:
    path = PurePosixPath(name)
    return (
        bool(name)
        and not path.is_absolute()
        and ".." not in path.parts
        and "\\" not in name
        and ":" not in name
        and "\x00" not in name
    )


def git(root: Path, *args: str, max_output: int = 8 * 1024 * 1024) -> bytes:
    try:
        return bounded_git(root, *args, max_output=max_output, timeout=30)
    except GitReadError as error:
        raise ScanError(error.code) from error


class Scanner:
    def __init__(
        self,
        *,
        max_items: int = 20000,
        max_file: int = 32 * 1024 * 1024,
        max_bytes: int = 256 * 1024 * 1024,
    ):
        self.max_items, self.max_file, self.max_bytes = max_items, max_file, max_bytes
        self.stats: Counter = Counter()
        self.findings: Counter = Counter()
        self.errors: Counter = Counter()

    def error(self, code: str, path: str = "") -> None:
        self.errors[(code, safe_path(path))] += 1

    def reserve(self, size: int, path: str) -> None:
        if (
            size < 0
            or size > self.max_file
            or self.stats["items"] >= self.max_items
            or self.stats["bytes"] + size > self.max_bytes
        ):
            raise ScanError("scan_limit_exceeded", path)
        self.stats["items"] += 1
        self.stats["bytes"] += size

    def content(self, data: bytes, path: str, identity: str | None = None) -> None:
        self.reserve(len(data), path)
        self._inspect(data, path, identity)

    def _inspect(self, data: bytes, path: str, identity: str | None = None) -> None:
        if Path(identity or path).suffix.lower() in BINARY:
            self.stats["binary_semantics_unchecked"] += 1
            return
        try:
            text = data.decode(
                "utf-16" if data[:2] in (b"\xff\xfe", b"\xfe\xff") else "utf-8-sig"
            )
        except UnicodeDecodeError as error:
            raise ScanError("text_decode_failed", path) from error
        self.stats["text_items"] += 1

        def candidates():
            for kind, pattern in (
                ("private_key_candidate", PRIVATE_KEY),
                ("provider_credential_candidate", PROVIDER_KEY),
            ):
                previous, line = 0, 1
                for match in pattern.finditer(text):
                    line += text.count("\n", previous, match.start())
                    previous = match.start()
                    yield kind, line, match.group()
            previous, line = 0, 1
            for url in URL.finditer(text):
                line += text.count("\n", previous, url.start())
                previous = url.start()
                # Decode locally; neither the URL nor its values enter reports.
                plain_url = decoded(url.group())
                if plain_url is None:
                    raise ScanError("url_encoding_limit_exceeded", path)
                for match in SIGNED_QUERY.finditer(plain_url):
                    yield "signed_url_capability_candidate", line, match.group(1)

        for kind, line, value in candidates():
            self.stats["candidate_occurrences"] += 1
            if self.stats["candidate_occurrences"] > 10000:
                raise ScanError("finding_limit_exceeded", path)
            if (identity or path, kind, value) in ALLOWLIST:
                self.stats["explicit_fixture_exemptions"] += 1
                continue
            self.findings[(kind, safe_path(path), line)] += 1

    def file(self, root: Path, name: str, *, deleted: bool = False) -> None:
        if not safe_name(name):
            raise ScanError("unsafe_source_path", name)
        if set(PurePosixPath(name).parts) & EXCLUDED:
            self.stats["excluded_cache_paths"] += 1
            return
        path = root
        try:
            for part in PurePosixPath(name).parts:
                path /= part
                if path.is_symlink() or (
                    hasattr(path, "is_junction") and path.is_junction()
                ):
                    raise ScanError("source_link_rejected", name)
            try:
                info = path.stat()
            except FileNotFoundError:
                # Git confirms this tracked path is absent from the working tree.
                # A recreated file still gets scanned; subsequent read errors still fail.
                if not deleted:
                    raise
                self.stats["deleted_tracked_paths"] += 1
                return
            if not stat.S_ISREG(info.st_mode):
                raise ScanError("source_not_regular", name)
            if info.st_size > self.max_file:
                raise ScanError("scan_limit_exceeded", name)
            with path.open("rb") as stream:
                data = stream.read(self.max_file + 1)
            if len(data) != info.st_size:
                raise ScanError("source_changed_during_read", name)
            self.content(data, name, name)
        except OSError as error:
            raise ScanError("source_read_failed", name) from error

    def current(self, root: Path) -> None:
        try:
            names = (
                git(
                    root, "ls-files", "--cached", "--others", "--exclude-standard", "-z"
                )
                .decode("utf8")
                .split("\0")
            )
            deleted = (
                git(root, "ls-files", "--deleted", "-z").decode("utf8").split("\0")
            )
        except UnicodeDecodeError as error:
            raise ScanError("source_listing_decode_failed") from error
        if len(names) > self.max_items + 1 or len(deleted) > self.max_items + 1:
            raise ScanError("source_listing_limit_exceeded")
        deleted_names = set(filter(None, deleted))
        for name in sorted(set(filter(None, names))):
            try:
                self.file(root, name, deleted=name in deleted_names)
            except ScanError as error:
                self.error(error.code, error.path)
                if error.code == "scan_limit_exceeded":
                    break

    def history(self, root: Path) -> None:
        revisions = git(root, "rev-list", "--all").splitlines()
        if len(revisions) > self.max_items:
            raise ScanError("history_limit_exceeded")
        seen = set()
        roots = set()
        for revision in revisions:
            commit = revision.decode("ascii")
            self.content(
                git(
                    root, "show", "-s", "--format=%B", commit, max_output=self.max_file
                ),
                "git:" + commit[:12] + ":commit-message",
            )
            roots.add(commit)
        # Reachable non-commit tree refs can preserve prior working-tree snapshots.
        references = git(root, "for-each-ref", "--format=%(objectname)").splitlines()
        if len(references) > self.max_items:
            raise ScanError("history_limit_exceeded")
        for reference in references:
            oid = (
                git(root, "rev-parse", reference.decode("ascii") + "^{}")
                .strip()
                .decode("ascii")
            )
            kind = git(root, "cat-file", "-t", oid).strip()
            if kind in (b"tree", b"commit"):
                roots.add(oid)
            elif kind == b"blob":
                size = int(git(root, "cat-file", "-s", oid))
                if (
                    size > min(self.max_file, self.max_bytes - self.stats["bytes"])
                    or self.stats["items"] >= self.max_items
                ):
                    raise ScanError("scan_limit_exceeded", "git:" + oid[:12])
                self.content(
                    git(root, "cat-file", "blob", oid, max_output=size),
                    "git:" + oid[:12] + ":unpathed-blob",
                )
        for tree in sorted(roots):
            for item in git(root, "ls-tree", "-rz", "--full-tree", tree).split(b"\0"):
                if not item:
                    continue
                metadata, raw_name = item.split(b"\t", 1)
                mode, kind, oid = metadata.decode("ascii").split()
                name = raw_name.decode("utf8")
                if kind != "blob" or (oid, name) in seen:
                    continue
                if len(seen) >= self.max_items:
                    raise ScanError("history_limit_exceeded")
                seen.add((oid, name))
                if not safe_name(name):
                    raise ScanError("unsafe_history_path", name)
                if set(PurePosixPath(name).parts) & EXCLUDED:
                    self.stats["excluded_history_cache_paths"] += 1
                    continue
                label = "git:" + oid[:12] + ":" + name
                if mode == "120000":
                    self.error("history_link_rejected", label)
                    continue
                size = int(git(root, "cat-file", "-s", oid))
                if size > self.max_file:
                    raise ScanError("scan_limit_exceeded", label)
                self.content(git(root, "cat-file", "blob", oid), label, name)
                self.stats["history_blobs"] += 1
        self.stats["history_revisions"] = len(revisions)

    def archive(self, path: Path, label: str) -> None:
        """Strict classic ZIP only; admit raw metadata before bounded decompression."""
        try:
            if (
                path.is_symlink()
                or not path.is_file()
                or path.stat().st_size > self.max_bytes
            ):
                raise ScanError("archive_file_invalid", label)
            with path.open("rb") as stream:
                entries, central_start = self._zip_directory(stream, label)
                local_end = 0
                for entry in entries:
                    name, raw_name, flags, method, crc, packed, size, offset = entry
                    if offset != local_end:
                        raise ScanError("archive_local_layout_invalid", label)
                    stream.seek(offset)
                    header = self._zip_read(stream, 30, label)
                    fields = struct.unpack("<4s5H3L2H", header)
                    if (
                        fields[0] != b"PK\x03\x04"
                        or fields[1] > 20
                        or (fields[2], fields[3], fields[6], fields[7], fields[8])
                        != (flags, method, crc, packed, size)
                        or fields[9] != len(raw_name)
                        or fields[10] != 0
                    ):
                        raise ScanError("archive_local_header_invalid", label)
                    if self._zip_read(stream, fields[9], label) != raw_name:
                        raise ScanError("archive_local_name_invalid", label)
                    local_end = stream.tell() + packed
                    if local_end > central_start:
                        raise ScanError("archive_member_overlap", label)
                    data = self._zip_data(stream, method, packed, size, crc, label)
                    if not name.endswith("/"):
                        self._inspect(data, label + ":" + name, name)
                if local_end != central_start:
                    raise ScanError("archive_unlisted_local_data", label)
        except (OSError, ValueError, struct.error, zlib.error) as error:
            raise ScanError("archive_read_failed", label) from error

    @staticmethod
    def _zip_read(stream, size: int, label: str) -> bytes:
        data = stream.read(size)
        if len(data) != size:
            raise ScanError("archive_truncated", label)
        return data

    def _zip_directory(self, stream, label: str):
        stream.seek(0, 2)
        length = stream.tell()
        if length > self.max_bytes:
            raise ScanError("archive_file_invalid", label)
        stream.seek(max(0, length - 65557))
        tail = stream.read(65557)
        end = tail.rfind(b"PK\x05\x06")
        if end < 0 or end + 22 > len(tail):
            raise ScanError("archive_eocd_missing", label)
        fields = struct.unpack("<4s4H2LH", tail[end : end + 22])
        (
            _,
            disk,
            central_disk,
            disk_count,
            declared_count,
            central_size,
            central_start,
            comment,
        ) = fields
        end_position = length - len(tail) + end
        if (
            disk
            or central_disk
            or disk_count != declared_count
            or declared_count == 65535
            or central_size == 0xFFFFFFFF
            or central_start == 0xFFFFFFFF
            or end + 22 + comment != len(tail)
            or central_start + central_size != end_position
        ):
            raise ScanError("archive_classic_zip_required", label)
        if (
            declared_count > self.max_items - self.stats["items"]
            or central_size > 8 * 1024 * 1024
        ):
            raise ScanError("archive_metadata_limit_exceeded", label)
        stream.seek(central_start)
        entries, seen = [], set()
        while stream.tell() < end_position:
            if self.stats["items"] >= self.max_items:
                # Item reservations below also count directories, before any payload allocation.
                raise ScanError("archive_metadata_limit_exceeded", label)
            if end_position - stream.tell() < 46:
                raise ScanError("archive_central_truncated", label)
            fields = struct.unpack("<4s6H3L5H2L", self._zip_read(stream, 46, label))
            (
                signature,
                _,
                version,
                flags,
                method,
                _,
                _,
                crc,
                packed,
                size,
                name_length,
                extra,
                comment_length,
                disk,
                _,
                attributes,
                offset,
            ) = fields
            if (
                signature != b"PK\x01\x02"
                or version > 20
                or flags & ~0x800
                or method not in (0, 8)
                or disk
                or extra
                or 0xFFFFFFFF in (packed, size, offset)
            ):
                raise ScanError("archive_classic_zip_required", label)
            if (
                not 0 < name_length <= 4096
                or comment_length > 4096
                or stream.tell() + name_length + comment_length > end_position
            ):
                raise ScanError("archive_metadata_limit_exceeded", label)
            raw_name = self._zip_read(stream, name_length, label)
            name = raw_name.decode("utf8" if flags & 0x800 else "cp437")
            self._zip_read(stream, comment_length, label)
            if not safe_name(name) or name in seen or stat.S_ISLNK(attributes >> 16):
                raise ScanError("unsafe_archive_member", label)
            if (
                (name.endswith("/") and size != 0)
                or packed > central_start
                or offset >= central_start
            ):
                raise ScanError("archive_member_size_invalid", label)
            self.reserve(size, label)
            seen.add(name)
            entries.append((name, raw_name, flags, method, crc, packed, size, offset))
        if len(entries) != declared_count or stream.tell() != end_position:
            raise ScanError("archive_entry_count_mismatch", label)
        return entries, central_start

    def _zip_data(
        self, stream, method: int, packed: int, size: int, expected_crc: int, label: str
    ) -> bytes:
        if method == 0 and packed != size:
            raise ScanError("archive_stored_size_mismatch", label)
        result = bytearray()
        decoder = zlib.decompressobj(-15) if method == 8 else None
        remaining, crc = packed, 0
        while remaining:
            chunk = self._zip_read(stream, min(65536, remaining), label)
            remaining -= len(chunk)
            while chunk:
                before = len(chunk)
                output = (
                    decoder.decompress(chunk, min(65536, size - len(result) + 1))
                    if decoder
                    else chunk
                )
                if len(result) + len(output) > size:
                    raise ScanError("archive_expanded_size_mismatch", label)
                crc = zlib.crc32(output, crc)
                result.extend(output)
                if decoder:
                    if decoder.unused_data:
                        raise ScanError("archive_deflate_trailing_data", label)
                    chunk = decoder.unconsumed_tail
                    if chunk and len(chunk) == before and not output:
                        raise ScanError("archive_deflate_stalled", label)
                else:
                    chunk = b""
        if (decoder and not decoder.eof) or len(result) != size or crc != expected_crc:
            raise ScanError("archive_payload_mismatch", label)
        return bytes(result)

    def packages(self, root: Path) -> None:
        manifest_path = root / "artifacts/browser/manifest.json"
        try:
            if manifest_path.is_symlink() or manifest_path.stat().st_size > 128 * 1024:
                raise ScanError("release_manifest_invalid")
            with manifest_path.open("rb") as stream:
                manifest_bytes = stream.read(128 * 1024 + 1)
            if len(manifest_bytes) > 128 * 1024:
                raise ScanError("release_manifest_invalid")
            manifest = json.loads(manifest_bytes)
            # Only EcoLogits builds are packaged since 175a110 (engines in
            # tools/refinement/build-variants.ts). Expecting Original packages too refused every
            # real manifest, so the package scan never ran.
            variants = {f"{browser}-ecologits" for browser in ("chrome", "edge", "firefox")}
            if (
                manifest.get("product") != "ai-footprint-tracker"
                or manifest.get("schema_version") != "2.0.0"
                or manifest.get("build_status") != "release_candidate"
                or set(manifest.get("packages", {})) != {"sources", *variants}
                or not re.fullmatch(r"\d+\.\d+\.\d+", manifest.get("version", ""))
            ):
                raise ScanError("release_manifest_invalid")
            for kind, item in manifest["packages"].items():
                if kind == "sources":
                    name = f"artifacts/browser/ai-footprint-tracker-{manifest['version']}-sources.zip"
                else:
                    browser, engine = kind.split("-", 1)
                    name = (
                        f"artifacts/browser/{browser}/{engine}/"
                        f"ai-footprint-tracker-{manifest['version']}-{kind}.zip"
                    )
                if item.get("archive") != name:
                    raise ScanError("release_archive_path_invalid", kind)
                path = root / name
                if path.is_symlink() or path.stat().st_size > self.max_bytes:
                    raise ScanError("archive_file_invalid", name)
                digest, length = hashlib.sha256(), 0
                with path.open("rb") as stream:
                    while chunk := stream.read(65536):
                        length += len(chunk)
                        if length > self.max_bytes:
                            raise ScanError("archive_file_invalid", name)
                        digest.update(chunk)
                if length != item.get("bytes") or digest.hexdigest() != item.get(
                    "sha256"
                ):
                    raise ScanError("release_archive_hash_mismatch", name)
                self.archive(path, "zip:" + kind)
        except (OSError, ValueError, TypeError, KeyError) as error:
            raise ScanError("release_manifest_read_failed") from error

    def result(self) -> dict:
        return {
            "status": "error"
            if self.errors
            else "findings"
            if self.findings
            else "no_high_confidence_candidates",
            "scope": "Offline pattern scan only; no external validity, binary semantic, legal or zero-risk certification. Local CLI session metadata is not classified as an account credential.",
            "statistics": dict(self.stats),
            "findings": [
                {"type": kind, "path": path, "line": line, "count": count}
                for (kind, path, line), count in sorted(self.findings.items())
            ],
            "errors": [
                {"type": kind, "path": path, "count": count}
                for (kind, path), count in sorted(self.errors.items())
            ],
        }


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--root", type=Path, default=Path(__file__).resolve().parents[1]
    )
    parser.add_argument(
        "--archives",
        action="store_true",
        help="Verify manifest hashes and scan exactly the current four release ZIPs.",
    )
    parser.add_argument(
        "--history",
        action="store_true",
        help="Also scan reachable Git blobs and commit messages; historical findings remain failures.",
    )
    args = parser.parse_args(argv)
    scanner = Scanner()
    try:
        scanner.current(args.root)
        if args.archives:
            scanner.packages(args.root)
        if args.history:
            scanner.history(args.root)
    except ScanError as error:
        scanner.error(error.code, error.path)
    # Unexpected failures must not expose exception messages or source content.
    except Exception:  # noqa: BLE001
        scanner.error("scan_failed")
    print(json.dumps(scanner.result(), ensure_ascii=True, sort_keys=True))
    return 2 if scanner.errors else 1 if scanner.findings else 0


if __name__ == "__main__":
    raise SystemExit(main())
