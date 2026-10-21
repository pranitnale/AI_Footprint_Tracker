"""Offline redaction, bounded I/O, archive and reachable-history checks."""

import contextlib
import io
import json
import struct
import subprocess
import tempfile
import tracemalloc
import unittest
import zipfile
import zlib
from pathlib import Path
from unittest.mock import patch

from privacy_scan import ALLOWLIST, SYNTHETIC_KEY, ScanError, Scanner, main, safe_path


def token():
    # Invented structural bytes, not a copied capability or account token.
    return "eyJ" + "A" * 20 + "." + "B" * 25 + "." + "C" * 25


def repo(root):
    subprocess.run(
        ["git", "init", "--quiet", str(root)], check=True, capture_output=True
    )


def commit(root):
    subprocess.run(
        ["git", "-C", str(root), "add", "."], check=True, capture_output=True
    )
    subprocess.run(
        [
            "git",
            "-C",
            str(root),
            "-c",
            "user.name=Synthetic fixture",
            "-c",
            "user.email=fixture@example.invalid",
            "commit",
            "--quiet",
            "-m",
            "Synthetic privacy fixture",
        ],
        check=True,
        capture_output=True,
    )


class PrivacyScanTests(unittest.TestCase):
    def test_signed_url_duplicate_query_findings_never_reveal_values_or_surrounding_content(
        self,
    ):
        scanner = Scanner()
        value = token()
        text = (
            "PRIVATE_CONTENT_MARKER https://publisher.example/news/articles/synthetic?accessToken="
            + value
        )
        scanner.content((text + " " + text).encode(), "research/synthetic.jsonl")
        output = json.dumps(scanner.result())
        self.assertEqual(
            scanner.result()["findings"],
            [
                {
                    "type": "signed_url_capability_candidate",
                    "path": "research/synthetic.jsonl",
                    "line": 1,
                    "count": 2,
                }
            ],
        )
        for private in (
            value,
            "PRIVATE_CONTENT_MARKER",
            "publisher.example",
            "accessToken",
        ):
            self.assertNotIn(private, output)

    def test_private_keys_and_provider_shapes_are_candidates_in_tests_too(self):
        values = [
            "-----BEGIN " + "PRIVATE KEY-----",
            "sk-" + "A" * 40,
            "xkeysib-" + "B" * 40,
            "ghp_" + "C" * 40,
        ]
        scanner = Scanner()
        scanner.content("\n".join(values).encode(), "tests/untrusted-fixture.py")
        self.assertEqual(sum(scanner.findings.values()), 4)
        output = json.dumps(scanner.result())
        for value in values:
            self.assertNotIn(value, output)

    def test_media_files_are_binary_not_failed_text(self):
        # The README demo video (docs/media/demo.mp4) is media like the GIF beside it.
        video = b"\x00\x00\x00\x18ftypmp42\xff\xfe\x80"
        scanner = Scanner()
        for name in ("docs/media/demo.mp4", "docs/media/demo.gif"):
            scanner.content(video, name)
        self.assertEqual(scanner.stats["binary_semantics_unchecked"], 2)
        self.assertEqual(scanner.stats["text_items"], 0)
        with self.assertRaises(ScanError):
            Scanner().content(video, "docs/media/demo.bin")

    def test_fixture_allowlist_is_exact_identity_path_and_type_with_reason(self):
        scanner = Scanner()
        scanner.content(SYNTHETIC_KEY.encode(), "tools/test_privacy_scan.py")
        self.assertFalse(scanner.findings)
        self.assertEqual(scanner.stats["explicit_fixture_exemptions"], 1)
        self.assertTrue(next(iter(ALLOWLIST.values())))
        scanner.content(SYNTHETIC_KEY.encode(), "tests/another.py")
        scanner.content((SYNTHETIC_KEY + "A").encode(), "tools/test_privacy_scan.py")
        self.assertEqual(sum(scanner.findings.values()), 2)
        safe = Scanner()
        safe.content(
            b'api_key="REPLACE_WITH_PROTECTED_ENVIRONMENT"\nsession_id="synthetic-session-only"',
            "settings.example",
        )
        self.assertFalse(safe.findings)

    def test_encoded_signed_query_and_token_in_filename_are_redacted(self):
        value = token()
        scanner = Scanner()
        encoded = "".join("%" + format(ord(char), "02x") for char in value)
        scanner.content(
            ("https://example.invalid/article?accessToken=" + encoded).encode(),
            value + ".txt",
        )
        output = json.dumps(scanner.result())
        self.assertNotIn(value, output)
        self.assertNotIn(encoded, output)
        self.assertEqual(sum(scanner.findings.values()), 1)

    def test_source_scope_tracks_untracked_files_excludes_cache_and_omits_deleted_tracked_file(
        self,
    ):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            repo(root)
            (root / "tracked.txt").write_text("safe")
            commit(root)
            (root / "new.txt").write_text("sk-" + "A" * 40)
            (root / ".test-runtime").mkdir()
            (root / ".test-runtime/private.txt").write_text("sk-" + "B" * 40)
            scanner = Scanner()
            scanner.current(root)
            self.assertEqual(sum(scanner.findings.values()), 1)
            self.assertGreater(scanner.stats["excluded_cache_paths"], 0)
            (root / "tracked.txt").unlink()
            scanner = Scanner()
            scanner.current(root)
            self.assertFalse(scanner.errors)
            self.assertEqual(scanner.stats["deleted_tracked_paths"], 1)
            self.assertEqual(sum(scanner.findings.values()), 1)

    def test_current_missing_paths_require_git_deletion_and_real_read_errors_still_fail(
        self,
    ):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            scanner = Scanner()
            with patch("privacy_scan.git", side_effect=[b"missing.txt\0", b""]):
                scanner.current(root)
            self.assertIn(("source_read_failed", "missing.txt"), scanner.errors)
            (root / "present.txt").write_text("safe")
            for failure in (PermissionError, FileNotFoundError):
                with (
                    self.subTest(failure=failure),
                    patch.object(Path, "open", side_effect=failure),
                ):
                    with self.assertRaises(ScanError) as raised:
                        Scanner().file(root, "present.txt", deleted=True)
                    self.assertEqual(raised.exception.code, "source_read_failed")
            with patch.object(Path, "stat", side_effect=PermissionError):
                with self.assertRaises(ScanError) as raised:
                    Scanner().file(root, "present.txt", deleted=True)
                self.assertEqual(raised.exception.code, "source_read_failed")

    def test_current_scans_recreated_deleted_path_and_history_still_scans_deleted_content(
        self,
    ):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            repo(root)
            (root / "tracked.txt").write_text("sk-" + "A" * 40)
            commit(root)
            scanner = Scanner()
            with patch(
                "privacy_scan.git", side_effect=[b"tracked.txt\0", b"tracked.txt\0"]
            ):
                scanner.current(root)
            self.assertEqual(sum(scanner.findings.values()), 1)
            self.assertEqual(scanner.stats["deleted_tracked_paths"], 0)
            (root / "tracked.txt").unlink()
            current = Scanner()
            current.current(root)
            self.assertFalse(current.errors or current.findings)
            history = Scanner()
            history.history(root)
            self.assertEqual(sum(history.findings.values()), 1)

    def test_history_retains_findings_after_working_copy_redaction(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            repo(root)
            (root / "research.txt").write_text(
                "https://publisher.example/article?accessToken=" + token()
            )
            commit(root)
            (root / "research.txt").write_text("https://publisher.example/article")
            current = Scanner()
            current.current(root)
            self.assertFalse(current.findings)
            history = Scanner()
            history.history(root)
            self.assertEqual(history.stats["history_revisions"], 1)
            self.assertEqual(sum(history.findings.values()), 1)
            with contextlib.redirect_stdout(io.StringIO()) as output:
                code = main(["--root", str(root), "--history"])
            self.assertEqual(code, 1)
            self.assertNotIn(token(), output.getvalue())

    def test_unsafe_duplicate_symlink_and_corrupt_zip_members_fail_closed(self):
        cases = [
            ("../outside", None),
            ("safe.txt", "duplicate"),
            ("safe.txt", "symlink"),
        ]
        with tempfile.TemporaryDirectory() as temporary:
            path = Path(temporary) / "archive.zip"
            for name, mode in cases:
                with self.subTest(mode=mode):
                    with zipfile.ZipFile(path, "w") as archive:
                        entry = zipfile.ZipInfo(name)
                        if mode == "symlink":
                            entry.external_attr = 0o120777 << 16
                        archive.writestr(entry, "safe")
                        if mode == "duplicate":
                            with __import__("warnings").catch_warnings():
                                __import__("warnings").simplefilter("ignore")
                                archive.writestr(name, "safe")
                    with self.assertRaises(ScanError):
                        Scanner().archive(path, "zip:synthetic")
            path.write_bytes(b"not a zip")
            with self.assertRaises(ScanError):
                Scanner().archive(path, "zip:synthetic")

    def test_limits_and_io_errors_are_nonzero_without_exception_messages(self):
        with self.assertRaises(ScanError):
            Scanner(max_file=2).content(b"long", "source.txt")
        scanner = Scanner(max_items=1)
        scanner.content(b"safe", "one.txt")
        with self.assertRaises(ScanError):
            scanner.content(b"safe", "two.txt")
        with (
            patch("privacy_scan.git", side_effect=ScanError("git_read_failed")),
            contextlib.redirect_stdout(io.StringIO()) as output,
        ):
            self.assertEqual(main([]), 2)
        self.assertEqual(
            json.loads(output.getvalue())["errors"][0]["type"], "git_read_failed"
        )
        with (
            patch.object(
                Scanner, "current", side_effect=RuntimeError("PRIVATE_ERROR_MARKER")
            ),
            contextlib.redirect_stdout(io.StringIO()) as output,
        ):
            self.assertEqual(main([]), 2)
        self.assertNotIn("PRIVATE_ERROR_MARKER", output.getvalue())

    def test_binary_semantics_are_explicitly_unverified_and_bad_text_fails(self):
        scanner = Scanner()
        scanner.content(b"\x89PNG\x00", "icon.png")
        self.assertEqual(scanner.stats["binary_semantics_unchecked"], 1)
        with self.assertRaises(ScanError):
            scanner.content(b"\xff", "config.txt")

    def test_exact_release_archive_hashes_and_member_detection(self):
        import hashlib

        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            folder = root / "artifacts/browser"
            folder.mkdir(parents=True)
            packages = {}
            # The packages tools/refinement/build-variants.ts builds: EcoLogits only.
            kinds = ["chrome-ecologits", "edge-ecologits", "firefox-ecologits", "sources"]
            for kind in kinds:
                if kind == "sources":
                    path = folder / "ai-footprint-tracker-0.1.0-sources.zip"
                else:
                    browser, engine = kind.split("-", 1)
                    path = (
                        folder
                        / browser
                        / engine
                        / f"ai-footprint-tracker-0.1.0-{kind}.zip"
                    )
                    path.parent.mkdir(parents=True, exist_ok=True)
                with zipfile.ZipFile(path, "w") as archive:
                    archive.writestr(
                        "code.js",
                        "sk-" + "A" * 40 if kind == "edge-ecologits" else "safe",
                    )
                data = path.read_bytes()
                packages[kind] = {
                    "archive": path.relative_to(root).as_posix(),
                    "bytes": len(data),
                    "sha256": hashlib.sha256(data).hexdigest(),
                }
            manifest = {
                "product": "ai-footprint-tracker",
                "schema_version": "2.0.0",
                "build_status": "release_candidate",
                "version": "0.1.0",
                "packages": packages,
            }
            path = folder / "manifest.json"
            path.write_text(json.dumps(manifest))
            scanner = Scanner()
            scanner.packages(root)
            self.assertEqual(sum(scanner.findings.values()), 1)
            self.assertEqual(
                next(iter(scanner.findings))[1], "zip:edge-ecologits:code.js"
            )
            packages["chrome-ecologits"]["sha256"] = "0" * 64
            path.write_text(json.dumps(manifest))
            with self.assertRaises(ScanError):
                Scanner().packages(root)
            chrome = packages["chrome-ecologits"]
            chrome["sha256"] = hashlib.sha256(
                (root / chrome["archive"]).read_bytes()
            ).hexdigest()
            chrome["archive"] = "../outside.zip"
            path.write_text(json.dumps(manifest))
            with self.assertRaises(ScanError):
                Scanner().packages(root)


class ReachableTreeTests(unittest.TestCase):
    def test_noncommit_reachable_tree_keeps_historical_finding_visible(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            repo(root)
            (root / "snapshot.txt").write_text("safe")
            commit(root)
            (root / "snapshot.txt").write_text("sk-" + "A" * 40)
            subprocess.run(
                ["git", "-C", str(root), "add", "."], check=True, capture_output=True
            )
            tree = (
                subprocess.check_output(["git", "-C", str(root), "write-tree"])
                .decode()
                .strip()
            )
            subprocess.run(
                [
                    "git",
                    "-C",
                    str(root),
                    "update-ref",
                    "refs/privacy-fixture/snapshot",
                    tree,
                ],
                check=True,
                capture_output=True,
            )
            (root / "snapshot.txt").write_text("safe")
            scanner = Scanner()
            scanner.history(root)
            self.assertEqual(sum(scanner.findings.values()), 1)
            self.assertEqual(scanner.stats["history_revisions"], 1)
            self.assertEqual(scanner.stats["history_blobs"], 2)


class BoundedArchiveTests(unittest.TestCase):
    def test_nested_encoded_paths_and_signed_url_values_never_escape_redaction(self):
        secret = "sk-" + "Z" * 40
        encoded = "".join(f"%{ord(char):02X}" for char in secret)
        for _ in range(1, 12):
            encoded = encoded.replace("%", "%25")
            report_path = safe_path(encoded + ".txt")
            self.assertNotIn(secret, report_path)
            self.assertNotIn("%", report_path)
        signed = token()
        encoded = "".join(f"%{ord(char):02X}" for char in signed)
        for _ in range(3):
            encoded = encoded.replace("%", "%25")
        scanner = Scanner()
        scanner.content(
            ("https://example.invalid/article?accessToken=" + encoded).encode(),
            "source.txt",
        )
        self.assertEqual(sum(scanner.findings.values()), 1)
        self.assertNotIn(signed, json.dumps(scanner.result()))
        for _ in range(8):
            encoded = encoded.replace("%", "%25")
        with self.assertRaisesRegex(ScanError, ""):
            Scanner().content(
                ("https://example.invalid/article?accessToken=" + encoded).encode(),
                "source.txt",
            )

    def test_directories_count_before_metadata_or_payload_admission(self):
        with tempfile.TemporaryDirectory() as temporary:
            path = Path(temporary) / "directories.zip"
            with zipfile.ZipFile(path, "w") as archive:
                for name in ("one/", "two/", "three/"):
                    archive.writestr(name, b"")
            scanner = Scanner(max_items=3)
            scanner.archive(path, "zip:synthetic")
            self.assertEqual(scanner.stats["items"], 3)
            with (
                self.assertRaises(ScanError),
                patch(
                    "zipfile.ZipFile",
                    side_effect=AssertionError("unbounded metadata constructor"),
                ),
            ):
                Scanner(max_items=1).archive(path, "zip:synthetic")
            data = bytearray(path.read_bytes())
            end = data.rfind(b"PK\x05\x06")
            struct.pack_into("<HH", data, end + 8, 1, 1)
            path.write_bytes(data)
            scanner = Scanner(max_items=1)
            with self.assertRaises(ScanError):
                scanner.archive(path, "zip:synthetic")
            self.assertEqual(scanner.stats["items"], 1)
            with self.assertRaises(ScanError):
                Scanner(max_items=4).archive(path, "zip:synthetic")

    def test_forged_prefix_size_and_crc_cannot_expand_past_admitted_size(self):
        with tempfile.TemporaryDirectory() as temporary:
            path = Path(temporary) / "forged.zip"
            with zipfile.ZipFile(path, "w", zipfile.ZIP_DEFLATED) as archive:
                archive.writestr("synthetic.txt", b"\0" * (1024 * 1024))
            data = bytearray(path.read_bytes())
            central, local = data.index(b"PK\x01\x02"), data.index(b"PK\x03\x04")
            for offset in (central + 16, local + 14):
                struct.pack_into("<I", data, offset, zlib.crc32(b"\0"))
            for offset in (central + 24, local + 22):
                struct.pack_into("<I", data, offset, 1)
            path.write_bytes(data)
            tracemalloc.start()
            try:
                with self.assertRaises(ScanError) as raised:
                    Scanner(max_file=1024, max_bytes=4096).archive(
                        path, "zip:synthetic"
                    )
                _, peak = tracemalloc.get_traced_memory()
            finally:
                tracemalloc.stop()
            self.assertEqual(raised.exception.code, "archive_expanded_size_mismatch")
            self.assertLess(peak, 512 * 1024)

    def test_oversize_metadata_member_and_unsupported_zip64_fail_explicitly(self):
        with tempfile.TemporaryDirectory() as temporary:
            path = Path(temporary) / "metadata.zip"
            with zipfile.ZipFile(path, "w") as archive:
                archive.writestr("x" * 4097, b"safe")
            with self.assertRaises(ScanError):
                Scanner().archive(path, "zip:synthetic")
            with zipfile.ZipFile(path, "w") as archive:
                archive.writestr("oversize.txt", b"x" * 2000)
            with self.assertRaises(ScanError):
                Scanner(max_file=1024).archive(path, "zip:synthetic")
            with (
                zipfile.ZipFile(path, "w") as archive,
                archive.open("zip64.txt", "w", force_zip64=True) as member,
            ):
                member.write(b"safe")
            with self.assertRaises(ScanError) as raised:
                Scanner().archive(path, "zip:synthetic")
            self.assertEqual(raised.exception.code, "archive_classic_zip_required")
            with zipfile.ZipFile(path, "w", zipfile.ZIP_BZIP2) as archive:
                archive.writestr("unsupported.txt", b"safe")
            with self.assertRaises(ScanError):
                Scanner().archive(path, "zip:synthetic")


class ScannerBoundaryIntegrationTests(unittest.TestCase):
    def test_large_directory_count_rejected_before_metadata_objects(self):
        with tempfile.TemporaryDirectory() as temporary:
            path = Path(temporary) / "directories.zip"
            with zipfile.ZipFile(path, "w") as archive:
                for number in range(1000):
                    archive.writestr(f"directory{number}/", b"")
            tracemalloc.start()
            try:
                with (
                    patch(
                        "zipfile.ZipFile",
                        side_effect=AssertionError("no metadata allocation"),
                    ),
                    self.assertRaises(ScanError),
                ):
                    Scanner(max_items=10).archive(path, "zip:synthetic")
                _, peak = tracemalloc.get_traced_memory()
            finally:
                tracemalloc.stop()
            self.assertLess(peak, 512 * 1024)

    def test_git_limit_errors_propagate_as_redacted_nonzero_scanner_reports(self):
        from privacy_scan import GitReadError

        for code in ("git_output_limit_exceeded", "git_timeout", "git_read_failed"):
            with (
                self.subTest(code=code),
                patch(
                    "privacy_scan.bounded_git", side_effect=GitReadError(code)
                ) as bounded,
                contextlib.redirect_stdout(io.StringIO()) as output,
            ):
                self.assertEqual(main([]), 2)
            report = json.loads(output.getvalue())
            self.assertEqual(report["errors"], [{"type": code, "path": "", "count": 1}])
            self.assertEqual(
                bounded.call_args.kwargs, {"max_output": 8 * 1024 * 1024, "timeout": 30}
            )


if __name__ == "__main__":
    unittest.main()
