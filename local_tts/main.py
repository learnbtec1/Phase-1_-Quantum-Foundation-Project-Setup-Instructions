"""
Local Piper TTS microservice — stdin text, WAV via Piper, MP3 via ffmpeg.
No shell=True; subprocess argument lists only.
"""

from __future__ import annotations

import base64
import logging
import os
import shutil
import subprocess
import tempfile
from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import FastAPI, HTTPException, Query
from pydantic import BaseModel, Field

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s %(levelname)s [%(name)s] %(message)s",
)
logger = logging.getLogger("local_tts")

PIPER_BIN = os.getenv("PIPER_BIN", "piper")
MODEL_PATH = os.getenv("PIPER_MODEL_PATH", "/app/models/model.onnx")
CONFIG_PATH = os.getenv("PIPER_CONFIG_PATH", "").strip()
TASHKEEL_MODEL = (os.getenv("PIPER_TASHKEEL_MODEL") or "/usr/local/share/piper/libtashkeel_model.ort").strip()
PIPER_TIMEOUT = float(os.getenv("PIPER_SUBPROCESS_TIMEOUT_SEC", "120"))
FFMPEG_TIMEOUT = float(os.getenv("FFMPEG_TIMEOUT_SEC", "60"))
MAX_TEXT_LEN = int(os.getenv("TTS_MAX_TEXT_LEN", "4000"))
_DEBUG = (os.getenv("LOCAL_TTS_DEBUG", "false") or "").strip().lower() in ("1", "true", "yes")
# Bumps when /health contract or debug routes change — if missing in curl, image is stale.
API_BUILD_ID = "local_tts-v2-2026-05-pitch-eq"
# Flag unusually small encodes (often broken pipeline); still return if >= 32 bytes.
MP3_WARN_BYTES = int(os.getenv("LOCAL_TTS_MP3_WARN_BYTES", "1000"))
# After Piper WAV: optional pitch + light EQ via ffmpeg (female-like timbre without swapping ONNX).
# Docker Compose should set PIPER_POST_PITCH_MULT=1.0 and PIPER_POST_EQ=false for neutral Piper timbre (no ffmpeg pitch chain).
# PIPER_POST_EQ=false disables highpass/lowpass after pitch (when pitch mult ≠ 1).
PIPER_WAV_SAMPLE_RATE = float(os.getenv("PIPER_WAV_SAMPLE_RATE", "22050"))


def _post_pitch_mult() -> float:
    try:
        return float(os.getenv("PIPER_POST_PITCH_MULT", "1.0"))
    except ValueError:
        return 1.0


