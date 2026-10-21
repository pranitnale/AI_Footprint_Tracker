"""Audit the frozen production Python dependency export with a pinned pip-audit."""

from __future__ import annotations

import shutil
import subprocess
import tempfile
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
SERVER = ROOT / "apps/server"
PIP_AUDIT_VERSION = "2.10.1"


def require(command: str) -> str:
    path = shutil.which(command)
    if not path:
        raise SystemExit(f"{command} is required for the dependency audit")
    return path


with tempfile.TemporaryDirectory(prefix="aift-audit-") as directory:
    requirements = Path(directory) / "requirements.txt"
    subprocess.run(
        [
            require("uv"),
            "export",
            "--project",
            str(SERVER),
            "--frozen",
            "--no-dev",
            "--no-emit-project",
            "--format",
            "requirements-txt",
            "--output-file",
            str(requirements),
        ],
        cwd=ROOT,
        check=True,
        stdout=subprocess.DEVNULL,
    )
    subprocess.run(
        [
            require("uvx"),
            "--from",
            f"pip-audit=={PIP_AUDIT_VERSION}",
            "pip-audit",
            "--requirement",
            str(requirements),
            "--strict",
            "--progress-spinner",
            "off",
        ],
        cwd=ROOT,
        check=True,
    )
