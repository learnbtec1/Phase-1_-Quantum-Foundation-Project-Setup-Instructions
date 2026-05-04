# -*- coding: utf-8 -*-
"""FFmpeg/ffprobe helpers for TTS: accurate duration and unified sample rate."""
from __future__ import annotations

import logging
import os
import subprocess
import tempfile
from pathlib import Path

logger = logging.getLogger(__name__)

TARGET_TTS_SAMPLE_RATE_HZ = 24_000


class AudioFfmpegError(RuntimeError):
    """ffprobe/ffmpeg failed or produced invalid output."""


def get_audio_duration_ms(audio_bytes: bytes) -> int:
    """
    Decode-aware duration from audio bytes via ffprobe (not byte-length estimation).

    Returns duration in milliseconds, rounded to nearest ms.
    """
    if not audio_bytes or len(audio_bytes) < 32:
        raise AudioFfmpegError("audio payload too small to probe")
    tmp: str | None = None
    try:
        fd, tmp = tempfile.mkstemp(suffix=".mp3", prefix="tts_probe_")
        os.close(fd)
        Path(tmp).write_bytes(audio_bytes)
        proc = subprocess.run(
            [
                "ffprobe",
                "-v",
                "error",
                "-show_entries",
                "format=duration",
                "-of",
                "default=noprint_wrappers=1:nokey=1",
                tmp,
            ],
            capture_output=True,
            text=True,
            timeout=60,
            check=False,
        )
        if proc.returncode != 0:
            err = (proc.stderr or proc.stdout or "").strip()[:500]
            raise AudioFfmpegError(f"ffprobe failed (code {proc.returncode}): {err}")
        line = (proc.stdout or "").strip().splitlines()
        raw = line[0].strip() if line else ""
        if not raw or raw == "N/A":
            raise AudioFfmpegError("ffprobe returned no duration")
        sec = float(raw)
        if sec < 0:
            raise AudioFfmpegError(f"invalid duration: {sec}")
        return max(1, int(round(sec * 1000.0)))
    except FileNotFoundError as e:
        raise AudioFfmpegError(
            "ffprobe not found — install ffmpeg (includes ffprobe) for accurate TTS duration"
        ) from e
    finally:
        if tmp and os.path.exists(tmp):
            try:
                os.unlink(tmp)
            except OSError:
                pass


def normalize_mp3_to_24k_hz(mp3_bytes: bytes) -> bytes:
    """
    Re-encode MP3 to target sample rate 24 kHz for a unified playback/timing pipeline.

    Uses libmp3lame VBR ~qscale 4; channel layout preserved.
    """
    if not mp3_bytes or len(mp3_bytes) < 32:
        raise AudioFfmpegError("audio payload too small to normalize")
    in_path: str | None = None
    out_path: str | None = None
    try:
        fd, in_path = tempfile.mkstemp(suffix=".mp3", prefix="tts_norm_in_")
        os.close(fd)
        Path(in_path).write_bytes(mp3_bytes)
        out_path = in_path + ".out.mp3"
        proc = subprocess.run(
            [
                "ffmpeg",
                "-y",
                "-i",
                in_path,
                "-ar",
                str(TARGET_TTS_SAMPLE_RATE_HZ),
                "-codec:a",
                "libmp3lame",
                "-qscale:a",
                "4",
                out_path,
            ],
            capture_output=True,
            timeout=120,
            check=False,
        )
        if proc.returncode != 0:
            err = (proc.stderr or b"").decode("utf-8", errors="replace")[:600]
            raise AudioFfmpegError(f"ffmpeg resample failed: {err}")
        out_b = Path(out_path).read_bytes()
        if len(out_b) < 32:
            raise AudioFfmpegError("ffmpeg produced empty output")
        return out_b
    except FileNotFoundError as e:
        raise AudioFfmpegError(
            "ffmpeg not found — install ffmpeg for unified TTS sample rate"
        ) from e
    finally:
        for p in (in_path, out_path):
            if p and os.path.exists(p):
                try:
                    os.unlink(p)
                except OSError:
                    pass
