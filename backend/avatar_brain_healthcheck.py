#!/usr/bin/env python3
"""
Docker Compose healthcheck for avatar_brain.

Raw TCP connect+close (previous check) leaves the server reading an empty HTTP
request line and logs EOFError / InvalidMessage noise. A real WebSocket
handshake keeps logs clean and validates the service.
"""
from __future__ import annotations

import asyncio
import os
import sys

import websockets


async def _run() -> None:
    port = (os.environ.get("AVATAR_BRAIN_PORT") or "8001").strip() or "8001"
    uri = f"ws://127.0.0.1:{port}"
    async with websockets.connect(
        uri,
        open_timeout=4,
        close_timeout=2,
        ping_interval=None,
    ):
        pass


def main() -> int:
    try:
        asyncio.run(_run())
    except Exception as exc:  # noqa: BLE001 — healthcheck must exit non-zero on any failure
        print(f"[avatar_brain_healthcheck] {exc}", file=sys.stderr, flush=True)
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
