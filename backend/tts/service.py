# -*- coding: utf-8 -*-
"""
NEXUS Sovereign TTS Synthesizer — V110.1
=========================================
Azure-only, ar-JO-TaimNeural default.
Returns RIFF 24 kHz / 16-bit / mono PCM (WAV) bytes.

V110.1 additions over V110:
  • Synthesizer-per-voice pool → reuse across calls (lower cold-start latency).
  • audio_config=None → result.audio_data (cleaner; no PushAudioOutputStream BytesIO).
  • 10-second synthesis timeout + single retry with 400 ms backoff.
  • SSML support: text beginning with '<speak' or is_ssml=True → speak_ssml_async().
  • Structured JSON telemetry line per synthesis (event, voice, text_len, bytes,
    latency_ms, req_id, ts, ssml).
  • Rolling-window latency deque (last 20) exposed via avg_latency_ms() for /health/tts.
  • clear_pool() for credential rotation or testing.
"""
from __future__ import annotations

import logging
import threading
import time
import uuid
from collections import deque
from datetime import datetime, timezone
from typing import Deque

from .config import TTSConfig

log = logging.getLogger("tts.service")

# ── Rolling latency stats (last 20 requests) ─────────────────────────────────
_STATS_LOCK: threading.Lock = threading.Lock()
_LATENCY_DEQUE: Deque[float] = deque(maxlen=20)


def record_latency(ms: float) -> None:
    with _STATS_LOCK:
        _LATENCY_DEQUE.append(ms)


def avg_latency_ms() -> float | None:
    """Return average synthesis latency over the last ≤20 requests, or None if no data."""
    with _STATS_LOCK:
        if not _LATENCY_DEQUE:
            return None
        return round(sum(_LATENCY_DEQUE) / len(_LATENCY_DEQUE), 1)


# ── Synthesizer pool — one SpeechSynthesizer per voice (thread-safe) ─────────
_POOL_LOCK: threading.Lock = threading.Lock()
_SYNTH_POOL: dict[str, object] = {}   # voice → SpeechSynthesizer


def _get_synthesizer(voice: str) -> object:  # type: ignore[return]
    """Return a cached (or freshly created) SpeechSynthesizer for *voice*.

    audio_config=None → Azure SDK stores audio in result.audio_data instead of
    routing it to a speaker device, which is what we want for HTTP streaming.
    """
    import azure.cognitiveservices.speech as speechsdk  # noqa: PLC0415

    with _POOL_LOCK:
        if voice not in _SYNTH_POOL:
            sc = speechsdk.SpeechConfig(
                subscription=TTSConfig.azure_key,
                region=TTSConfig.azure_region,
            )
            sc.speech_synthesis_voice_name = voice
            sc.set_speech_synthesis_output_format(
                speechsdk.SpeechSynthesisOutputFormat.Riff24Khz16BitMonoPcm
            )
            _SYNTH_POOL[voice] = speechsdk.SpeechSynthesizer(
                speech_config=sc,
                audio_config=None,   # result.audio_data holds the WAV bytes
            )
            log.info("[TTS] Pool: created synthesizer for voice=%s", voice)
        return _SYNTH_POOL[voice]


def clear_pool() -> None:
    """Discard all cached synthesizers (e.g. after key rotation)."""
    with _POOL_LOCK:
        _SYNTH_POOL.clear()
    log.info("[TTS] Synthesizer pool cleared")


# ── Public API ────────────────────────────────────────────────────────────────