def _ffmpeg_wav_to_mp3(wav_path: Path, out_mp3: str, diag: dict) -> bool:
    """WAV → MP3; optional post-Piper pitch + light via ffmpeg. Retries pitch-only if pitch+EQ fails."""
    mult = _post_pitch_mult()
    sr = PIPER_WAV_SAMPLE_RATE
    diag["piper_wav_sample_rate"] = sr
    diag["post_pitch_mult"] = mult
    diag["post_pitch_applied"] = abs(mult - 1.0) > 1e-6

    filter_attempts: list[tuple[str, str | None]] = []
    if diag["post_pitch_applied"]:
        new_rate = sr * mult
        eq_on = (os.getenv("PIPER_POST_EQ", "false") or "").strip().lower() in (
            "1",
            "true",
            "yes",
        )
        try:
            hp = max(20, int(os.getenv("PIPER_POST_EQ_HIGHPASS", "120")))
        except ValueError:
            hp = 120
        try:
            lp = max(hp + 1, int(os.getenv("PIPER_POST_EQ_LOWPASS", "8000")))
        except ValueError:
            lp = 8000
        pitch_only = f"asetrate={new_rate},aresample={int(sr)}"
        if eq_on:
            filt_eq = f"{pitch_only},highpass=f={hp},lowpass=f={lp}"
            filter_attempts.append(("pitch_eq", filt_eq))
            diag["post_eq"] = {"enabled": True, "highpass_hz": hp, "lowpass_hz": lp}
        else:
            diag["post_eq"] = {"enabled": False, "highpass_hz": hp, "lowpass_hz": lp}
        filter_attempts.append(("pitch_only", pitch_only))
    else:
        diag["post_eq"] = {"enabled": False}
        filter_attempts.append(("direct_mp3", None))

    last_ferr = ""
    for attempt_i, (attempt_name, filt) in enumerate(filter_attempts):
        if filt is None:
            ffmpeg_cmd = [
                "ffmpeg",
                "-y",
                "-i",
                str(wav_path.resolve()),
                "-codec:a",
                "libmp3lame",
                "-qscale:a",
                "4",
                str(Path(out_mp3).resolve()),
            ]
        else:
            ffmpeg_cmd = [
                "ffmpeg",
                "-y",
                "-i",
                str(wav_path.resolve()),
                "-filter:a",
                filt,
                "-codec:a",
                "libmp3lame",
                "-qscale:a",
                "4",
                str(Path(out_mp3).resolve()),
            ]
        diag["ffmpeg_attempt"] = attempt_name
        diag["ffmpeg_cmd"] = " ".join(ffmpeg_cmd)
        _dlog("ffmpeg_cmd=%s", diag["ffmpeg_cmd"])
        if attempt_i == 0 and diag["post_pitch_applied"]:
            logger.info(
                "[synthesize] post-pitch try=%s mult=%s (Piper ONNX unchanged)",
                attempt_name,
                mult,
            )
        try:
            fr = subprocess.run(
                ffmpeg_cmd,
                stdin=subprocess.DEVNULL,
                stdout=subprocess.DEVNULL,
                stderr=subprocess.PIPE,
                check=False,
                timeout=FFMPEG_TIMEOUT,
            )
        except subprocess.TimeoutExpired:
            diag["error"] = "ffmpeg_timeout"
            diag["error_stage"] = "ffmpeg"
            logger.error("[synthesize] ffmpeg timeout after %ss", FFMPEG_TIMEOUT)
            return False
        diag["ffmpeg_returncode"] = fr.returncode
        ferr = (fr.stderr or b"").decode("utf-8", errors="replace")
        last_ferr = ferr
        if ferr.strip():
            diag["ffmpeg_stderr_tail"] = ferr.strip()[-800:]
        if fr.returncode == 0:
            if attempt_i > 0:
                logger.warning(
                    "[synthesize] ffmpeg succeeded on fallback %s (earlier attempt failed)",
                    attempt_name,
                )
            return True
        logger.warning(
            "[synthesize] ffmpeg failed attempt=%s rc=%s — retrying if alternatives remain",
            attempt_name,
            fr.returncode,
        )

    diag["error"] = "ffmpeg_failed"
    diag["error_stage"] = "ffmpeg"
    logger.error("[synthesize] ffmpeg failed all attempts stderr=%s", last_ferr[:600])
    return False


class TTSRequest(BaseModel):
    text: str = Field(..., min_length=1, max_length=MAX_TEXT_LEN)


def _resolved_config_path() -> str | None:
    if CONFIG_PATH:
        p = Path(CONFIG_PATH)
        return str(p) if p.is_file() else None
    mp = Path(MODEL_PATH)
    guess = mp.with_suffix(".onnx.json")
    if guess.is_file():
        return str(guess)
    alt = Path(str(mp) + ".json")
    if alt.is_file():
        return str(alt)
    return None


def _resolve_piper_executable() -> str | None:
    if os.path.isabs(PIPER_BIN) or "/" in PIPER_BIN or "\\" in PIPER_BIN:
        return PIPER_BIN if Path(PIPER_BIN).is_file() else None
    return shutil.which(PIPER_BIN)


def _ffmpeg_on_path() -> bool:
    return shutil.which("ffmpeg") is not None


def _piper_quality_args() -> list[str]:
    """
    Prosody / naturalness tuning for Piper (less robotic, smoother pacing).
    Override via PIPER_NOISE_SCALE, PIPER_LENGTH_SCALE, PIPER_NOISE_W.
    """
    ns = (os.getenv("PIPER_NOISE_SCALE") or "0.667").strip()
    ls = (os.getenv("PIPER_LENGTH_SCALE") or "1.0").strip()
    nw = (os.getenv("PIPER_NOISE_W") or "0.8").strip()
    return ["--noise_scale", ns, "--length_scale", ls, "--noise_w", nw]


def _dlog(msg: str, *args: object) -> None:
    if _DEBUG:
        logger.info("[DEBUG] " + msg, *args)


