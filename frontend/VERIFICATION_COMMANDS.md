# Verification Commands

Run from project root:

```bash
cd frontend
npm install
npm run dev
```

Then open: **http://localhost:3011/evaluate**

- Avatar loads from `/models/teacher.vrm` (place file in `frontend/public/models/teacher.vrm` if missing).
- Click **Say Hello** to hear TTS.
- Use microphone to speak (auto-sends when speech is recognized).
- Type and click **Send** for chat; reply is spoken via TTS.

Backend must be running with `OPENAI_API_KEY` in `.env` (e.g. `uvicorn app.main:app --reload --port 8000`). Set `NEXT_PUBLIC_API_URL=http://localhost:8000` if backend is on another port.
