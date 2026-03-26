# -*- coding: utf-8 -*-
"""Append-only audit log for sensitive actions (Phase C)."""

from __future__ import annotations

import logging
import uuid
from typing import Any, Dict, Optional

from sqlalchemy.orm import Session

from app.models.db_models import AuditLog

logger = logging.getLogger(__name__)


def write_audit(
    db: Session,
    *,
    actor_id: Optional[uuid.UUID],
    action: str,
    resource: Optional[str] = None,
    ip_address: Optional[str] = None,
    request_id: Optional[str] = None,
    details: Optional[Dict[str, Any]] = None,
    commit: bool = True,
) -> None:
    try:
        db.add(
            AuditLog(
                id=uuid.uuid4(),
                actor_id=actor_id,
                action=action,
                resource=resource,
                ip_address=ip_address,
                request_id=request_id,
                details=details,
            )
        )
        if commit:
            db.commit()
        else:
            db.flush()
    except Exception as e:
        logger.debug("audit write skipped: %s", e)
        if commit:
            db.rollback()
