#!/usr/bin/env python3
"""CLI: list modification log or restore from a version_history snapshot id."""
from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path


def _root() -> Path:
    return Path(__file__).resolve().parent.parent


def _ensure_backend_on_path() -> Path:
    """scripts/ → cogni_brain → app → backend"""
    backend = Path(__file__).resolve().parent.parent.parent.parent
    s = str(backend)
    if s not in sys.path:
        sys.path.insert(0, s)
    return backend


def main() -> int:
    ap = argparse.ArgumentParser(description="Cogni brain revert helper")
    ap.add_argument("--list", action="store_true", help="Print modifications_log.json entries")
    ap.add_argument("--restore", metavar="SNAPSHOT_ID", help="Restore from memory/version_history/SNAPSHOT_ID")
    args = ap.parse_args()
    log = _root() / "memory" / "modifications_log.json"
    if args.list:
        try:
            data = json.loads(log.read_text(encoding="utf-8"))
            for e in data.get("entries", []):
                print(f"[{e.get('id')}] {e.get('timestamp')} — {e.get('description')} ({e.get('file')})")
        except OSError as exc:
            print("No log:", exc, file=sys.stderr)
            return 1
        return 0
    if args.restore:
        _ensure_backend_on_path()
        from app.cogni_brain.memory.brain_memory import revert_to_snapshot

        ok = revert_to_snapshot(args.restore)
        print("Restored:" if ok else "Snapshot not found or empty:", args.restore)
        return 0 if ok else 2
    ap.print_help()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
