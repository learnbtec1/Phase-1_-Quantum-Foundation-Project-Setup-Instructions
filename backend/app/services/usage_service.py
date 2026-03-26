# -*- coding: utf-8 -*-
"""Usage / cost logging (Phase C)."""

from __future__ import annotations

import logging
import os
import uuid
from typing import Any, Dict, Optional

logger = logging.getLogger(__name__)


def _cost_openai(tokens: int, model: str) -> float:
    # Rough defaults — override with env
    per_1k = float(os.getenv("OPENAI_COST_PER_1K_TOKENS", "0.005"))
    return (max(0, tokens) / 1000.0) * per_1k


def log_openai_usage(
    user_id: Optional[uuid.UUID],
    *,
    total_tokens: int,
    model: str,
    meta: Optional[Dict[str, Any]] = None,
) -> None:
    if not user_id:
        return
    try:
        from app.database import SessionLocal
        from app.models.db_models import UsageLog

        cost = _cost_openai(total_tokens, model)
        db = SessionLocal()
        try:
            db.add(
                UsageLog(
                    id=uuid.uuid4(),
                    user_id=user_id,
                    service="openai",
                    tokens_used=int(total_tokens),
                    cost=cost,
                    meta=dict(meta or {}, model=model),
                )
            )
            db.commit()
        except Exception:
            db.rollback()
            raise
        finally:
            db.close()
    except Exception as e:
        logger.debug("usage log openai skipped: %s", e)


def log_tts_usage(user_id: Optional[uuid.UUID], char_count: int) -> None:
    if not user_id or char_count <= 0:
        return
    try:
        from app.database import SessionLocal
        from app.models.db_models import UsageLog

        rate = float(os.getenv("AZURE_TTS_COST_PER_1K_CHARS", "0.015"))
        cost = (char_count / 1000.0) * rate
        db = SessionLocal()
        try:
            db.add(
                UsageLog(
                    id=uuid.uuid4(),
                    user_id=user_id,
                    service="azure_tts",
                    tokens_used=int(char_count),
                    cost=cost,
                    meta={"unit": "chars"},
                )
            )
            db.commit()
        except Exception:
            db.rollback()
            raise
        finally:
            db.close()
    except Exception as e:
        logger.debug("usage log tts skipped: %s", e)
