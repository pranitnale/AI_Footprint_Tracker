import re
from pathlib import Path

ROOT = Path(__file__).resolve().parents[3]


def test_server_image_copies_every_file_the_engine_reads():
    # The first live deployment (13 Oct 2026) lacked config/estimation.media.json, so every
    # administrator figure view failed with an IOError. Tests run from the checkout and never saw it.
    sources = []
    for line in (ROOT / "apps/server/Dockerfile").read_text().splitlines():
        if line.startswith("COPY ") and "--from" not in line:
            sources += [part.rstrip("/") for part in line.split()[1:-1]]
    read = re.findall(r'ROOT / "([^"]+)"', (ROOT / "apps/server/aift/engine_adapter.py").read_text())
    assert "config/estimation.media.json" in read
    for path in read:
        covered = any(path == source or path.startswith(source + "/") or source.startswith(path + "/") for source in sources)
        assert covered, f"apps/server/Dockerfile does not copy {path}"
    # _native_source_data reads the catalog and the retained upstream snapshots below the core root.
    for directory in ("packages/ecologits-core/data", "packages/ecologits-core/upstream"):
        assert directory in sources, f"apps/server/Dockerfile does not copy {directory}"
