# -*- coding: utf-8 -*-
from __future__ import annotations

import logging
from datetime import datetime
from typing import List

from fastapi import APIRouter, Depends, HTTPException, status
from fastapi.responses import FileResponse
from pydantic import BaseModel, Field

from app.api.deps import get_current_admin
from app.core.config import settings
from app.db.models import User
from app.services import backup_service
from app.services.backup_service import safe_backup_path

router = APIRouter(prefix="/admin", tags=["admin-backup"])
logger = logging.getLogger(__name__)


class BackupItemOut(BaseModel):
    name: str
    size_bytes: int
    modified_utc: datetime


class BackupListOut(BaseModel):
    backups: List[BackupItemOut]
    directory: str = Field(
        ...,
        description="Server backup directory path (BACKUP_DIR).",
    )


class ManualBackupOut(BaseModel):
    ok: bool = True
    filename: str


class RestoreIn(BaseModel):
    filename: str = Field(..., min_length=8, max_length=512)
    confirm: bool = Field(
        False,
        description="Must be true: restore replaces data in the target database (destructive).",
    )


@router.get("/backups", response_model=BackupListOut)
def list_backups(
    _admin: User = Depends(get_current_admin),
) -> BackupListOut:
    try:
        items = backup_service.list_backups()
    except RuntimeError as e:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail=str(e),
        ) from e
    return BackupListOut(
        backups=[
            BackupItemOut(
                name=b.name,
                size_bytes=b.size_bytes,
                modified_utc=b.modified_utc,
            )
            for b in items
        ],
        directory=settings.BACKUP_DIR,
    )


@router.post("/backup", response_model=ManualBackupOut)
def trigger_backup(_admin: User = Depends(get_current_admin)) -> ManualBackupOut:
    try:
        name = backup_service.run_manual_backup()
    except RuntimeError as e:
        msg = str(e)
        if "not found" in msg.lower() or "No such file" in msg or "spawning" in msg.lower():
            raise HTTPException(
                status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
                detail="pg_dump is unavailable or backup directory is not usable.",
            ) from e
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=msg,
        ) from e
    logger.warning(
        "admin manual backup: user_id=%s email=%s file=%s",
        _admin.id,
        _admin.email,
        name,
    )
    return ManualBackupOut(filename=name)


@router.post("/restore", status_code=status.HTTP_204_NO_CONTENT)
def trigger_restore(
    body: RestoreIn,
    _admin: User = Depends(get_current_admin),
) -> None:
    if not body.confirm:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Restore requires confirm: true (destructive).",
        )
    try:
        backup_service.run_restore(body.filename)
    except ValueError as e:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(e)) from e
    except RuntimeError as e:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=str(e),
        ) from e
    logger.warning(
        "admin database RESTORE: user_id=%s email=%s file=%s",
        _admin.id,
        _admin.email,
        body.filename,
    )


@router.get("/backups/download/{filename}")
def download_backup(
    filename: str,
    _admin: User = Depends(get_current_admin),
) -> FileResponse:
    try:
        path = safe_backup_path(filename)
    except ValueError as e:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(e)) from e
    if not path.is_file():
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Backup not found")
    logger.info(
        "admin backup download: user_id=%s email=%s file=%s",
        _admin.id,
        _admin.email,
        filename,
    )
    return FileResponse(
        path=path,
        filename=path.name,
        media_type="application/sql",
    )
