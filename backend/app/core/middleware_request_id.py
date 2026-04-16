# -*- coding: utf-8 -*-
"""Attach X-Request-ID to each HTTP request for log correlation."""

from __future__ import annotations

import logging
import uuid

from starlette.middleware.base import BaseHTTPMiddleware
from starlette.requests import Request
from starlette.responses import Response

logger = logging.getLogger(__name__)


class RequestIdMiddleware(BaseHTTPMiddleware):
    async def dispatch(self, request: Request, call_next) -> Response:
        # BaseHTTPMiddleware breaks WebSocket upgrade if it wraps non-HTTP ASGI scopes.
        if request.scope.get("type") != "http":
            return await call_next(request)
        rid = request.headers.get("X-Request-ID") or str(uuid.uuid4())
        request.state.request_id = rid
        response = await call_next(request)
        response.headers["X-Request-ID"] = rid
        return response
