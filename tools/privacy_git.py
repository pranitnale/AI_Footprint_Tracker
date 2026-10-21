"""Bounded local Git reads for the repository privacy scanner."""

from __future__ import annotations

import math
import os
import shutil
import subprocess
import threading
import time
from pathlib import Path

DEFAULT_MAX_OUTPUT = 8 * 1024 * 1024
DEFAULT_TIMEOUT = 30.0
_ALLOWED_COMMANDS = frozenset(
    {"cat-file", "for-each-ref", "ls-files", "ls-tree", "rev-list", "rev-parse", "show"}
)
_ERROR_CODES = frozenset(
    {"git_output_limit_exceeded", "git_read_failed", "git_timeout"}
)
_FORBIDDEN_OPTIONS = frozenset({"--ext-diff", "--filters", "--output", "--textconv"})
_ENVIRONMENT_KEYS = frozenset(
    {
        "COMSPEC",
        "HOME",
        "HOMEDRIVE",
        "HOMEPATH",
        "LANG",
        "LOCALAPPDATA",
        "PATH",
        "PATHEXT",
        "SYSTEMDRIVE",
        "SYSTEMROOT",
        "TEMP",
        "TMP",
        "TMPDIR",
        "USERPROFILE",
        "WINDIR",
    }
)


class GitReadError(RuntimeError):
    """A static failure code that never includes repository or Git output data."""

    def __init__(self, code: str) -> None:
        self.code = code if code in _ERROR_CODES else "git_read_failed"
        super().__init__(self.code)


def _environment() -> dict[str, str]:
    environment = {
        key: value
        for key, value in os.environ.items()
        if key.upper() in _ENVIRONMENT_KEYS
    }
    environment.update(
        {
            "GIT_CONFIG_GLOBAL": os.devnull,
            "GIT_CONFIG_NOSYSTEM": "1",
            "GIT_OPTIONAL_LOCKS": "0",
            "GIT_PAGER": "cat",
            "GIT_TERMINAL_PROMPT": "0",
            "LC_ALL": "C",
        }
    )
    return environment


def _git_command(args: tuple[str, ...]) -> list[str]:
    executable = shutil.which("git", path=os.environ.get("PATH"))
    if executable is None:
        raise GitReadError("git_read_failed")
    return [
        executable,
        "--no-pager",
        "-c",
        "core.fsmonitor=false",
        "-c",
        "core.untrackedCache=false",
        *args,
    ]


def _stop(process: subprocess.Popen[bytes]) -> None:
    if process.poll() is None:
        try:
            process.kill()
        except OSError:
            pass
    try:
        process.wait(timeout=1)
    except (OSError, subprocess.TimeoutExpired):
        pass


def git(
    root: Path,
    *args: str,
    max_output: int = DEFAULT_MAX_OUTPUT,
    timeout: float = DEFAULT_TIMEOUT,
) -> bytes:
    """Run one allowed local Git read with bounded output and execution time."""

    if (
        not args
        or args[0] not in _ALLOWED_COMMANDS
        or len(args) > 64
        or any(
            not isinstance(value, str)
            or not value
            or len(value) > 4096
            or "\0" in value
            for value in args
        )
        or any(
            value in _FORBIDDEN_OPTIONS or value.startswith("--output=")
            for value in args[1:]
        )
        or isinstance(max_output, bool)
        or not isinstance(max_output, int)
        or max_output < 0
        or isinstance(timeout, bool)
        or not isinstance(timeout, (int, float))
        or not math.isfinite(timeout)
        or timeout <= 0
    ):
        raise GitReadError("git_read_failed")

    try:
        command = _git_command(args)
        process = subprocess.Popen(
            command,
            cwd=Path(root),
            env=_environment(),
            stdin=subprocess.DEVNULL,
            stdout=subprocess.PIPE,
            stderr=subprocess.DEVNULL,
            shell=False,
            bufsize=0,
        )
    except (OSError, ValueError):
        raise GitReadError("git_read_failed") from None

    if process.stdout is None:
        _stop(process)
        raise GitReadError("git_read_failed")

    output = bytearray()
    read_error = False
    output_exceeded = False

    def read_stdout() -> None:
        nonlocal read_error, output_exceeded
        try:
            while True:
                remaining = max_output + 1 - len(output)
                if remaining <= 0:
                    output_exceeded = True
                    _stop(process)
                    return
                chunk = process.stdout.read(min(64 * 1024, remaining))
                if not chunk:
                    return
                output.extend(chunk)
                if len(output) > max_output:
                    output_exceeded = True
                    _stop(process)
                    return
        except (OSError, ValueError):
            read_error = True
            _stop(process)
        finally:
            try:
                process.stdout.close()
            except OSError:
                pass

    reader = threading.Thread(
        target=read_stdout, name="privacy-git-stdout", daemon=True
    )
    deadline = time.monotonic() + float(timeout)
    reader.start()
    reader.join(max(0.0, deadline - time.monotonic()))
    if reader.is_alive():
        _stop(process)
        reader.join(timeout=0.1)
        if output_exceeded:
            raise GitReadError("git_output_limit_exceeded")
        if read_error:
            raise GitReadError("git_read_failed")
        raise GitReadError("git_timeout")

    try:
        remaining = max(0.0, deadline - time.monotonic())
        return_code = process.wait(timeout=remaining)
    except (OSError, subprocess.TimeoutExpired):
        _stop(process)
        raise GitReadError("git_timeout") from None

    if output_exceeded:
        raise GitReadError("git_output_limit_exceeded")
    if read_error or return_code != 0:
        raise GitReadError("git_read_failed")
    return bytes(output)
