# -*- coding: utf-8 -*-
"""Enterprise SSO — Azure AD / SAML2 placeholders (Phase C)."""

from __future__ import annotations

import logging
import os

from fastapi import APIRouter, HTTPException, status
from fastapi.responses import RedirectResponse

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/auth/saml", tags=["auth-saml"])


@router.get("/login")
async def saml_login() -> RedirectResponse:
    """Redirect to IdP — configure SAML_IDP_SSO_URL in production."""
    url = os.getenv("SAML_IDP_SSO_URL", "").strip()
    if not url:
        raise HTTPException(
            status_code=status.HTTP_501_NOT_IMPLEMENTED,
            detail="SAML not configured (set SAML_IDP_SSO_URL)",
        )
    return RedirectResponse(url, status_code=302)


@router.post("/acs")
async def saml_assertion_consumer() -> dict:
    """Assertion Consumer Service — integrate python3-saml or Azure AD in production."""
    raise HTTPException(
        status_code=status.HTTP_501_NOT_IMPLEMENTED,
        detail="SAML ACS not implemented — use Azure AD OIDC or add SAML library",
    )
