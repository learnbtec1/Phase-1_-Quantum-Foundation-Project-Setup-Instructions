#!/usr/bin/env python3
"""
Avatar kinematic WebSocket brain — strict JSON for Next.js GenerativeGestureManager.

Binds to AVATAR_BRAIN_HOST (default 0.0.0.0) and AVATAR_BRAIN_PORT (default 8000 for bare-metal;
docker-compose sets AVATAR_BRAIN_PORT=8001 inside the container and typically publishes host 8011→8001).
Connect from the host browser using the published host port (e.g. ws://127.0.0.1:8011), not the Docker service name.

⚠️  On the host, avoid running two processes on the same published port. FastAPI uses :8000 in this repo.

Dependencies: websockets (see backend/requirements.txt, e.g. websockets==16.0).
"""

from __future__ import annotations

import asyncio
import json
import logging
import os
import sys
from typing import Any, Mapping, TypedDict, cast

import websockets.exceptions
from websockets.exceptions import InvalidMessage


# ---------------------------------------------------------------------------
# Strict contract (mirrors frontend `GenerativeGestureManager` + `onGenerative`)
# ---------------------------------------------------------------------------


class BoneEuler(TypedDict):
    """Local YXZ components; must serialize as JSON numbers, not strings."""

    x: float
    y: float
    z: float


class KinematicCommand(TypedDict, total=False):
    bones: dict[str, BoneEuler]
    blend: float
    replaceAll: bool
    assumeEulerDegrees: bool


def _strict_float(name: str, value: object) -> float:
    """
    Coerce to IEEE float for JSON numbers. Rejects ambiguous types so we never emit
    string literals for x/y/z (frontend would coerce broken axes to 0 silently).
    """
    if isinstance(value, bool):
        raise TypeError(f"{name}: bool is not a numeric rotation component")
    if isinstance(value, (int, float)):
        if isinstance(value, float) and (value != value):  # NaN
            raise ValueError(f"{name}: NaN not allowed")
        return float(value)
    if isinstance(value, str):
        s = value.strip().replace(",", ".")
        return float(s)
    raise TypeError(f"{name}: expected int/float/str, got {type(value).__name__}")


def _normalize_bones(bones: Mapping[str, Any]) -> dict[str, BoneEuler]:
    out: dict[str, BoneEuler] = {}
    for bone_name, rot in bones.items():
        key = str(bone_name)
        if not isinstance(rot, Mapping):
            raise TypeError(f"bones[{key!r}] must be a mapping with x,y,z")
        r = cast(Mapping[str, Any], rot)
        out[key] = BoneEuler(
            x=_strict_float(f"bones[{key}].x", r.get("x", 0.0)),
            y=_strict_float(f"bones[{key}].y", r.get("y", 0.0)),
            z=_strict_float(f"bones[{key}].z", r.get("z", 0.0)),
        )
    return out


def build_kinematic_command(
    bones_dict: Mapping[str, Mapping[str, Any]],
    *,
    blend: float = 1.0,
    replace_all: bool = False,
    assume_euler_degrees: bool = False,
) -> KinematicCommand:
    """Build a payload dict; all floats are native Python float (JSON number)."""
    cmd: KinematicCommand = {
        "bones": _normalize_bones(bones_dict),
        "blend": _strict_float("blend", blend),
        "replaceAll": bool(replace_all),
        "assumeEulerDegrees": bool(assume_euler_degrees),
    }
    return cmd


def kinematic_command_to_json(cmd: KinematicCommand) -> str:
    """Serialize with strict JSON types (numbers/bools/objects only)."""
    return json.dumps(cmd, separators=(",", ":"), allow_nan=False)


async def send_avatar_command(
    websocket: Any,
    bones_dict: Mapping[str, Mapping[str, Any]],
    blend: float = 1.0,
    *,
    replace_all: bool = False,
    assume_euler_degrees: bool = False,
) -> None:
    """Package bones into KinematicCommand and send one text frame."""
    try:
        cmd = build_kinematic_command(
            bones_dict,
            blend=blend,
            replace_all=replace_all,
            assume_euler_degrees=assume_euler_degrees,
        )
        await websocket.send(kinematic_command_to_json(cmd))
    except (ValueError, TypeError) as exc:
        print(f"[avatar_brain] invalid outbound kinematic payload (skipped): {exc}", file=sys.stderr, flush=True)
        return


