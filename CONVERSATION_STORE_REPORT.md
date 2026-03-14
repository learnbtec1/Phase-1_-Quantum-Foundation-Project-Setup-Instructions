# Conversation & Audio Store — Implementation Report
**Date:** 2026-03-14  
**Status:** ✅ ALL PASS

---

## 1. Changes Made

### NEW — `backend/app/services/conversation_store.py` (337 lines)
Unified transcript + audio persistence service with:
- `ConversationStore.__init__` — reads `STORE_DIR`/`AUDIO_DIR` env (defaults: `./data/store`, `./data/audio`)
- `append_utterance(...)` — atomic WAV write (`tmp → os.replace`), JSONL append, index update; protected by `threading.Lock`
- `append_from_response(...)` — helper that decodes base64 WAV and calls `append_utterance`
- `get_recent(n)` — reads today's JSONL in reverse
- `find_by_id(uid)` — searches today + yesterday
- `vacuum(days)` — deletes files older than N days
- `import_legacy(paths)` — ingests `.txt`, `.md`, `.json`, `.wav`, `.mp3` legacy artifacts
- Module-level `get_store()` singleton (double-checked locking, survives `uvicorn --reload`)

### PATCHED — `backend/app/api/v1/endpoints/tts_timing.py` (8 changes)
| # | Change | Detail |
|---|--------|--------|
| 1 | Import | Added `BackgroundTasks` to `fastapi` import |
| 2 | Import | Added `from app.services.conversation_store import get_store as _get_store` |
| 3 | Module-level | `_store = _get_store()` singleton with `try/except` guard |
| 4 | Handler signature | Added `background_tasks: BackgroundTasks` (FastAPI DI — invisible in OpenAPI schema) |
| 5–10 | 6× return points | Each `return TTSResponse(...)` replaced with: `_resp = TTSResponse(...); background_tasks.add_task(_store.append_from_response, ...); return _resp` |

### APPENDED — `backend/.env`
```ini
# =================================================================
# CONVERSATION STORE (transcript + audio persistence)
# =================================================================
STORE_DIR=./data/store   # JSONL transcripts + index files
AUDIO_DIR=./data/audio   # WAV audio files (24k mono)
```

### Docker — NO CHANGE NEEDED
Existing `./backend:/app` bind-mount in `docker-compose.yml` already maps `data/` output to host at `backend/data/`.

---

## 2. Storage Layout

```
backend/
└── data/
    ├── store/
    │   ├── 2026-03-14.jsonl          ← UTF-8 transcript (one JSON object per line)
    │   └── 2026-03-14.index.json     ← utterance_id → metadata lookup
    └── audio/
        └── 2026-03-14/
            └── <uid>.wav             ← 24kHz mono WAV
```

### JSONL Record Schema
```json
{
  "utterance_id": "43cd706e-1a54-4ead-9a70-c8fb694efcdf",
  "ts": "2026-03-14T...",
  "role": "assistant",
  "text": "مرحباً يا صديقي هذا اختبار للمخزن",
  "provider": "azure",
  "timing_mode": "approx",
  "sample_rate": 24000,
  "duration_ms": 3912,
  "wav_path": "data/audio/2026-03-14/43cd706e-1a54-4ead-9a70-c8fb694efcdf.wav",
  "word_count": 6,
  "viseme_count": 43,
  "meta": {"tts_latency_ms": 1265}
}
```

---

## 3. Acceptance Test Results

**Test run:** 2026-03-14 (venv311 Python, native uvicorn on :8000)

| Check | Details | Result |
|-------|---------|--------|
| `/api/health` | `ok=True  last_tts_ms=1265` | ✅ PASS |
| TTS POST response | `provider=azure  format=wav  timing_mode=approx  words=6  visemes=43` | ✅ PASS |
| `data/store/2026-03-14.jsonl` | EXISTS — 385 lines after smoke run | ✅ PASS |
| `data/store/2026-03-14.index.json` | EXISTS — 385 entries | ✅ PASS |
| `data/audio/2026-03-14/<uid>.wav` | EXISTS — 187 846 B (≈183 KB, 3.9 s speech) | ✅ PASS |
| `import_legacy` | 5 files ingested: `amir_eval_log.txt`(54), `backend_log.txt`(239), `eval_result.txt`(15), `requirements.txt`(24), `tmp_aab.txt`(51) | ✅ PASS |

**Overall: ALL PASS**

---

## 4. Design Notes

- **Non-disruptive**: `BackgroundTasks` fires after HTTP response — zero latency impact on TTS calls
- **Thread-safe**: `threading.Lock` guards all file I/O; WAV writes use atomic `tmp → os.replace`
- **Fault-tolerant**: `_store = None` guard in `tts_timing.py` means a store init failure does not break TTS
- **Daily rotation**: Files roll over automatically at midnight (based on `date.today()`)
- **API schema unchanged**: `BackgroundTasks` is pure FastAPI DI; not reflected in OpenAPI docs

---

## 5. Files Changed

| File | Operation | Size |
|------|-----------|------|
| `backend/app/services/conversation_store.py` | **NEW** | 337 lines |
| `backend/app/api/v1/endpoints/tts_timing.py` | PATCHED (8 changes) | — |
| `backend/.env` | APPENDED (STORE_DIR + AUDIO_DIR) | +6 lines |
| `docker-compose.yml` | **NO CHANGE** | — |
