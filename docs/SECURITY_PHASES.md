# Security phases (EDUVERSE) — phases 4–5 notes

## Phase 4 — Frontend (Next.js)

- **JWT in `localStorage`** remains readable by any script that runs in the page origin. Mitigate XSS via **HTML sanitization** (e.g. curriculum preview) and a **Content Security Policy** (start with `Content-Security-Policy-Report-Only`, then enforce with `CSP_ENFORCE=true` in the Next build env). Long-term, prefer **HttpOnly, Secure, SameSite** session cookies for tokens (not implemented in this pass).
- CSP and header defaults live in `frontend/next.config.js`. Adjust `connect-src` if you add new third-party APIs.

## Phase 5 — Backend (FastAPI)

- **`ALLOWED_HOSTS`**: In `ENVIRONMENT=production`, set a comma-separated list of hostnames so `TrustedHostMiddleware` can reject unexpected `Host` headers.
- **`RATE_LIMIT_STRICT_REDIS`**: With **multiple replicas**, in-memory rate limits are not shared. Use **Redis** and set `RATE_LIMIT_STRICT_REDIS=true` in production when Redis is required for correct limiting (`app/core/rate_limit.py`).
- **`COGNI_WS_ALLOW_ANONYMOUS`**: Must be **`false` in production**; startup fails otherwise (`app/core/config.py`).

## CI

- Default backend tests: `pytest -m "not e2e"` (excludes tests marked `e2e`, including `/ws/agent` TestClient cases).
- WebSocket TestClient suite: set `COGNI_WS_E2E=1` and run `pytest -m e2e tests/test_voice_pipeline.py` (guest `/ws/agent` is enabled for that module only). Audio cases also need `faster-whisper` installed or they skip.

## صيانة / Maintenance

- Periodically run dependency review, e.g. from `backend/`:  
  `pip install pip-audit && pip-audit -r requirements.txt`  
  Address reported issues and re-lock or cap versions as needed.
