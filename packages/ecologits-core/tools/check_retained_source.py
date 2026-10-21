"""Check the public source subset without the private full artifact or installed oracle."""
import json
from pathlib import Path
import sys

root = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(root / "oracle"))
from source_integrity import verify_retained_source

manifest = json.load(sys.stdin) if "--stdin" in sys.argv else None
verified = verify_retained_source(manifest=manifest)
print(f"Verified {len(verified['retained_files'])} retained files from {verified['original_file_count']} original files.")
