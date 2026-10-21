"""Independent fixtures for distribution/source mismatch and unsafe archive rejection."""

import hashlib
import importlib.util
import json
import os
import shutil
import subprocess
import tempfile
import unittest
import zipfile
from pathlib import Path

from tools.browser_inputs import input_fingerprint, selected_files

SPEC = importlib.util.spec_from_file_location(
    "source_verifier", Path(__file__).with_name("verify-source-archive.py")
)
VERIFIER = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(VERIFIER)
PACKAGE_SPEC = importlib.util.spec_from_file_location(
    "browser_packager", Path(__file__).with_name("package-browser-artifacts.py")
)
PACKAGER = importlib.util.module_from_spec(PACKAGE_SPEC)
PACKAGE_SPEC.loader.exec_module(PACKAGER)


class SourceArtifactTests(unittest.TestCase):
    def test_source_scope_document_is_a_required_build_input(self):
        self.assertIn("BROWSER-SOURCE-README.md", PACKAGER.SOURCE_FILES)
        text = (PACKAGER.ROOT / "BROWSER-SOURCE-README.md").read_text(encoding="utf-8")
        self.assertIn("rebuild-only", text)
        self.assertIn("does not support running tests or root `pnpm check`", text)
        self.assertEqual(PACKAGER.ENGINES, ("ecologits",))
        self.assertEqual(PACKAGER.DEFAULT_ENGINE, "ecologits")
        self.assertEqual(len(PACKAGER.VARIANTS), 3)
        self.assertIn("config", PACKAGER.CONTRACT["source_roots"])
        self.assertIn("tools", PACKAGER.CONTRACT["source_roots"])
        for excluded in (".git", ".output", "cassettes", "images", "output", "private"):
            self.assertIn(excluded, PACKAGER.CONTRACT["excluded_parts"])
        for required in (
            "BROWSER-SOURCE-README.md",
            "SBOM.cdx.json",
            "THIRD-PARTY-INVENTORY.json",
            "apps/extension/entrypoints/file-relay.html",
            "apps/extension/lib/file-association-protocol.ts",
            "apps/extension/lib/counting-config.ts",
            "apps/extension/lib/dashboard/use-monthly-summary.ts",
            "apps/extension/lib/monthly-summary.ts",
            "apps/extension/lib/runtime-composition.ts",
            "apps/extension/lib/upload-observer.ts",
            "packages/file-text/src/index.ts",
            "packages/ecologits-core/data/catalog.json",
            "packages/ecologits-core/upstream/retained-source.json",
            "packages/ledger/src/indexeddb-repository.ts",
            "packages/ledger/src/memory-repository.ts",
            "packages/ledger/src/monthly-claim.ts",
            "packages/ledger/src/repository-contracts.ts",
            "packages/ledger/src/session-contracts.ts",
            "packages/tokenizers/src/runtime.ts",
            "config/estimation.build.json",
            "tools/refinement/build-variants.ts",
            "package.json",
        ):
            self.assertIn(required, PACKAGER.CONTRACT["required_source_entries"])

    def test_package_rejects_missing_or_modified_license_payload(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            with self.assertRaisesRegex(SystemExit, "missing its full license payload"):
                PACKAGER.validate_notices(root)
            self._write_notice_payload(root)
            PACKAGER.validate_notices(root)
            (root / "licenses/ecologits/NOTICE.md").write_text("truncated")
            with self.assertRaisesRegex(SystemExit, "hash mismatch"):
                PACKAGER.validate_notices(root)

    def test_inventory_requires_identical_paths_and_bytes(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            built = root / "build"
            built.mkdir()
            (built / "manifest.json").write_bytes(b'{"version":"1"}')
            (built / "background.js").write_bytes(b"original bytes")
            archive = root / "firefox.zip"
            with zipfile.ZipFile(archive, "w") as output:
                for file in built.iterdir():
                    output.writestr(file.name, file.read_bytes())
            expected = VERIFIER.archive_inventory(archive)
            self.assertTrue(
                VERIFIER.compare(expected, VERIFIER.directory_inventory(built))[
                    "matches"
                ]
            )
            (built / "background.js").write_bytes(b"modified bytes")
            (built / "extra.js").write_bytes(b"unexpected")
            (built / "manifest.json").unlink()
            mismatch = VERIFIER.compare(expected, VERIFIER.directory_inventory(built))
            self.assertEqual(
                mismatch,
                {
                    "matches": False,
                    "missing": ["manifest.json"],
                    "extra": ["extra.js"],
                    "changed": ["background.js"],
                },
            )

    def test_archive_paths_cannot_escape_extraction(self):
        for name in ("../outside", "/absolute", "C:/absolute", "folder\\outside"):
            with self.subTest(name=name), tempfile.TemporaryDirectory() as temporary:
                archive = Path(temporary) / "unsafe.zip"
                with zipfile.ZipFile(archive, "w") as output:
                    entry = zipfile.ZipInfo("placeholder")
                    entry.filename = name
                    output.writestr(entry, b"unsafe")
                with self.assertRaisesRegex(ValueError, "unsafe_archive_path"):
                    VERIFIER.archive_inventory(archive)

    def test_input_fingerprint_detects_relevant_changes_and_ignores_outputs(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            (root / "fixed.txt").write_text("fixed", encoding="utf-8")
            source = root / "source"
            source.mkdir()
            (source / "entry.ts").write_text("one", encoding="utf-8")
            contract = {
                "path_order": "utf8_bytes",
                "fixed_files": ["fixed.txt"],
                "source_roots": ["source"],
                "excluded_parts": [
                    ".git",
                    ".output",
                    "cassettes",
                    "dist",
                    "images",
                    "node_modules",
                    "output",
                    "private",
                ],
                "excluded_suffixes": [".log"],
            }
            first = input_fingerprint(root, contract)
            for excluded in contract["excluded_parts"]:
                directory = source / excluded
                directory.mkdir()
                (directory / "ignored.dat").write_text("ignored", encoding="utf-8")
            (source / ".env.local").write_text("SECRET=ignored", encoding="utf-8")
            (source / "ignored.log").write_text("ignored", encoding="utf-8")
            self.assertEqual(input_fingerprint(root, contract), first)
            (source / "entry.ts").write_text("two", encoding="utf-8")
            changed = input_fingerprint(root, contract)
            self.assertNotEqual(changed, first)
            (source / "added.ts").write_text("added", encoding="utf-8")
            added = input_fingerprint(root, contract)
            self.assertNotEqual(added, changed)
            (source / "added.ts").unlink()
            self.assertEqual(input_fingerprint(root, contract), changed)
            (source / "entry.ts").unlink()
            self.assertNotEqual(input_fingerprint(root, contract), changed)

    def test_input_fingerprint_rejects_included_symlinks(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            (root / "fixed.txt").write_text("fixed", encoding="utf-8")
            source = root / "source"
            source.mkdir()
            target = root / "outside.txt"
            target.write_text("outside", encoding="utf-8")
            try:
                (source / "linked.txt").symlink_to(target)
            except OSError as error:
                self.skipTest(f"symlinks unavailable: {error}")
            contract = {
                "path_order": "utf8_bytes",
                "fixed_files": ["fixed.txt"],
                "source_roots": ["source"],
                "excluded_parts": [],
                "excluded_suffixes": [],
            }
            with self.assertRaisesRegex(ValueError, "symlink"):
                input_fingerprint(root, contract)

    def test_javascript_and_python_input_fingerprints_match(self):
        node = shutil.which("node")
        if not node:
            self.skipTest("node unavailable")
        result = subprocess.run(
            [node, str(PACKAGER.ROOT / "tools/browser-inputs.mjs")],
            cwd=PACKAGER.ROOT,
            check=True,
            capture_output=True,
            encoding="utf-8",
            env=os.environ,
        )
        self.assertEqual(
            json.loads(result.stdout),
            input_fingerprint(PACKAGER.ROOT, PACKAGER.CONTRACT),
        )

    def test_javascript_and_python_use_utf8_byte_path_order(self):
        node = shutil.which("node")
        if not node:
            self.skipTest("node unavailable")
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            source = root / "source"
            source.mkdir()
            (root / "fixed.txt").write_text("fixed", encoding="utf-8")
            (source / "\ue000.ts").write_text("same", encoding="utf-8")
            (source / "\U00010000.ts").write_text("same", encoding="utf-8")
            contract = {
                "schema_version": "1.0.0",
                "path_order": "utf8_bytes",
                "fixed_files": ["fixed.txt"],
                "source_roots": ["source"],
                "excluded_parts": [],
                "excluded_suffixes": [],
            }
            contract_path = root / "contract.json"
            contract_path.write_text(json.dumps(contract), encoding="utf-8")
            module = (PACKAGER.ROOT / "tools/browser-inputs.mjs").as_uri()
            script = (
                "import {loadBrowserInputContract,browserInputFingerprint} from "
                f"{json.dumps(module)};"
                "const c=await loadBrowserInputContract(process.argv[2]);"
                "process.stdout.write(JSON.stringify(await browserInputFingerprint(process.argv[1],c)));"
            )
            result = subprocess.run(
                [
                    node,
                    "--input-type=module",
                    "--eval",
                    script,
                    str(root),
                    str(contract_path),
                ],
                check=True,
                capture_output=True,
                encoding="utf-8",
                env=os.environ,
            )
            expected_names = [name for _, name in selected_files(root, contract)]
            self.assertEqual(
                expected_names,
                ["fixed.txt", "source/\ue000.ts", "source/\U00010000.ts"],
            )
            self.assertEqual(
                json.loads(result.stdout), input_fingerprint(root, contract)
            )

    def test_verifier_uses_trusted_contract_and_invalidates_old_proof(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            source = root / "source"
            source.mkdir()
            configuration_directory = root / "config"
            configuration_directory.mkdir()
            (root / "fixed.txt").write_text("fixed", encoding="utf-8")
            (source / "entry.ts").write_text("current", encoding="utf-8")
            configuration_path = configuration_directory / "estimation.build.json"
            configuration_path.write_text(
                json.dumps(
                    {
                        "schema_version": "1.0.0",
                        "default_engine": "original",
                        "available_engines": ["original", "ecologits"],
                    }
                ),
                encoding="utf-8",
            )
            contract = {
                "schema_version": "1.0.0",
                "path_order": "utf8_bytes",
                "fixed_files": ["fixed.txt"],
                "source_roots": ["source"],
                "excluded_parts": [],
                "excluded_suffixes": [],
                "engines": ["original", "ecologits"],
                "targets": {"chrome": {}, "edge": {}, "firefox": {}},
            }
            packages = {
                "sources": {},
                **{
                    f"{browser}-{engine}": {
                        "bytes": 1,
                        "sha256": ("a" if engine == "original" else "b") * 64,
                        "build_variant": {
                            "configuration_sha256": (
                                "c" if engine == "original" else "d"
                            )
                            * 64
                        },
                    }
                    for browser in contract["targets"]
                    for engine in contract["engines"]
                },
            }
            manifest = {
                "schema_version": "2.0.0",
                "product": "ai-footprint-tracker",
                "build_status": "release_candidate",
                "packages": packages,
                "input_fingerprint": {
                    "algorithm": "sha256",
                    "files": 0,
                    "sha256": "0" * 64,
                },
            }
            with self.assertRaisesRegex(SystemExit, "trusted current input contract"):
                VERIFIER.validate_release_identity(manifest, root, contract)

            manifest["input_fingerprint"] = input_fingerprint(root, contract)
            manifest["default_selection"] = {
                "engine": "original",
                "source": "config/estimation.build.json",
                "source_sha256": hashlib.sha256(
                    configuration_path.read_bytes()
                ).hexdigest(),
                "effective_configuration_sha256": "c" * 64,
                "source_input_sha256": manifest["input_fingerprint"]["sha256"],
            }
            manifest["aliases"] = {
                browser: {
                    "bytes": packages[f"{browser}-original"]["bytes"],
                    "path": f"/downloads/ai-footprint-tracker-{browser}.zip",
                    "sha256": packages[f"{browser}-original"]["sha256"],
                    "variant_id": f"{browser}-original",
                }
                for browser in contract["targets"]
            }
            self.assertEqual(
                VERIFIER.validate_release_identity(manifest, root, contract),
                manifest["input_fingerprint"],
            )
            manifest["aliases"]["chrome"]["variant_id"] = "chrome-ecologits"
            with self.assertRaisesRegex(SystemExit, "compatibility aliases"):
                VERIFIER.validate_release_identity(manifest, root, contract)
            manifest["aliases"]["chrome"]["variant_id"] = "chrome-original"
            report = root / "source-verification.json"
            report.write_text('{"matches":true}', encoding="utf-8")
            original_root = VERIFIER.ROOT
            original_report = VERIFIER.REPORT_PATH
            try:
                VERIFIER.ROOT = root
                VERIFIER.REPORT_PATH = report
                with self.assertRaisesRegex(SystemExit, "package-browser-artifacts"):
                    VERIFIER.main()
            finally:
                VERIFIER.ROOT = original_root
                VERIFIER.REPORT_PATH = original_report
            self.assertFalse(report.exists())

    def test_package_manifest_requires_exact_relay_exposure(self):
        for browser in PACKAGER.TARGETS:
            with (
                self.subTest(browser=browser),
                tempfile.TemporaryDirectory() as temporary,
            ):
                folder = Path(temporary)
                self._write_valid_build(folder, browser)
                PACKAGER.validate_manifest(folder, browser, "ecologits")
                (folder / "file-relay.html").unlink()
                with self.assertRaisesRegex(SystemExit, "missing the private relay"):
                    PACKAGER.validate_manifest(folder, browser, "ecologits")
                (folder / "file-relay.html").write_text("relay", encoding="utf-8")
                manifest_path = folder / "manifest.json"
                manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
                manifest["web_accessible_resources"] = ["offscreen.html"]
                manifest_path.write_text(json.dumps(manifest), encoding="utf-8")
                with self.assertRaisesRegex(SystemExit, "resource exposure"):
                    PACKAGER.validate_manifest(folder, browser, "ecologits")

    def test_intermediate_build_cannot_be_packaged_as_a_release(self):
        with tempfile.TemporaryDirectory() as temporary:
            folder = Path(temporary)
            self._write_valid_build(folder, "chrome")
            variant_path = folder / "build-variant.json"
            variant = json.loads(variant_path.read_text(encoding="utf-8"))
            variant["build_status"] = "intermediate"
            variant_path.write_text(json.dumps(variant), encoding="utf-8")
            with self.assertRaisesRegex(SystemExit, "invalid or intermediate"):
                PACKAGER.validate_manifest(folder, "chrome", "ecologits")

    def test_all_browser_target_inventories_are_compared(self):
        contract = {
            "engines": ["ecologits"],
            "targets": {
                "chrome": {"folder": "chrome"},
                "edge": {"folder": "edge"},
                "firefox": {"folder": "firefox"},
            },
        }
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            paths = {}
            for browser, target in contract["targets"].items():
                for engine in contract["engines"]:
                    variant = f"{browser}-{engine}"
                    folder = (
                        root / "apps/extension/.output" / target["folder"]
                    )
                    folder.mkdir(parents=True)
                    (folder / "manifest.json").write_text(variant, encoding="utf-8")
                    archive = root / f"{variant}.zip"
                    with zipfile.ZipFile(archive, "w") as output:
                        output.writestr("manifest.json", variant)
                    paths[variant] = archive
            compared, matches = VERIFIER.compare_target_archives(paths, root, contract)
            self.assertTrue(matches)
            self.assertEqual(set(compared), set(paths))
            (root / "apps/extension/.output/edge/manifest.json").write_text(
                "changed", encoding="utf-8"
            )
            compared, matches = VERIFIER.compare_target_archives(paths, root, contract)
            self.assertFalse(matches)
            self.assertEqual(compared["edge-ecologits"]["changed"], ["manifest.json"])

    @staticmethod
    def _write_notice_payload(folder: Path):
        identity = json.loads(
            (PACKAGER.ROOT / "packages/ecologits-core/data/identity.json").read_text(
                encoding="utf-8"
            )
        )
        lock = json.loads(
            (PACKAGER.ROOT / "packages/ecologits-core/upstream/lock.json").read_text(
                encoding="utf-8"
            )
        )
        source_path = folder / "source/ecologits-source.zip"
        source_path.parent.mkdir(parents=True, exist_ok=True)
        required_source = {
            "ECOLOGITS-SOURCE-README.md",
            "packages/ecologits-core/LICENSE",
            "packages/ecologits-core/NOTICE.md",
            "packages/ecologits-core/CITATION.cff",
            "packages/ecologits-core/source-to-port-map.json",
            "packages/ecologits-core/data/catalog.json",
            "packages/ecologits-core/data/identity.json",
            "packages/ecologits-core/upstream/lock.json",
            "packages/ecologits-core/upstream/retained-source.json",
            "tools/ecologits/README.md",
        }
        with zipfile.ZipFile(source_path, "w") as output:
            for name in sorted(required_source):
                output.writestr(name, b"synthetic corresponding source")
        page = (
            '<a href="source/ecologits-source.zip">source</a> '
            f"MPL-2.0 {identity['catalog_sha256']} 10.21105/joss.07471"
        )
        (folder / "licenses.html").write_text(page, encoding="utf-8")
        paths = [
            "LICENSE",
            "THIRD-PARTY-NOTICES.md",
            "licenses.html",
            "licenses/ecologits/MPL-2.0.txt",
            "licenses/ecologits/NOTICE.md",
            "licenses/ecologits/CITATION.cff",
            "source/ecologits-source.zip",
        ]
        files = []
        for name in paths:
            path = folder / name
            path.parent.mkdir(parents=True, exist_ok=True)
            if not path.exists():
                path.write_bytes(b"Full synthetic permission notice")
            data = path.read_bytes()
            files.append(
                {
                    "path": name,
                    "bytes": len(data),
                    "sha256": hashlib.sha256(data).hexdigest(),
                }
            )
        source_data = source_path.read_bytes()
        page_data = (folder / "licenses.html").read_bytes()
        (folder / "licenses/inventory.json").write_text(
            json.dumps(
                {
                    "files": files,
                    "components": [
                        {
                            "name": "EcoLogits independent TypeScript port",
                            "license": "MPL-2.0",
                            "notices": [
                                "licenses/ecologits/MPL-2.0.txt",
                                "licenses/ecologits/NOTICE.md",
                                "licenses/ecologits/CITATION.cff",
                            ],
                        }
                    ],
                    "ecologits": {
                        "upstream_version": identity["upstream_version"],
                        "core_sha256": identity["core_sha256"],
                        "catalog_sha256": identity["catalog_sha256"],
                        "retained_source_manifest_sha256": lock[
                            "retained_source_manifest_sha256"
                        ],
                        "corresponding_source": {
                            "path": "source/ecologits-source.zip",
                            "bytes": len(source_data),
                            "sha256": hashlib.sha256(source_data).hexdigest(),
                        },
                        "license_page": {
                            "path": "licenses.html",
                            "bytes": len(page_data),
                            "sha256": hashlib.sha256(page_data).hexdigest(),
                        },
                    },
                }
            ),
            encoding="utf-8",
        )

    @classmethod
    def _write_valid_build(cls, folder: Path, browser: str, engine: str = "ecologits"):
        (folder / "file-relay.html").write_text("relay", encoding="utf-8")
        providers = PACKAGER.CONTRACT["provider_matches"]
        manifest = {
            "manifest_version": PACKAGER.CONTRACT["targets"][browser][
                "manifest_version"
            ],
            "name": "AI Footprint Tracker",
            "version": PACKAGER.VERSION,
        }
        if browser == "firefox":
            manifest["permissions"] = ["storage", "alarms", *providers]
            manifest["web_accessible_resources"] = PACKAGER.CONTRACT[
                "web_accessible_resources"
            ]
        else:
            manifest["permissions"] = ["storage", "alarms", "offscreen"]
            manifest["host_permissions"] = providers
            manifest["web_accessible_resources"] = [
                {
                    "resources": PACKAGER.CONTRACT["web_accessible_resources"],
                    "matches": providers,
                }
            ]
        (folder / "manifest.json").write_text(json.dumps(manifest), encoding="utf-8")
        (folder / "methodology.html").write_text("methodology", encoding="utf-8")
        (folder / "build-variant.json").write_text(
            json.dumps(
                {
                    "schema_version": PACKAGER.CONTRACT["variant_schema_version"],
                    "variant_id": f"{browser}-{engine}",
                    "build_status": "release_candidate",
                    "browser": browser,
                    "default_engine": engine,
                    "available_engines": list(PACKAGER.ENGINES),
                    "user_override_enabled": False,
                }
            ),
            encoding="utf-8",
        )
        cls._write_notice_payload(folder)


if __name__ == "__main__":
    unittest.main()
