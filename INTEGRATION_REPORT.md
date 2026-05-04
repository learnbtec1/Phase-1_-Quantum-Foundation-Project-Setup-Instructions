# TalkMateAI Integration Report

## Summary

TalkMateAI features have been integrated into the Quantum Foundation project:

- **Whisper STT** – Speech-to-text via backend (replaces Web Speech API when available)
- **Kokoro TTS** – Text-to-speech with word-level timing for lip-sync
- **Timing-based lip-sync** – Avatar mouth movements driven by phoneme timings from Kokoro

Existing behavior is preserved: chat, XR, simulation gating, emotion engine, head tracking, and gestures.

---

## What Was Integrated

### Backend (FastAPI)

| File | Purpose |
|------|---------|
| `backend/app/services/whisper_stt.py` | Whisper STT service (faster-whisper or openai-whisper) |
| `backend/app/services/kokoro_tts.py` | Kokoro TTS with word-level timing |
| `backend/app/api/v1/endpoints/stt.py` | `POST /api/v1/stt` – transcribe audio |
| `backend/app/api/v1/endpoints/tts_timing.py` | `POST /api/v1/tts-with-timing` – TTS + word timings |
| `backend/app/main.py` | Registers STT and TTS routers |

**STT:** Accepts multipart form with `audio` file (WAV or raw 16-bit PCM mono). Returns `{ transcript: string }`.

**TTS-with-timing:** Accepts `{ text, voice?, speed? }`. Returns `{ audio_base64, word_timings, sample_rate }`.

### Frontend (Next.js)

| File | Purpose |
|------|---------|
| `frontend/src/ai/lipsync/timing.ts` | Map word timings to viseme weights |
| `frontend/src/ai/io/sttWhisper.ts` | MediaRecorder-based recording + Whisper STT |
| `frontend/src/ai/io/tts.ts` | `fetchTTSWithTiming()` + WAV encoding for Kokoro |
| `frontend/src/app/api/stt/route.ts` | Proxy to backend STT |
| `frontend/src/app/api/tts-with-timing/route.ts` | Proxy to backend TTS-with-timing |
| `frontend/src/components/avatar/VRMAvatar.tsx` | Timing-based lip-sync when timings provided |
| `frontend/src/components/ui/Chat.tsx` | Whisper STT mic, TTS-with-timing for replies |

---

## How to Test

### 1. Backend Setup (Optional – for STT/TTS)

```bash
cd backend
pip install faster-whisper  # or: pip install openai-whisper
pip install kokoro numpy torch  # for Kokoro TTS
```

If these are not installed, the app still runs: STT falls back to Web Speech API, TTS falls back to ElevenLabs.

### 2. Run Backend

```bash
cd backend
uvicorn app.main:app --reload --host 127.0.0.1 --port 8000
```

### 3. Run Frontend

```bash
cd frontend
npm install
npm run dev
```

### 4. Test on /evaluate

1. **Text chat:** Type a message and send. The avatar should speak with lip-sync:
   - If Kokoro is available: timing-based lip-sync
   - Otherwise: ElevenLabs TTS + procedural lip-sync

2. **Microphone (Whisper):** Click the mic button to start recording, click again to stop. The transcript is sent to the backend and inserted into the input. If Whisper is unavailable, Web Speech API is used.

3. **Existing features:** Head tracking, emotions, XR, simulation gating, and wave gesture should behave as before.

---

## Environment

- `NEXT_PUBLIC_API_URL` – Backend base URL (canonical: `http://127.0.0.1:8000` — must match Compose / `docker-compose.yml`)
- `ELEVENLABS_API_KEY` – For fallback TTS when Kokoro is not used

---

## Known Limitations

1. **Kokoro / Whisper optional:** App runs without them; fallbacks are used.
2. **Whisper STT:** Requires `faster-whisper` or `openai-whisper` on the backend.
3. **Kokoro TTS:** Requires `kokoro` and `torch`; first load can be slow.
4. **Vision module:** SmolVLM2 vision was not integrated (optional per plan).
5. **Arabic:** Whisper is configured for Arabic (`language="ar"`); Kokoro uses auto language.

---

## Fallback Behavior

| Feature | Primary | Fallback |
|---------|---------|----------|
| STT | Whisper (backend) | Web Speech API |
| TTS | Kokoro (with timings) | ElevenLabs |
| Lip-sync | Timing-based (Kokoro) | Procedural (amplitude) |
