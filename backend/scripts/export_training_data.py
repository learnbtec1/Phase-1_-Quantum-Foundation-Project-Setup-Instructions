#!/usr/bin/env python3
"""Export training_data rows to JSONL for fine-tuning (run from repo root with PYTHONPATH=backend)."""
from __future__ import annotations

import json
import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from app.database import SessionLocal  # noqa: E402
from app.models.db_models import TrainingData  # noqa: E402


def main() -> None:
    db = SessionLocal()
    try:
        rows = db.query(TrainingData).order_by(TrainingData.created_at.desc()).limit(10_000).all()
        for r in rows:
            line = {
                "prompt": r.prompt,
                "response": r.response,
                "score": r.score,
                "meta": r.meta,
                "user_id": str(r.user_id) if r.user_id else None,
            }
            print(json.dumps(line, ensure_ascii=False))
    finally:
        db.close()


if __name__ == "__main__":
    main()
