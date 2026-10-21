"""Append-only encrypted journal with an independently persisted authenticated head."""

import os
from pathlib import Path

import portalocker

from .security import digest


def append(path, crypto, entry):
    target = Path(path)
    head_path = Path(path + ".head")
    with portalocker.Lock(path + ".lock", timeout=10):
        previous = (
            crypto.decrypt(head_path.read_text())
            if head_path.exists()
            else {"count": 0, "hash": "", "bytes": 0}
        )
        if (target.stat().st_size if target.exists() else 0) != previous["bytes"]:
            raise RuntimeError("journal_head_mismatch")
        line = crypto.encrypt({"index": previous["count"] + 1, "previous": previous["hash"], "entry": entry})
        encoded = (line + "\n").encode("ascii")
        with target.open("ab") as stream:
            stream.write(encoded)
            stream.flush()
            os.fsync(stream.fileno())
        new_head = crypto.encrypt(
            {"count": previous["count"] + 1, "hash": digest(line), "bytes": previous["bytes"] + len(encoded)}
        )
        temporary = Path(path + ".head.next")
        with temporary.open("w", encoding="ascii") as stream:
            stream.write(new_head)
            stream.flush()
            os.fsync(stream.fileno())
        os.replace(temporary, head_path)


def verified_entries(path, crypto):
    target, head_path = Path(path), Path(path + ".head")
    if not target.is_file() or not head_path.is_file():
        raise RuntimeError("restore_journal_required")
    head = crypto.decrypt(head_path.read_text())
    if target.stat().st_size != head["bytes"]:
        raise RuntimeError("journal_head_mismatch")
    previous, count = "", 0
    with target.open(encoding="ascii") as stream:
        for raw in stream:
            line = raw.rstrip("\n")
            envelope = crypto.decrypt(line)
            count += 1
            if envelope["index"] != count or envelope["previous"] != previous:
                raise RuntimeError("journal_chain_mismatch")
            previous = digest(line)
    if previous != head["hash"] or count != head["count"]:
        raise RuntimeError("journal_head_mismatch")
    # A second streaming pass applies only after the entire chain and head have been verified.
    with target.open(encoding="ascii") as stream:
        for raw in stream:
            yield crypto.decrypt(raw.rstrip("\n"))["entry"]