def _synthesize_core(text: str) -> tuple[dict | None, dict]:
    """
    Run Piper → WAV → ffmpeg → MP3. Returns (response_dict, diagnostics).
    On failure response_dict is None; diagnostics always has error/error_stage when failed.
    """
    diag: dict = {
        "text_len": len(text),
        "text_preview": (text[:120] + "…") if len(text) > 120 else text,
        "piper_bin_env": PIPER_BIN,
        "model_path": MODEL_PATH,
    }
    model_path = Path(MODEL_PATH)
    if not model_path.is_file():
        diag["error"] = "model_missing"
        diag["error_stage"] = "precheck"
        logger.error("[synthesize] model file missing: %s", MODEL_PATH)
        return None, diag

    piper_exe = _resolve_piper_executable()
    diag["piper_resolved"] = piper_exe
    if not piper_exe or not Path(piper_exe).is_file():
        diag["error"] = "piper_binary_missing"
        diag["error_stage"] = "precheck"
        logger.error("[synthesize] piper binary not found | PIPER_BIN=%r resolved=%r", PIPER_BIN, piper_exe)
        return None, diag

    if not _ffmpeg_on_path():
        diag["error"] = "ffmpeg_missing"
        diag["error_stage"] = "precheck"
        logger.error("[synthesize] ffmpeg not on PATH")
        return None, diag

    out_wav: str | None = None
    out_mp3: str | None = None
    try:
        with tempfile.NamedTemporaryFile(suffix=".wav", delete=False) as tmp_wav:
            out_wav = tmp_wav.name
        diag["wav_path"] = out_wav

        piper_cmd = [piper_exe, "--model", str(model_path.resolve()), "--output_file", out_wav]
        cfg = _resolved_config_path()
        diag["config_path"] = cfg
        if cfg:
            piper_cmd.extend(["--config", str(Path(cfg).resolve())])
        tashkeel = Path(TASHKEEL_MODEL)
        if tashkeel.is_file():
            piper_cmd.extend(["--tashkeel_model", str(tashkeel.resolve())])
        piper_cmd.extend(_piper_quality_args())
        diag["tashkeel_model"] = str(tashkeel) if tashkeel.is_file() else None
        diag["piper_noise_scale"] = (os.getenv("PIPER_NOISE_SCALE") or "0.667").strip()
        diag["piper_length_scale"] = (os.getenv("PIPER_LENGTH_SCALE") or "1.0").strip()
        diag["piper_noise_w"] = (os.getenv("PIPER_NOISE_W") or "0.8").strip()
        diag["piper_cmd"] = " ".join(piper_cmd)
        _dlog("piper_cmd=%s", diag["piper_cmd"])

        try:
            pr = subprocess.run(
                piper_cmd,
                input=text.encode("utf-8"),
                stdout=subprocess.DEVNULL,
                stderr=subprocess.PIPE,
                check=False,
                timeout=PIPER_TIMEOUT,
            )
        except subprocess.TimeoutExpired:
            diag["error"] = "piper_timeout"
            diag["error_stage"] = "piper"
            logger.error("[synthesize] Piper subprocess timeout after %ss", PIPER_TIMEOUT)
            return None, diag

        diag["piper_returncode"] = pr.returncode
        perr = (pr.stderr or b"").decode("utf-8", errors="replace")
        if perr.strip():
            diag["piper_stderr_tail"] = perr.strip()[-800:]
        _dlog("piper rc=%s stderr_tail=%s", pr.returncode, (perr[-200:] if perr else ""))

        if pr.returncode != 0:
            diag["error"] = "piper_failed"
            diag["error_stage"] = "piper"
            logger.error("[synthesize] Piper failed rc=%s stderr=%s", pr.returncode, perr[:500])
            return None, diag

        wav_path = Path(out_wav)
        if not wav_path.is_file():
            diag["error"] = "wav_not_created"
            diag["error_stage"] = "piper"
            logger.error("[synthesize] WAV path missing after Piper: %s", out_wav)
            return None, diag

        wav_size = wav_path.stat().st_size
        diag["wav_bytes"] = wav_size
        _dlog("wav_bytes=%s", wav_size)

        if wav_size == 0:
            diag["error"] = "wav_empty"
            diag["error_stage"] = "piper"
            logger.error("[synthesize] WAV size is 0")
            return None, diag
        if wav_size < 32:
            diag["error"] = "wav_too_small"
            diag["error_stage"] = "piper"
            logger.error("[synthesize] WAV too small: %s bytes", wav_size)
            return None, diag

        with tempfile.NamedTemporaryFile(suffix=".mp3", delete=False) as tmp_mp3:
            out_mp3 = tmp_mp3.name
        diag["mp3_path"] = out_mp3

        if not _ffmpeg_wav_to_mp3(wav_path, out_mp3, diag):
            return None, diag

        mp3_path = Path(out_mp3)
        mp3_bytes = mp3_path.read_bytes()
        diag["mp3_bytes"] = len(mp3_bytes)
        _dlog("mp3_bytes=%s", len(mp3_bytes))

        if len(mp3_bytes) < 32:
            diag["error"] = "mp3_too_small"
            diag["error_stage"] = "encode"
            logger.error("[synthesize] MP3 payload too small: %s bytes", len(mp3_bytes))
            return None, diag

        if len(mp3_bytes) < MP3_WARN_BYTES:
            diag["warning"] = f"mp3_smaller_than_{MP3_WARN_BYTES}_bytes_unusual"
            logger.warning(
                "[synthesize] MP3 size %s below warn threshold %s — audio may be truncated",
                len(mp3_bytes),
                MP3_WARN_BYTES,
            )

        b64 = base64.b64encode(mp3_bytes).decode("ascii")
        try:
            base64.b64decode(b64, validate=True)
        except Exception as e:
            diag["error"] = "base64_invalid"
            diag["error_stage"] = "response"
            logger.error("[synthesize] base64 self-check failed: %s", e)
            return None, diag

        resp = {
            "audio_base64": b64,
            "provider": "local_piper",
            "format": "mp3",
            "sample_rate": 22050,
            "voice": model_path.stem,
        }
        return resp, diag
    finally:
        for p in (out_wav, out_mp3):
            if p and os.path.exists(p):
                try:
                    os.remove(p)
                except OSError:
                    pass