def synthesize(
    text: str,
    voice: str | None = None,
    *,
    is_ssml: bool = False,
    req_id: str | None = None,
) -> bytes:
    """Synthesize *text* to RIFF 24 kHz/16-bit/mono WAV bytes via Azure Neural TTS.

    Parameters
    ----------
    text:     Arabic (or mixed) text — or full SSML document.
    voice:    Azure neural voice name override (default: TTSConfig.default_voice).
    is_ssml:  When True (or text starts with ``<speak``), use speak_ssml_async().
    req_id:   Request ID for telemetry; auto-generated if omitted.

    Returns
    -------
    bytes  Raw RIFF/WAV audio data (24 kHz / 16-bit / mono).

    Raises
    ------
    RuntimeError  Missing SDK, credentials, or any Azure synthesis failure.
                  No fallback — callers must handle.
    """
    if TTSConfig.provider != "azure":
        raise RuntimeError(
            f"Only 'azure' provider is allowed by policy — got '{TTSConfig.provider}'"
        )

    try:
        import azure.cognitiveservices.speech as speechsdk  # noqa: PLC0415
    except Exception as exc:
        raise RuntimeError(
            "Azure Speech SDK not installed. "
            "Run: pip install azure-cognitiveservices-speech>=1.36.0"
        ) from exc

    TTSConfig.validate()

    _req_id = req_id or str(uuid.uuid4())
    _voice  = voice or TTSConfig.default_voice
    _ssml   = is_ssml or text.lstrip().startswith("<speak")
    _t0     = time.perf_counter()

    synthesizer = _get_synthesizer(_voice)

    # ── Synthesis: 10 s timeout + single retry (400 ms backoff) ─────────────
    # NOTE: ResultFuture.get() takes NO arguments (no timeout param).
    # We implement the timeout by running synthesis in a daemon thread and
    # using thread.join(timeout=TIMEOUT_S) to bound the wait.
    TIMEOUT_S = 10.0
    result = None
    last_exc: Exception | None = None

    def _run_synth(synth_obj: object, _result: list, _err: list) -> None:
        try:
            future = (
                synth_obj.speak_ssml_async(text)  # type: ignore[attr-defined]
                if _ssml
                else synth_obj.speak_text_async(text)  # type: ignore[attr-defined]
            )
            _result[0] = future.get()  # blocks — no timeout arg accepted
        except Exception as exc:
            _err[0] = exc

    for attempt in range(2):
        _res: list = [None]
        _err: list = [None]
        t = threading.Thread(target=_run_synth, args=(synthesizer, _res, _err), daemon=True)
        t.start()
        t.join(timeout=TIMEOUT_S)

        if t.is_alive():
            # Thread still running → synthesis timed out
            last_exc = RuntimeError(f"Azure TTS timed out after {TIMEOUT_S}s")
        elif _err[0] is not None:
            last_exc = _err[0]
        else:
            result = _res[0]
            if result is not None and result.reason == speechsdk.ResultReason.SynthesizingAudioCompleted:
                break
            # Non-error reason (e.g. Canceled) — treat as failure
            last_exc = RuntimeError(f"reason={getattr(result, 'reason', 'unknown')}")
            result = None

        if attempt == 0:
            # Evict stale synthesizer so next attempt rebuilds connection
            with _POOL_LOCK:
                _SYNTH_POOL.pop(_voice, None)
            log.warning(
                "[TTS] attempt 1 failed (%s) — retry in 400 ms | req_id=%s | voice=%s",
                last_exc, _req_id, _voice,
            )
            time.sleep(0.4)
            synthesizer = _get_synthesizer(_voice)   # fresh synthesizer

    if result is None:
        details       = getattr(result, "cancellation_details", None) if result else None
        cancel_reason = getattr(details, "reason", None)
        error_detail  = getattr(details, "error_details", "") or ""
        raise RuntimeError(
            f"Azure TTS synthesis failed after 2 attempts: {last_exc} | "
            f"cancel_reason={cancel_reason} | detail={error_detail}"
        )

    data    = result.audio_data   # bytes — RIFF WAV already wrapped by SDK
    latency = round((time.perf_counter() - _t0) * 1000, 1)
    record_latency(latency)

    log.info(
        '{"event":"tts_synth","voice":"%s","text_len":%d,"bytes":%d,'
        '"latency_ms":%.1f,"req_id":"%s","ts":"%s","ssml":%s}',
        _voice,
        len(text),
        len(data),
        latency,
        _req_id,
        datetime.now(timezone.utc).isoformat(timespec="seconds"),
        "true" if _ssml else "false",
    )
    return data
