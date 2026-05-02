# -*- coding: utf-8 -*-
from __future__ import annotations

from fastapi import APIRouter, Depends

from app.api.deps import get_current_user
from app.db.models import User
from app.services import usage_service

router = APIRouter(prefix="/usage", tags=["usage"])


@router.get("/me")
def get_my_usage(_user: User = Depends(get_current_user)) -> dict:
    return usage_service.get_usage_me_payload(_user)
