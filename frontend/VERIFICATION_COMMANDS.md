# Verification Commands

Run from project root:

```bash
cd frontend
npm install
npm run dev
```

Then open: **http://localhost:3000/evaluate** (dev server listens on port **3000** per `frontend/package.json`).

- Avatar loads from `/models/teacher.vrm` (place file in `frontend/public/models/teacher.vrm` if missing).
- Click **Say Hello** to hear TTS.
- Use microphone to speak (auto-sends when speech is recognized).
- Type and click **Send** for chat; reply is spoken via TTS.

Backend must be running with `OPENAI_API_KEY` in `.env` (e.g. `uvicorn app.main:app --reload --host 127.0.0.1 --port 8000`). Set `NEXT_PUBLIC_API_URL=http://127.0.0.1:8000` if you use another host/port.
