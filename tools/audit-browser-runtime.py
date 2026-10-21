"""Audit the exact shipped browser runtime, including WXT helpers declared as dev dependencies."""

import json
from datetime import UTC, datetime

from browser_runtime import ROOT, audit, inventory

try:
    result = audit(inventory())
except Exception:
    result = {"status": "unverified", "reason": "browser_runtime_audit_failed"}
result["checked_at"] = datetime.now(UTC).isoformat()
destination = ROOT / "artifacts/browser-runtime-audit.json"
destination.parent.mkdir(parents=True, exist_ok=True)
destination.write_text(json.dumps(result, sort_keys=True, indent=2) + "\n", encoding="utf-8")
print(json.dumps(result, sort_keys=True, indent=2))
raise SystemExit(0 if result["status"] == "no_known_vulnerabilities" else 1)
