# -*- coding: utf-8 -*-
"""TTS routing errors — distinguish fatal (no further fallback) vs exhaustive failure."""
from __future__ import annotations


class FatalTTSError(Exception):
    """Do not try remaining providers; map to HTTP response."""

    def __init__(self, status_code: int, detail: str) -> None:
        self.status_code = int(status_code)
        self.detail = str(detail)
        super().__init__(detail)


class AllTTSProvidersFailedError(Exception):
    """Every provider in the chain raised or skipped."""

    def __init__(self, message: str, last_error: Exception | None = None) -> None:
        self.last_error = last_error
        super().__init__(message)
