# -*- coding: utf-8 -*-
"""
conversation_store.py — Unified transcript & audio persistence.

Storage layout (relative to CWD, or absolute if env vars are set):
  data/store/YYYY-MM-DD.jsonl          — daily JSONL transcript (UTF-8)
  data/store/YYYY-MM-DD.index.json     — utterance_id → metadata index (JSON)
  data/audio/YYYY-MM-DD/<uid>.wav      — WAV 24 kHz mono PCM files

All file writes are atomic (write to *.tmp → os.replace). Thread-safe via a
single threading.Lock so concurrent FastAPI background tasks do not interleave
JSONL lines.

Environment variables
---------------------
  STORE_DIR   directory for JSONL + index files  (default: ./data/store)
  AUDIO_DIR   directory for WAV files            (default: ./data/audio)

Both may be relative (resolved from CWD) or absolute.
In Docker the default ./data/* resolves to /app/data/* which is inside the
existing ./backend:/app bind-mount — no docker-compose changes required.
"""
from __future__ import annotations

import base64
import io
import json
import logging
import os
import shutil
import subprocess
import tempfile
import threading
import time
import uuid
import wave
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any, Dict, List, Optional

logger = logging.getLogger(__name__)


class ConversationStore:
    """
    Append-only store for TTS utterances: JSONL transcript + WAV audio + index.

    Quick-start (singleton recommended — see module bottom):
        from app.services.conversation_store import get_store
        store = get_store()
        store.append_utterance(role="assistant", text="...", provider="azure", ...)
    """

    def __init__(
        self,
        store_dir: Optional[str] = None,
        audio_dir: Optional[str] = None,
    ) -> None:
        cwd = Path.cwd()
        self._store_dir = Path(
            store_dir or os.getenv("STORE_DIR", str(cwd / "data" / "store"))
        )
        self._audio_dir = Path(
            audio_dir or os.getenv("AUDIO_DIR", str(cwd / "data" / "audio"))
        )
        self._lock = threading.Lock()
        self._ensure_dirs()
        logger.info(
            "ConversationStore ready | store=%s  audio=%s",
            self._store_dir,
            self._audio_dir,
        )

    # ── Internal helpers ───────────────────────────────────────────────────────

    def _ensure_dirs(self) -> None:
        self._store_dir.mkdir(parents=True, exist_ok=True)
        self._audio_dir.mkdir(parents=True, exist_ok=True)

    @staticmethod
    def _today() -> str:
        return datetime.now(timezone.utc).strftime("%Y-%m-%d")

    @staticmethod
    def _now_iso() -> str:
        return (
            datetime.now(timezone.utc)
            .isoformat(timespec="milliseconds")
            .replace("+00:00", "Z")
        )

    def _jsonl_path(self, date_str: str) -> Path:
        return self._store_dir / f"{date_str}.jsonl"

    def _index_path(self, date_str: str) -> Path:
        return self._store_dir / f"{date_str}.index.json"

    @staticmethod
    def _wav_duration_ms(wav_bytes: bytes) -> int:
        """Return duration in milliseconds from raw WAV bytes."""
        try:
            with wave.open(io.BytesIO(wav_bytes)) as wf:
                return int(wf.getnframes() / wf.getframerate() * 1000)
        except Exception:
            return 0

    # ── Mojibake guard ─────────────────────────────────────────────────────────

    _MOJI_RE = None  # lazy-compiled

    @staticmethod
    def _fix_mojibake(text: str) -> str:
        """
        Idempotent repair for Arabic text that was stored as UTF-8 bytes but
        mis-decoded as Windows-1252 (the classic Ø§Ù„Ø¹Ø± / Ù…Ø±Ø­Ø¨Ø§ pattern).

        Windows-1252 remaps several byte values in 0x80-0x9F to special chars
        (e.g. 0x85 → U+2026 '…'), so we must re-encode via windows-1252 (not
        latin-1) to recover the original bytes, then decode as UTF-8.

        Returns the repaired string if it contains Arabic (U+0600-U+06FF),
        otherwise returns the original unchanged. Idempotent — safe to call on
        already-correct UTF-8 text.
        """
        import re
        if ConversationStore._MOJI_RE is None:
            # Triggers on: Ø (U+00D8), Ù (U+00D9), or Windows-1252 remapped
            # chars that appear when UTF-8 Arabic continuation bytes are
            # mapped via CP1252 (e.g. … U+2026, – U+2013, ' U+2018, " U+201C)
            ConversationStore._MOJI_RE = re.compile(
                r"[\u00c3-\u00d5]|[\u2026\u2013\u2014\u2018\u2019\u201c\u201d\u0160\u017e]"
            )
        if not ConversationStore._MOJI_RE.search(text):
            return text  # fast-path: looks fine already
        # Try windows-1252 first (handles 0x80-0x9F remapped chars), then latin-1
        for enc in ("windows-1252", "latin-1"):
            try:
                repaired = text.encode(enc, errors="strict").decode("utf-8")
                if any("\u0600" <= ch <= "\u06ff" for ch in repaired):
                    return repaired
            except Exception:
                pass
        return text

    @staticmethod
    def _safe_read_text(path: Path) -> str:
        """
        Read a text file trying UTF-8 first, then windows-1256 (common for
        Arabic files on Windows), then latin-1 as final fallback.
        Always returns a str with correct Arabic codepoints.
        """
        for enc in ("utf-8", "windows-1256", "latin-1"):
            try:
                text = path.read_text(encoding=enc)
                # Validate: after UTF-8 decode, check for mojibake patterns
                if enc == "utf-8":
                    return ConversationStore._fix_mojibake(text)
                return text
            except (UnicodeDecodeError, LookupError):
                continue
        return path.read_text(encoding="utf-8", errors="replace")

    def _atomic_json_write(self, path: Path, data: Any) -> None:
        """Write JSON atomically: write .tmp then os.replace."""
        tmp = path.with_suffix(".tmp")
        tmp.write_text(
            json.dumps(data, ensure_ascii=False, indent=2),
            encoding="utf-8",
        )
        os.replace(tmp, path)

    def _load_index(self, date_str: str) -> Dict[str, Any]:
        p = self._index_path(date_str)
        if p.exists():
            try:
                return json.loads(p.read_text(encoding="utf-8"))
            except Exception:
                return {}
        return {}

    def _save_index(self, date_str: str, index: Dict[str, Any]) -> None:
        self._atomic_json_write(self._index_path(date_str), index)

    # ── Core public API ────────────────────────────────────────────────────────

    def append_utterance(
        self,
        *,
        utterance_id: Optional[str] = None,
        role: str = "assistant",
        text: str,
        provider: str,
        timing_mode: str,
        sample_rate: int = 24000,
        wav_bytes: Optional[bytes] = None,
        viseme_events: Optional[List[Any]] = None,
        word_timings: Optional[List[Any]] = None,
        meta: Optional[Dict[str, Any]] = None,
    ) -> str:
        """
        Persist one utterance. Returns the utterance_id.

        Side effects (all failures are logged, never raise):
          1. Writes WAV file to data/audio/YYYY-MM-DD/<uid>.wav (when wav_bytes set).
          2. Appends one JSON line to  data/store/YYYY-MM-DD.jsonl.
          3. Updates              data/store/YYYY-MM-DD.index.json atomically.
        """
        uid = utterance_id or str(uuid.uuid4())
        date_str = self._today()
        ts = self._now_iso()
        viseme_events = viseme_events or []
        word_timings = word_timings or []
        meta = meta or {}
        text = self._fix_mojibake(text)  # normalize before any write

        # 1. Save WAV ──────────────────────────────────────────────────────────
        wav_path_rel: Optional[str] = None
        duration_ms = 0
        if wav_bytes:
            audio_day_dir = self._audio_dir / date_str
            audio_day_dir.mkdir(parents=True, exist_ok=True)
            wav_file = audio_day_dir / f"{uid}.wav"
            try:
                tmp_wav = wav_file.with_suffix(".wav.tmp")
                tmp_wav.write_bytes(wav_bytes)
                os.replace(tmp_wav, wav_file)
                duration_ms = self._wav_duration_ms(wav_bytes)
                try:
                    wav_path_rel = str(
                        wav_file.relative_to(Path.cwd())
                    ).replace("\\", "/")
                except ValueError:
                    wav_path_rel = str(wav_file).replace("\\", "/")
            except Exception as exc:
                logger.warning(
                    "ConversationStore: WAV write failed for %s: %s", uid, exc
                )
                wav_path_rel = None

        # 2. JSONL record ──────────────────────────────────────────────────────
        record: Dict[str, Any] = {
            "utterance_id": uid,
            "ts": ts,
            "role": role,
            "text": text,
            "provider": provider,
            "timing_mode": timing_mode,
            "sample_rate": sample_rate,
            "duration_ms": duration_ms,
            "wav_path": wav_path_rel,
            "word_count": len(word_timings),
            "viseme_count": len(viseme_events),
            "meta": meta,
        }

        # 3. Atomic JSONL append + index update — protected by lock ─────────
        jsonl_p = self._jsonl_path(date_str)
        with self._lock:
            try:
                with jsonl_p.open("a", encoding="utf-8") as fh:
                    fh.write(json.dumps(record, ensure_ascii=False) + "\n")
            except Exception as exc:
                logger.error("ConversationStore: JSONL write failed: %s", exc)

            try:
                index = self._load_index(date_str)
                index[uid] = {
                    "ts": ts,
                    "provider": provider,
                    "timing_mode": timing_mode,
                    "duration_ms": duration_ms,
                    "wav_path": wav_path_rel,
                    "word_count": len(word_timings),
                    "viseme_count": len(viseme_events),
                }
                self._save_index(date_str, index)
            except Exception as exc:
                logger.error(
                    "ConversationStore: index update failed: %s", exc
                )

        logger.debug(
            "ConversationStore: saved uid=%s provider=%s duration_ms=%d wav=%s",
            uid, provider, duration_ms, wav_path_rel,
        )
        return uid

    def append_from_response(
        self,
        text: str,
        provider: str,
        timing_mode: str,
        sample_rate: int,
        audio_wav_b64: Optional[str],
        word_timings: Optional[List[Any]],
        viseme_events: Optional[List[Any]],
        tts_latency_ms: int = 0,
    ) -> str:
        """
        Convenience wrapper for the TTS endpoint.

        Accepts the fields from TTSResponse directly (audio_wav_base64 as
        base64 str). Decodes WAV bytes, then calls append_utterance.
        Safe to use as a BackgroundTasks callback.
        """
        wav_bytes: Optional[bytes] = None
        if audio_wav_b64:
            try:
                wav_bytes = base64.b64decode(audio_wav_b64)
            except Exception:
                wav_bytes = None

        return self.append_utterance(
            role="assistant",
            text=text,
            provider=provider,
            timing_mode=timing_mode,
            sample_rate=sample_rate,
            wav_bytes=wav_bytes,
            word_timings=word_timings,
            viseme_events=viseme_events,
            meta={"tts_latency_ms": tts_latency_ms},
        )

    # ── Read API ───────────────────────────────────────────────────────────────

    def get_recent(self, n: int = 20) -> List[Dict[str, Any]]:
        """Return up to `n` most-recent utterances from today's JSONL."""
        records: List[Dict[str, Any]] = []
        p = self._jsonl_path(self._today())
        if not p.exists():
            return records
        try:
            lines = p.read_text(encoding="utf-8").strip().splitlines()
            for line in reversed(lines):
                line = line.strip()
                if not line:
                    continue
                try:
                    records.append(json.loads(line))
                except Exception:
                    pass
                if len(records) >= n:
                    break
        except Exception as exc:
            logger.warning("ConversationStore.get_recent: %s", exc)
        return records

    def find_by_id(self, uid: str) -> Optional[Dict[str, Any]]:
        """
        Search today's JSONL for utterance_id == uid.
        Falls back to yesterday if not found.
        """
        today = self._today()
        yesterday = (
            datetime.now(timezone.utc) - timedelta(days=1)
        ).strftime("%Y-%m-%d")
        for date_str in [today, yesterday]:
            p = self._jsonl_path(date_str)
            if not p.exists():
                continue
            try:
                for line in p.read_text(encoding="utf-8").splitlines():
                    line = line.strip()
                    if not line:
                        continue
                    try:
                        rec = json.loads(line)
                        if rec.get("utterance_id") == uid:
                            return rec
                    except Exception:
                        pass
            except Exception:
                pass
        return None

    def vacuum(self, days: int = 30) -> int:
        """
        Delete JSONL, index, and WAV directories older than `days` days.
        Returns total number of deleted files/directories.
        """
        cutoff = datetime.now(timezone.utc) - timedelta(days=days)
        deleted = 0

        # Store files
        try:
            for p in self._store_dir.iterdir():
                stem = p.stem if p.suffix == ".jsonl" else p.name.split(".")[0]
                try:
                    file_date = datetime.strptime(stem, "%Y-%m-%d").replace(
                        tzinfo=timezone.utc
                    )
                    if file_date < cutoff:
                        p.unlink(missing_ok=True)
                        deleted += 1
                except ValueError:
                    pass
        except Exception as exc:
            logger.warning("ConversationStore.vacuum store: %s", exc)

        # Audio directories
        try:
            for d in self._audio_dir.iterdir():
                if not d.is_dir():
                    continue
                try:
                    dir_date = datetime.strptime(d.name, "%Y-%m-%d").replace(
                        tzinfo=timezone.utc
                    )
                    if dir_date < cutoff:
                        shutil.rmtree(d, ignore_errors=True)
                        deleted += 1
                except ValueError:
                    pass
        except Exception as exc:
            logger.warning("ConversationStore.vacuum audio: %s", exc)

        logger.info(
            "ConversationStore.vacuum: deleted %d items older than %d days",
            deleted,
            days,
        )
        return deleted

    # ── Legacy import ──────────────────────────────────────────────────────────

    def import_legacy(self, paths: List[str]) -> Dict[str, int]:
        """
        Import legacy files into the new store layout.

        Supported types:
          *.txt / *.md  — each non-blank, non-comment line → one utterance
                          (role="legacy", provider="legacy", timing_mode="none")
          *.json        — tries TTS-response shape; falls back to raw text dump
          *.wav         — imported directly with text="[legacy audio: <name>]"
          *.mp3         — converted to WAV 24k mono via ffmpeg; text="[legacy audio: <name>]"

        Returns {str(path): count_migrated} dict.
        """
        summary: Dict[str, int] = {}
        for raw_path in paths:
            p = Path(raw_path)
            if not p.exists():
                logger.info(
                    "ConversationStore.import_legacy: not found: %s", p
                )
                summary[str(p)] = 0
                continue
            try:
                count = self._import_one(p)
                summary[str(p)] = count
                logger.info(
                    "ConversationStore.import_legacy: %s → %d records", p, count
                )
            except Exception as exc:
                logger.warning(
                    "ConversationStore.import_legacy failed for %s: %s", p, exc
                )
                summary[str(p)] = 0

        logger.info("ConversationStore.import_legacy summary: %s", summary)
        return summary

    def _import_one(self, p: Path) -> int:
        ext = p.suffix.lower()
        count = 0

        if ext in (".txt", ".md"):
            lines = self._safe_read_text(p).splitlines()
            for line in lines:
                line = line.strip()
                if not line or line.startswith("#"):
                    continue
                self.append_utterance(
                    role="legacy",
                    text=line,
                    provider="legacy",
                    timing_mode="none",
                    sample_rate=0,
                )
                count += 1

        elif ext == ".json":
            try:
                data = json.loads(p.read_text(encoding="utf-8"))
                if isinstance(data, dict):
                    text = str(
                        data.get("text") or data.get("input") or str(data)[:200]
                    )
                    wav_b64 = data.get("audio_wav_base64")
                    wav_bytes: Optional[bytes] = None
                    if wav_b64:
                        try:
                            wav_bytes = base64.b64decode(wav_b64)
                        except Exception:
                            pass
                    self.append_utterance(
                        role="legacy",
                        text=text,
                        provider=str(data.get("provider", "legacy")),
                        timing_mode=str(data.get("timing_mode", "none")),
                        sample_rate=int(data.get("sample_rate", 24000)),
                        wav_bytes=wav_bytes,
                        word_timings=data.get("word_timings", []),
                        viseme_events=data.get("viseme_events", []),
                    )
                    count = 1
                elif isinstance(data, list):
                    for item in data:
                        if isinstance(item, dict):
                            text = str(
                                item.get("text")
                                or item.get("input")
                                or str(item)[:200]
                            )
                            self.append_utterance(
                                role="legacy",
                                text=text,
                                provider=str(item.get("provider", "legacy")),
                                timing_mode=str(
                                    item.get("timing_mode", "none")
                                ),
                                sample_rate=int(
                                    item.get("sample_rate", 24000)
                                ),
                            )
                            count += 1
            except Exception as exc:
                logger.warning(
                    "import_legacy JSON parse error for %s: %s", p, exc
                )

        elif ext == ".wav":
            wav_bytes = p.read_bytes()
            self.append_utterance(
                role="legacy",
                text=f"[legacy audio: {p.name}]",
                provider="legacy",
                timing_mode="none",
                sample_rate=24000,
                wav_bytes=wav_bytes,
            )
            count = 1

        elif ext == ".mp3":
            try:
                with tempfile.NamedTemporaryFile(
                    suffix=".wav", delete=False
                ) as tf:
                    tmp_out = tf.name
                result = subprocess.run(
                    [
                        "ffmpeg",
                        "-y",
                        "-i",
                        str(p),
                        "-ar",
                        "24000",
                        "-ac",
                        "1",
                        "-f",
                        "wav",
                        tmp_out,
                    ],
                    capture_output=True,
                    timeout=30,
                )
                if result.returncode == 0:
                    wav_bytes = Path(tmp_out).read_bytes()
                    Path(tmp_out).unlink(missing_ok=True)
                    self.append_utterance(
                        role="legacy",
                        text=f"[legacy audio: {p.name}]",
                        provider="legacy",
                        timing_mode="none",
                        sample_rate=24000,
                        wav_bytes=wav_bytes,
                    )
                    count = 1
                else:
                    logger.warning("ffmpeg failed converting %s", p)
                    Path(tmp_out).unlink(missing_ok=True)
            except FileNotFoundError:
                logger.warning(
                    "ffmpeg not available — skipping MP3 import for %s", p
                )
            except Exception as exc:
                logger.warning("MP3 import failed for %s: %s", p, exc)

        return count


# ── Module-level singleton ─────────────────────────────────────────────────────
# Lazily initialised on first access; safe for hot-reload (uvicorn --reload)
# because module identity is preserved across reloads.

_store_instance: Optional[ConversationStore] = None
_store_lock = threading.Lock()


def get_store() -> ConversationStore:
    """Return (or create) the module-level ConversationStore singleton."""
    global _store_instance
    if _store_instance is None:
        with _store_lock:
            if _store_instance is None:
                _store_instance = ConversationStore()
    return _store_instance
