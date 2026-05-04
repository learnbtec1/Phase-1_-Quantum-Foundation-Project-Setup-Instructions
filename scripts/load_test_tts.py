#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Lightweight async load test for POST /api/v1/tts-with-timing using httpx.

Examples:
  python scripts/load_test_tts.py --concurrency 10 --requests 50
  LOAD_TEST_TOKENS=jwt1,jwt2,jwt3 python scripts/load_test_tts.py -c 20 -n 100

Multi-user: set LOAD_TEST_TOKENS (comma-separated) or --tokens a,b,c to rotate JWTs
per request (distributes per-user rate limits across identities).

Dev bypass: no token => one stub user; --respect-backend-ratelimit avoids 429 spam.
"""
from __future__ import annotations

import argparse
import asyncio
import json
import os
import sys
import time
from pathlib import Path
from typing import Any
from urllib.parse import urlparse, urlunparse

import httpx

_SCRIPTS = Path(__file__).resolve().parent
if str(_SCRIPTS) not in sys.path:
    sys.path.insert(0, str(_SCRIPTS))

from load_test_tokens import parse_extra_headers, resolve_tokens

DEFAULT_URL = "http://localhost:8000/api/v1/tts-with-timing"
DEFAULT_TEXT = "اختبار نظام كوجني الصوتي"


def _p95_ms(values: list[float]) -> float:
    if not values:
        return 0.0
    s = sorted(values)
    n = len(s)
    idx = min(n - 1, max(0, int(round(0.95 * (n - 1)))))
    return s[idx]


def _json_body(text: str) -> dict[str, Any]:
    return {
        "text": text,
        "voice": "am_michael",
        "speed": 1.0,
        "emotion": "neutral",
        "with_timing": True,
        "format": "mp3",
    }


def _observability_url(tts_url: str) -> str:
    u = urlparse(tts_url)
    path = "/api/v1/tts-observability"
    return urlunparse((u.scheme, u.netloc, path, "", "", ""))


async def _fetch_router_metrics(obs_url: str, bearer: str, timeout: float) -> dict[str, Any] | None:
    if not bearer:
        return None
    headers = {"Authorization": f"Bearer {bearer}"}
    try:
        async with httpx.AsyncClient(timeout=httpx.Timeout(timeout)) as client:
            r = await client.get(obs_url, headers=headers)
            if not r.is_success:
                return None
            return r.json()
    except httpx.HTTPError:
        return None


async def _run_batch(args: argparse.Namespace) -> int:
    tokens = resolve_tokens(tokens_csv=args.tokens, single_token=args.token)
    extra_h = parse_extra_headers(None)
    for h in args.header:
        if ":" in h:
            k, v = h.split(":", 1)
            extra_h[k.strip()] = v.strip()

    body = _json_body(args.text)
    timeout = httpx.Timeout(args.timeout)
    sem = asyncio.Semaphore(max(1, args.concurrency))
    min_gap = 0.34 if args.respect_backend_ratelimit else 0.0
    rate_state: dict[str, float] = {"next": 0.0}
    rate_lock = asyncio.Lock() if min_gap > 0 else None

    latencies_ok: list[float] = []
    successes = 0
    failures = 0
    status_counts: dict[int, int] = {}
    provider_counts: dict[str, int] = {}
    counter_lock = asyncio.Lock()

    n_tokens = len(tokens)

    async def one(i: int, client: httpx.AsyncClient) -> None:
        nonlocal successes, failures
        hdrs: dict[str, str] = {
            "Content-Type": "application/json; charset=utf-8",
            **extra_h,
        }
        if n_tokens:
            hdrs["Authorization"] = f"Bearer {tokens[i % n_tokens]}"

        async with sem:
            if rate_lock is not None and min_gap > 0:
                async with rate_lock:
                    now = time.perf_counter()
                    wait = max(0.0, rate_state["next"] - now)
                    if wait:
                        await asyncio.sleep(wait)
                    rate_state["next"] = time.perf_counter() + min_gap

            t0 = time.perf_counter()
            try:
                r = await client.post(args.url, json=body, headers=hdrs)
                elapsed_ms = (time.perf_counter() - t0) * 1000.0
                code = r.status_code
                async with counter_lock:
                    status_counts[code] = status_counts.get(code, 0) + 1
                if r.is_success:
                    async with counter_lock:
                        latencies_ok.append(elapsed_ms)
                        successes += 1
                    try:
                        data = r.json()
                        prov = data.get("provider") or data.get("provider_used")
                        if prov:
                            async with counter_lock:
                                provider_counts[str(prov)] = (
                                    provider_counts.get(str(prov), 0) + 1
                                )
                    except (json.JSONDecodeError, TypeError, ValueError):
                        pass
                else:
                    async with counter_lock:
                        failures += 1
                    if args.verbose and i == 0:
                        print(f"[warn] first non-success: {r.status_code} {r.text[:200]!r}")
            except httpx.RequestError as e:
                async with counter_lock:
                    failures += 1
                    status_counts[0] = status_counts.get(0, 0) + 1
                if args.verbose and i == 0:
                    print(f"[warn] first error: {e!r}")

    wall0 = time.perf_counter()
    async with httpx.AsyncClient(timeout=timeout) as client:
        tasks = [asyncio.create_task(one(i, client)) for i in range(args.requests)]
        await asyncio.gather(*tasks)
    wall_s = max(1e-9, time.perf_counter() - wall0)

    total = args.requests
    rps = total / wall_s
    rl = status_counts.get(429, 0)
    pct_ok = 100.0 * successes / total if total else 0.0
    pct_rl = 100.0 * rl / total if total else 0.0
    other_err = max(0, failures - rl)
    pct_other = 100.0 * other_err / total if total else 0.0

    print()
    print("=== TTS load test (httpx) ===")
    print(f"URL:           {args.url}")
    print(f"Identities:    {n_tokens if n_tokens else 0} JWT(s) (rotate per request)")

    print(f"Requests:      {total}")
    print(f"Concurrency:   {args.concurrency}")
    print(f"Wall time:     {wall_s:.3f} s")
    print(f"Effective RPS: {rps:.2f}")
    print(f"Successes:     {successes}")
    print(f"Failures:      {failures}")
    print(
        f"Outcome ratio: ok={pct_ok:.1f}%  rate_limited(429)={pct_rl:.1f}%  other={pct_other:.1f}%"
    )

    parts = [f"{k}={v}" for k, v in sorted(status_counts.items(), key=lambda x: x[0])]
    print(f"HTTP status:   {'  '.join(parts)}")

    if provider_counts:
        pstr = "  ".join(f"{k}={v}" for k, v in sorted(provider_counts.items()))
        print(f"Providers:     {pstr}  (from response JSON, this run only)")
    else:
        print("Providers:     - (no provider parsed from successful JSON bodies)")

    if latencies_ok:
        avg = sum(latencies_ok) / len(latencies_ok)
        print(f"Avg latency:   {avg:.1f} ms  (successful requests only)")
        print(f"p95 latency:   {_p95_ms(latencies_ok):.1f} ms")
        print(f"Max latency:   {max(latencies_ok):.1f} ms")
    else:
        print("Avg latency:   - (no successful responses)")
        print("p95 latency:   -")
        print("Max latency:   -")
    print("=============================")

    if args.fetch_router_metrics and tokens:
        obs = _observability_url(args.url)
        snap = await _fetch_router_metrics(obs, tokens[0], min(30.0, args.timeout))
        if snap:
            rm = snap.get("router_metrics") if isinstance(snap, dict) else None
            if rm:
                print()
                print("--- GET /api/v1/tts-observability (router_metrics snapshot) ---")
                print(json.dumps(rm, indent=2))
                print("--- (server-wide, may include traffic outside this run) ---")
        else:
            print("(Could not fetch router_metrics; check token and URL.)")
    print()

    if successes == 0:
        return 1
    if args.strict and failures > 0:
        return 1
    return 0


def main() -> None:
    p = argparse.ArgumentParser(description="Async TTS load test (httpx)")
    p.add_argument("--url", default=os.getenv("TTS_LOAD_TEST_URL", DEFAULT_URL), help="Full TTS endpoint URL")
    p.add_argument("--concurrency", "-c", type=int, default=10, help="Max concurrent in-flight requests")
    p.add_argument("--requests", "-n", type=int, default=50, help="Total requests to send")
    p.add_argument("--timeout", type=float, default=120.0, help="Per-request timeout (seconds)")
    p.add_argument("--text", default=DEFAULT_TEXT, help="TTS text body")
    p.add_argument("--token", default=None, help="Single Bearer (or TTS_LOAD_TEST_TOKEN)")
    p.add_argument(
        "--tokens",
        default=None,
        help="Comma-separated JWTs (or env LOAD_TEST_TOKENS); rotated: request i uses tokens[i %% N]",
    )
    p.add_argument(
        "--header",
        action="append",
        default=[],
        metavar="Name:Value",
        help="Extra header (repeatable). Env: LOAD_TEST_HEADERS=Name:Val,Name2:Val2",
    )
    p.add_argument(
        "--respect-backend-ratelimit",
        action="store_true",
        help="Space requests ~3/sec globally (dev bypass still = one stub user without JWTs)",
    )
    p.add_argument(
        "--fetch-router-metrics",
        action="store_true",
        help="After run, GET /api/v1/tts-observability with first JWT and print router_metrics JSON",
    )
    p.add_argument(
        "--strict",
        action="store_true",
        help="Exit with error if any request failed (default: exit 0 if at least one success)",
    )
    p.add_argument("-v", "--verbose", action="store_true")
    args = p.parse_args()
    if args.requests < 1 or args.concurrency < 1:
        print("Invalid --requests or --concurrency", file=sys.stderr)
        sys.exit(2)
    try:
        rc = asyncio.run(_run_batch(args))
    except KeyboardInterrupt:
        print("\nInterrupted.", file=sys.stderr)
        rc = 130
    sys.exit(rc)


if __name__ == "__main__":
    main()
