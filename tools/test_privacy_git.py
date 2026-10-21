"""Tests for bounded, data-silent local Git reads."""

from __future__ import annotations

import os
import shutil
import subprocess
import sys
import tempfile
import time
import unittest
from pathlib import Path
from unittest import mock

from tools import privacy_git


class PrivacyGitTests(unittest.TestCase):
    def setUp(self) -> None:
        if shutil.which("git") is None:
            self.skipTest("git unavailable")
        self.temporary = tempfile.TemporaryDirectory()
        self.root = Path(self.temporary.name)
        self._system_git("init", "--quiet")
        self._system_git("config", "user.name", "Synthetic Tester")
        self._system_git("config", "user.email", "synthetic@example.invalid")

    def tearDown(self) -> None:
        self.temporary.cleanup()

    def _system_git(self, *args: str) -> None:
        subprocess.run(
            [shutil.which("git"), *args],
            cwd=self.root,
            stdin=subprocess.DEVNULL,
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL,
            check=True,
        )

    def _commit(self, name: str, data: bytes) -> None:
        (self.root / name).write_bytes(data)
        self._system_git("add", "--", name)
        self._system_git("commit", "--quiet", "-m", "synthetic fixture")

    def test_reads_binary_blob_bytes_exactly(self) -> None:
        expected = b"\x00synthetic\xffblob\r\n"
        self._commit("sample.bin", expected)
        self.assertEqual(
            privacy_git.git(
                self.root, "show", "HEAD:sample.bin", max_output=1024, timeout=5
            ),
            expected,
        )
        head = privacy_git.git(
            self.root, "rev-parse", "HEAD", max_output=128, timeout=5
        ).strip()
        self.assertEqual(len(head), 40)
        self.assertIn(
            head,
            privacy_git.git(
                self.root,
                "for-each-ref",
                "--format=%(objectname)",
                max_output=1024,
                timeout=5,
            ).splitlines(),
        )
        self.assertIn(
            b"sample.bin",
            privacy_git.git(
                self.root, "ls-tree", "-r", "HEAD", max_output=1024, timeout=5
            ),
        )

    def test_nonzero_and_missing_git_use_static_failure(self) -> None:
        synthetic_secret = "synthetic-secret-revision"
        with self.assertRaises(privacy_git.GitReadError) as failure:
            privacy_git.git(
                self.root, "show", synthetic_secret, max_output=1024, timeout=5
            )
        self.assertEqual(failure.exception.code, "git_read_failed")
        self.assertEqual(str(failure.exception), "git_read_failed")
        self.assertNotIn(synthetic_secret, repr(failure.exception))

        with (
            mock.patch.dict(os.environ, {"PATH": ""}),
            self.assertRaises(privacy_git.GitReadError) as missing,
        ):
            privacy_git.git(self.root, "rev-list", "HEAD", max_output=1024, timeout=5)
        self.assertEqual(missing.exception.code, "git_read_failed")
        self.assertEqual(str(missing.exception), "git_read_failed")

    def test_output_limit_stops_the_owned_process(self) -> None:
        processes: list[subprocess.Popen[bytes]] = []
        original_popen = subprocess.Popen

        def start(*args, **kwargs):
            process = original_popen(*args, **kwargs)
            processes.append(process)
            return process

        command = [
            sys.executable,
            "-c",
            "import sys,time; sys.stdout.buffer.write(b'x'*1048576); sys.stdout.flush(); time.sleep(60)",
        ]
        with (
            mock.patch.object(privacy_git, "_git_command", return_value=command),
            mock.patch.object(privacy_git.subprocess, "Popen", side_effect=start),
            self.assertRaises(privacy_git.GitReadError) as failure,
        ):
            privacy_git.git(self.root, "show", "HEAD", max_output=1024, timeout=5)
        self.assertEqual(failure.exception.code, "git_output_limit_exceeded")
        self.assertEqual(str(failure.exception), "git_output_limit_exceeded")
        self.assertEqual(len(processes), 1)
        self.assertIsNotNone(processes[0].poll())

    def test_timeout_stops_the_owned_process(self) -> None:
        processes: list[subprocess.Popen[bytes]] = []
        original_popen = subprocess.Popen

        def start(*args, **kwargs):
            process = original_popen(*args, **kwargs)
            processes.append(process)
            return process

        command = [sys.executable, "-c", "import time; time.sleep(60)"]
        started = time.monotonic()
        with (
            mock.patch.object(privacy_git, "_git_command", return_value=command),
            mock.patch.object(privacy_git.subprocess, "Popen", side_effect=start),
            self.assertRaises(privacy_git.GitReadError) as failure,
        ):
            privacy_git.git(self.root, "show", "HEAD", max_output=1024, timeout=0.05)
        self.assertEqual(failure.exception.code, "git_timeout")
        self.assertEqual(str(failure.exception), "git_timeout")
        self.assertLess(time.monotonic() - started, 3)
        self.assertEqual(len(processes), 1)
        self.assertIsNotNone(processes[0].poll())

    def test_timeout_does_not_wait_for_descendant_holding_stdout(self) -> None:
        processes: list[subprocess.Popen[bytes]] = []
        original_popen = subprocess.Popen

        def start(*args, **kwargs):
            process = original_popen(*args, **kwargs)
            processes.append(process)
            return process

        child = "import time; time.sleep(2)"
        producer = (
            "import subprocess,sys,time; "
            f"subprocess.Popen([sys.executable,'-c',{child!r}]); "
            "time.sleep(20)"
        )
        command = [sys.executable, "-c", producer]
        started = time.monotonic()
        with (
            mock.patch.object(privacy_git, "_git_command", return_value=command),
            mock.patch.object(privacy_git.subprocess, "Popen", side_effect=start),
            self.assertRaises(privacy_git.GitReadError) as failure,
        ):
            privacy_git.git(self.root, "show", "HEAD", max_output=1024, timeout=0.05)
        elapsed = time.monotonic() - started
        self.assertEqual(failure.exception.code, "git_timeout")
        self.assertLess(elapsed, 1)
        self.assertEqual(len(processes), 1)
        self.assertIsNotNone(processes[0].poll())

    def test_rejects_mutating_or_unbounded_requests_before_spawn(self) -> None:
        for args in (
            ("fetch",),
            ("commit",),
            ("show", "HEAD", ""),
            ("show", "--output=synthetic-copy", "HEAD"),
            ("cat-file", "--filters", "HEAD:sample.bin"),
        ):
            with (
                self.subTest(args=args),
                mock.patch.object(privacy_git.subprocess, "Popen") as spawn,
            ):
                with self.assertRaises(privacy_git.GitReadError) as failure:
                    privacy_git.git(self.root, *args, max_output=1024, timeout=1)
                self.assertEqual(failure.exception.code, "git_read_failed")
                spawn.assert_not_called()


if __name__ == "__main__":
    unittest.main()
