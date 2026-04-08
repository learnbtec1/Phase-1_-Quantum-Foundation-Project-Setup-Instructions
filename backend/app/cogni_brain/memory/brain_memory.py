# -*- coding: utf-8 -*-
"""Append-only modification log + optional snapshot paths."""

from __future__ import annotations

import json
import shutil
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Dict, Optional


def _brain_root() -> Path:
    return Path(__file__).resolve().parent.parent


def _log_path() -> Path:
    return _brain_root() / "memory" / "modifications_log.json"


def log_modification(
    file_path: str,
    description: str,
    diff: str = "",
    snapshot_subdir: Optional[str] = None,
) -> Dict[str, Any]:
    """Append one entry to modifications_log.json."""
    p = _log_path()
    try:
        data = json.loads(p.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        data = {"entries": []}
    if not isinstance(data.get("entries"), list):
        data["entries"] = []
    entry_id = len(data["entries"]) + 1
    snap = ""
    if snapshot_subdir:
        snap = f"version_history/{snapshot_subdir}"
    entry: Dict[str, Any] = {
        "id": entry_id,
        "timestamp": datetime.now(timezone.utc).isoformat().replace("+00:00", "Z"),
        "type": "prompt_update",
        "file": file_path,
        "description": description,
        "diff": (diff or "")[:8000],
        "snapshot_file": snap,
        "revert_command": "python -m app.cogni_brain.scripts.revert --list",
    }
    data["entries"].append(entry)
    p.parent.mkdir(parents=True, exist_ok=True)
    p.write_text(json.dumps(data, ensure_ascii=False, indent=2), encoding="utf-8")
    return entry


def revert_to_snapshot(snapshot_id: str) -> bool:
    """
    Restore files from memory/version_history/<snapshot_id> if that folder exists.
    Returns True if any file was copied.
    """
    src = _brain_root() / "memory" / "version_history" / snapshot_id
    if not src.is_dir():
        return False
    dst_root = _brain_root()
    copied = False
    for f in src.rglob("*"):
        if f.is_file():
            rel = f.relative_to(src)
            out = dst_root / rel
            out.parent.mkdir(parents=True, exist_ok=True)
            shutil.copy2(f, out)
            copied = True
    return copied
