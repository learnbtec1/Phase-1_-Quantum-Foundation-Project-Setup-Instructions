# Local development environment recovery — agent prompt

Paste the block below **as-is** into your AI agent (Composer / Chat) when you need a systematic recovery pass for this repo.

---

You are a senior full-stack engineer specialized in real-time AI systems.

Your task is to fully recover a frozen local development environment for a Next.js + WebSocket + Docker-based AI avatar platform.

Follow these steps strictly and fix all issues automatically:

1. Detect and kill any processes using port 3000:
   - Use system commands (Windows: netstat/taskkill)
   - Ensure the port is fully freed

2. Verify Docker Engine health:
   - Run `docker info`
   - If Docker returns errors (500 or engine issues), restart Docker Desktop
   - If still failing, reset Docker to factory defaults

3. Restart WSL environment:
   - Execute `wsl --shutdown`
   - Restart Docker after WSL is back

4. Fix Docker compose issues:
   - Ensure all required images (e.g., `redis:7-alpine`) can be pulled
   - Run `docker pull redis:7-alpine`
   - Then run `docker compose up --build`
   - Wait until all services are healthy

5. Validate backend services:
   - Ensure WebSocket server is running and reachable
   - Log connection attempts and failures clearly

6. Restart frontend (Next.js):
   - Ensure no port conflicts
   - Run `npm run dev`
   - Confirm the app is accessible at localhost

7. Fix infinite loading / stuck state:
   - Add timeout to WebSocket connections
   - Prevent infinite reconnect loops
   - Ensure all async calls resolve or fail properly

8. Validate audio pipeline:
   - Ensure `AudioContext` is resumed
   - Ensure TTS service is reachable
   - Confirm audio playback works
   - Confirm viseme timeline is triggered

9. Add diagnostic logging:
   - Log each step: `WS_CONNECT`, `MIC_ACCESS`, `AUDIO_CONTEXT`, `TTS`
   - Print errors with stack traces

10. Final validation checklist:
    - Frontend loads without infinite spinner
    - WebSocket connects successfully
    - No console errors
    - Avatar responds
    - Audio plays correctly

If any step fails, identify the exact root cause and fix it before proceeding.

Do not skip steps. Do not assume success. Verify everything.

Return a final status report: **SUCCESS** or **FAILURE** with reasons.

---

## ما الذي يفعّله هذا البرومبت عمليًا؟

- يقتل أي process عالق على المنفذ 3000 (مثل الذي واجهته).
- يصلّح تشخيص Docker (رسائل خطأ من الـ engine).
- يعيد تشغيل سياق WSL عند الحاجة.
- يشغّل backend + frontend عبر Compose والتحقق من الصحة.
- يوجّه لتقليل حلقات الـ loading (WebSocket + async).
- يفحص مسار الصوت وTTS والـ visemes.
- يفرض تشخيصًا خطوة بخطوة بدل التخمين.

---

## ملاحظة لهذا المستودع

- للتشخيص الاختياري عند الإقلاع أنظر: `NEXT_PUBLIC_COGNI_BOOT_DIAGNOSTICS` في `frontend/.env.example`.
- إيقاف المنفذ 3000 محليًا يمكن أيضًا استخدام `npm run clean:port` من جذر المشروع أو من `frontend/`.
