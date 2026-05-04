# -*- coding: utf-8 -*-
"""
Locust scenario: POST /api/v1/tts-with-timing (multi-user capable).

Run (headless):
  locust -f scripts/locustfile.py --headless -u 20 -r 5 --run-time 1m --host http://localhost:8000

Env:
  LOAD_TEST_TOKENS     — comma-separated JWTs; each request picks one at random (realistic burst)
  TTS_LOAD_TEST_TOKEN  — single JWT if pool unset
  LOAD_TEST_HEADERS    — extra headers: ``Name:Val,Name2:Val2``
  LOCUST_WAIT_MIN / LOCUST_WAIT_MAX
  TTS_LOAD_TEST_TEXT
"""
from __future__ import annotations

import os
import random
import sys
from pathlib import Path

from locust import HttpUser, between, task

_SCRIPTS = Path(__file__).resolve().parent
if str(_SCRIPTS) not in sys.path:
    sys.path.insert(0, str(_SCRIPTS))

from load_test_tokens import parse_extra_headers, resolve_tokens

DEFAULT_TEXT = "اختبار نظام كوجني الصوتي"


def _wait_bounds() -> tuple[float, float]:
    lo = float(os.getenv("LOCUST_WAIT_MIN", "1"))
    hi = float(os.getenv("LOCUST_WAIT_MAX", "3"))
    lo = max(0.0, lo)
    hi = max(lo, hi)
    return lo, hi


_wmin, _wmax = _wait_bounds()


class TTSUser(HttpUser):
    """Hits TTS with a random JWT from the pool each request (when pool size > 1)."""

    wait_time = between(_wmin, _wmax)

    def on_start(self) -> None:
        self._tokens = resolve_tokens(tokens_csv=None, single_token=None)
        self._extra_headers = parse_extra_headers(None)
        self._body = {
            "text": os.getenv("TTS_LOAD_TEST_TEXT", DEFAULT_TEXT),
            "voice": "am_michael",
            "speed": 1.0,
            "emotion": "neutral",
            "with_timing": True,
            "format": "mp3",
        }

    @task
    def tts_with_timing(self) -> None:
        headers: dict[str, str] = {"Content-Type": "application/json", **self._extra_headers}
        if self._tokens:
            tok = random.choice(self._tokens)
            headers["Authorization"] = f"Bearer {tok}"
        self.client.post(
            "/api/v1/tts-with-timing",
            json=self._body,
            headers=headers,
            name="tts-with-timing",
            timeout=120,
        )
