# -*- coding: utf-8 -*-
"""Local Habibi-TTS bridge — optional sovereign Jordanian voice (CLI subprocess)."""
from __future__ import annotations

import logging
import os
import subprocess
import tempfile

logger = logging.getLogger(__name__)

# Default path fixed (VOUICE → VOICE). Back-compat: HABIBI_REF_AUDIO still honored.
_DEFAULT_REF = "/app/data/audio/COGNI-VOICE.mp4"
REFERENCE_AUDIO = (
    os.getenv("HABIBI_REF_PATH", "").strip()
    or os.getenv("HABIBI_REF_AUDIO", "").strip()
    or _DEFAULT_REF
)
REFERENCE_TEXT = os.getenv("HABIBI_REF_TEXT", "أهلاً بكم في منصة إديوفيرس")
# Habibi CLI accepts MSA|SAU|…|LEV|… only — not "jo". LEV ≈ Levant (Jordan/Syria/Lebanon proxy).
HABIBI_DIALECT = (os.getenv("HABIBI_DIALECT", "LEV") or "LEV").strip().upper()


def _cli_timeout_sec() -> float:
    raw = os.getenv("HABIBI_CLI_TIMEOUT_SEC", "120")
    try:
        t = float(str(raw).strip())
    except ValueError:
        t = 120.0
    return max(15.0, min(t, 600.0))


def synthesize_habibi_tts(target_text: str) -> bytes | None:
    """
    Run Habibi-TTS CLI in a subprocess. Returns WAV bytes or None on failure/timeout
    (caller may fall through to cloud TTS).
    """
    if not os.path.exists(REFERENCE_AUDIO):
        logger.error("[Habibi-TTS] Reference audio not found at %s", REFERENCE_AUDIO)
        return None

    out_dir = tempfile.gettempdir()
    out_filename = f"cogni_habibi_{os.urandom(4).hex()}.wav"
    out_path = os.path.join(out_dir, out_filename)
    timeout = _cli_timeout_sec()

    try:
        command = [
            "python",
            "-m",
            "habibi_tts.infer.infer_cli",
            "-m",
            "Unified",
            "-d",
            HABIBI_DIALECT,
            "-r",
            REFERENCE_AUDIO,
            "-s",
            REFERENCE_TEXT,
            "-t",
            target_text,
            "-o",
            out_dir,
            "-w",
            out_filename,
        ]
        logger.info("[Habibi-TTS] Generating (timeout=%.0fs) text=%r...", timeout, target_text[:48])

        try:
            result = subprocess.run(
                command,
                capture_output=True,
                text=True,
                timeout=timeout,
            )
        except subprocess.TimeoutExpired:
            logger.error("[Habibi-TTS] subprocess timed out after %.0fs", timeout)
            return None

        if result.returncode != 0:
            logger.error("[Habibi-TTS] CLI failed rc=%s stderr=%s", result.returncode, (result.stderr or "")[:800])
            return None

        if not os.path.isfile(out_path):
            logger.error("[Habibi-TTS] Expected output missing: %s", out_path)
            return None

        with open(out_path, "rb") as audio_file:
            return audio_file.read()

    except OSError as e:
        logger.error("[Habibi-TTS] I/O error: %s", e)
        return None
    finally:
        try:
            if os.path.exists(out_path):
                os.remove(out_path)
        except OSError:
            pass
