#!/usr/bin/env python3
"""Read-only integrity check of the public firmware source export."""
from pathlib import Path
import hashlib
import json

ROOT = Path(__file__).resolve().parents[1]
manifest = json.loads((ROOT / "SOURCE-REVISION.json").read_text(encoding="utf-8"))
errors = []
for entry in manifest["exportedFiles"]:
    path = (ROOT / entry["path"]).resolve()
    if not path.is_relative_to(ROOT) or not path.is_file():
        errors.append(entry["path"] + ": missing or invalid path")
        continue
    data = path.read_bytes()
    if len(data) != entry["bytes"] or hashlib.sha256(data).hexdigest() != entry["sha256"]:
        errors.append(entry["path"] + ": content differs")
if errors:
    raise SystemExit("Source export check failed:\n" + "\n".join(errors))
print(f"Source export integrity: PASS ({len(manifest['exportedFiles'])} files; no firmware binary)")