# PH8.1 — Emergency idle: only {"replaceAll": true, "bones": {}} (no rua, no sleep, no blend field).
_RESET_RELEASE_PAYLOAD = json.dumps({"replaceAll": True, "bones": {}}, separators=(",", ":"))


async def _run_connection_demo(websocket: Any) -> None:
    """On connect: clear all generative locks immediately; frontend idle/gravity stack takes over."""
    try:
        await websocket.send(_RESET_RELEASE_PAYLOAD)
    except websockets.exceptions.ConnectionClosed:
        raise
    except (ValueError, TypeError, OSError) as exc:
        print(f"[avatar_brain] reset-release send failed (continuing): {exc}", file=sys.stderr, flush=True)

    # Keep socket open; tolerate malformed inbound JSON without killing the server loop.
    try:
        async for message in websocket:
            if not isinstance(message, (str, bytes)):
                continue
            text = message.decode("utf-8", errors="replace") if isinstance(message, bytes) else message
            try:
                _ = json.loads(text)
            except json.JSONDecodeError as exc:
                print(f"[avatar_brain] malformed JSON from client, skip frame: {exc}", flush=True)
            except (ValueError, TypeError) as exc:
                print(f"[avatar_brain] invalid inbound data, skip frame: {exc}", file=sys.stderr, flush=True)
    except websockets.exceptions.ConnectionClosed:
        pass


async def _handler(websocket: Any) -> None:
    client = getattr(websocket, "remote_address", "?")
    print(f"[avatar_brain] client connected: {client}", flush=True)
    try:
        await _run_connection_demo(websocket)
    except websockets.exceptions.ConnectionClosed as exc:
        print(
            f"[avatar_brain] connection closed (code={exc.code} reason={exc.reason!r}): {client}",
            flush=True,
        )
    except Exception as exc:
        print(f"[avatar_brain] session error (server continues): {exc}", file=sys.stderr, flush=True)
    finally:
        print(f"[avatar_brain] session end: {client}", flush=True)


def _silence_websockets_handshake_noise() -> None:
    """Docker TCP healthchecks open the port without a WebSocket handshake — quiet benign library logs."""
    for name in (
        "websockets",
        "websockets.server",
        "websockets.asyncio.server",
        "websockets.asyncio",
        "websockets.protocol",
    ):
        logging.getLogger(name).setLevel(logging.ERROR)


def _install_asyncio_handshake_noise_filter() -> None:
    """Suppress InvalidMessage / EOFError from failed handshakes (e.g. raw socket probes); keep other errors visible."""

    loop = asyncio.get_running_loop()

    def _exception_handler(
        loop_ref: asyncio.AbstractEventLoop,
        context: dict[str, Any],
    ) -> None:
        exc = context.get("exception")
        if isinstance(exc, (EOFError, InvalidMessage)):
            return
        loop_ref.default_exception_handler(context)

    loop.set_exception_handler(_exception_handler)


async def main() -> None:
    import websockets

    _silence_websockets_handshake_noise()
    _install_asyncio_handshake_noise_filter()

    # 0.0.0.0 required in Docker so the port is reachable from the host via publish mapping.
    # Override with AVATAR_BRAIN_HOST / AVATAR_BRAIN_PORT (compose uses 8001 inside container; host port may differ).
    host = (os.environ.get("AVATAR_BRAIN_HOST") or "0.0.0.0").strip() or "0.0.0.0"
    port = int(os.environ.get("AVATAR_BRAIN_PORT", "8000"))
    print(
        f"[avatar_brain] listening on ws://{host}:{port} "
        f"(host browser: ws://127.0.0.1:{port} when published as {port}:{port})",
        flush=True,
    )
    print(
        "[avatar_brain] set NEXT_PUBLIC_GENERATIVE_GESTURE_WS to that ws:// URL "
        "(Docker Desktop: host port, not the container service name).",
        flush=True,
    )
    async with websockets.serve(_handler, host, port, ping_interval=20, ping_timeout=20):
        await asyncio.get_running_loop().create_future()


if __name__ == "__main__":
    try:
        asyncio.run(main())
    except KeyboardInterrupt:
        print("\n[avatar_brain] shutdown", flush=True)