def _warmup_piper() -> None:
    """Load model once at startup so the first user request is not cold."""
    model_path = Path(MODEL_PATH)
    if not model_path.is_file():
        logger.info("Piper warmup skipped — model missing: %s", MODEL_PATH)
        return
    out_wav: str | None = None
    try:
        with tempfile.NamedTemporaryFile(suffix=".wav", delete=False) as tmp_wav:
            out_wav = tmp_wav.name
        exe = _resolve_piper_executable()
        if not exe:
            logger.warning("Piper warmup skipped — binary not found: %s", PIPER_BIN)
            return
        piper_cmd = [exe, "--model", str(model_path.resolve()), "--output_file", out_wav]
        cfg = _resolved_config_path()
        if cfg:
            piper_cmd.extend(["--config", str(Path(cfg).resolve())])
        tk = Path(TASHKEEL_MODEL)
        if tk.is_file():
            piper_cmd.extend(["--tashkeel_model", str(tk.resolve())])
        piper_cmd.extend(_piper_quality_args())
        r = subprocess.run(
            piper_cmd,
            input=b"test",
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL,
            timeout=min(PIPER_TIMEOUT, 30.0),
        )
        if r.returncode == 0:
            logger.info("Piper warmup completed")
        else:
            logger.warning("Piper warmup exited %s (non-fatal)", r.returncode)
    except subprocess.TimeoutExpired:
        logger.warning("Piper warmup timed out (non-fatal)")
    except Exception as exc:  # pragma: no cover
        logger.warning("Piper warmup failed (non-fatal): %s", exc)
    finally:
        if out_wav and os.path.exists(out_wav):
            try:
                os.remove(out_wav)
            except OSError:
                pass


@asynccontextmanager
async def lifespan(_app: FastAPI):
    _warmup_piper()
    yield


app = FastAPI(title="Local TTS (Piper)", version="1.0.0", lifespan=lifespan)


@app.get("/health")
def health() -> dict:
    model_path = Path(MODEL_PATH)
    model_exists = model_path.is_file()
    piper_resolved = _resolve_piper_executable()
    piper_ok = bool(piper_resolved and Path(piper_resolved).is_file())
    ffmpeg_ok = _ffmpeg_on_path()
    cfg = _resolved_config_path()
    ok = bool(model_exists and piper_ok and ffmpeg_ok)
    body: dict = {
        "ok": ok,
        "status": "ok" if ok else "unavailable",
        "api_build": API_BUILD_ID,
        "endpoints": ["/health", "/synthesize", "/debug-audio"],
        "model": str(MODEL_PATH),
        "model_exists": model_exists,
        "piper_bin": PIPER_BIN,
        "piper_resolved": piper_resolved,
        "piper_found": piper_ok,
        "ffmpeg_found": ffmpeg_ok,
        "config_path": cfg,
        "debug_logging": _DEBUG,
        "piper_quality": {
            "noise_scale": (os.getenv("PIPER_NOISE_SCALE") or "0.667").strip(),
            "length_scale": (os.getenv("PIPER_LENGTH_SCALE") or "1.0").strip(),
            "noise_w": (os.getenv("PIPER_NOISE_W") or "0.8").strip(),
        },
        "post_pitch": {
            "mult": _post_pitch_mult(),
            "wav_sample_rate": PIPER_WAV_SAMPLE_RATE,
            "enabled": abs(_post_pitch_mult() - 1.0) > 1e-6,
            "eq_when_pitch": {
                "PIPER_POST_EQ": (os.getenv("PIPER_POST_EQ") or "false").strip(),
                "highpass_hz": (os.getenv("PIPER_POST_EQ_HIGHPASS") or "120").strip(),
                "lowpass_hz": (os.getenv("PIPER_POST_EQ_LOWPASS") or "8000").strip(),
            },
        },
    }
    if not ok:
        missing = []
        if not model_exists:
            missing.append("model")
        if not piper_ok:
            missing.append("piper")
        if not ffmpeg_ok:
            missing.append("ffmpeg")
        body["missing"] = missing
    return body


@app.post("/synthesize")
def synthesize(req: TTSRequest) -> dict:
    text = req.text.strip()
    if not text:
        raise HTTPException(status_code=400, detail="Empty text")

    resp, diag = _synthesize_core(text)
    if resp is None:
        err = diag.get("error", "unknown")
        stage = diag.get("error_stage", "")
        logger.error(
            "[synthesize] FAILED error=%s stage=%s wav_bytes=%s mp3_bytes=%s",
            err,
            stage,
            diag.get("wav_bytes"),
            diag.get("mp3_bytes"),
        )
        detail = f"Piper pipeline failed at [{stage}]: {err}"
        status = 504 if "timeout" in err else 503 if err in ("model_missing", "piper_binary_missing", "ffmpeg_missing") else 500
        raise HTTPException(status_code=status, detail=detail) from None

    logger.info(
        "[synthesize] OK text_len=%s wav_bytes=%s mp3_bytes=%s",
        diag.get("text_len"),
        diag.get("wav_bytes"),
        diag.get("mp3_bytes"),
    )
    if diag.get("warning"):
        logger.warning("[synthesize] %s", diag["warning"])
    return resp


@app.get("/debug-audio")
def debug_audio(
    text: str = Query(default="مرحبا", max_length=MAX_TEXT_LEN),
    include_mp3_base64: bool = Query(default=False),
) -> dict:
    """
    Full pipeline diagnosis without throwing (for curl / ops). Optional full base64 body.
    """
    t = (text or "").strip()
    if not t:
        return {"success": False, "error": "empty_text", "diagnostics": {}}

    resp, diag = _synthesize_core(t)
    out: dict = {
        "success": resp is not None,
        "diagnostics": {k: v for k, v in diag.items() if k != "audio_base64"},
    }
    if resp:
        out["response_shape"] = {
            "has_audio_base64": bool(resp.get("audio_base64")),
            "audio_base64_len": len(resp.get("audio_base64") or ""),
            "provider": resp.get("provider"),
            "format": resp.get("format"),
            "sample_rate": resp.get("sample_rate"),
            "voice": resp.get("voice"),
        }
        if include_mp3_base64:
            out["audio_base64"] = resp["audio_base64"]
    else:
        out["error"] = diag.get("error")
        out["error_stage"] = diag.get("error_stage")
    return out

