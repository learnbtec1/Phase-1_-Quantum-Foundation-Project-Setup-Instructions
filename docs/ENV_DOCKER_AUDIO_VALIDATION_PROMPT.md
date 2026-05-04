# Full validation prompt — ENV + Docker + audio (agent)

Paste the block below **as-is** into your AI agent (Composer / Chat) when you need a deterministic audit of **root `.env`**, **Docker Compose**, **FastAPI**, **Next.js**, **WebSocket**, and **TTS**.

For **automated first-pass checks** (no assumptions), run from repo root:

```bash
npm run check:dev-env
# or:
node scripts/check-dev-env.mjs
```

---

You are a senior DevOps engineer.

Validate **one root `.env` file** consumed by Docker Compose, FastAPI (`backend`), and Next.js (`frontend` BFF + browser-public vars).

**Do not assume anything. Test everything** you can from the CLI; where you cannot probe (browser AudioContext), list **exact repro steps** and expected signals.

Follow these steps in order:

## 1) Environment variables (root `.env`)

- Confirm the file exists at the **repository root** (same folder as `docker-compose.yml`).
- Parse all `KEY=value` assignments (respect `#` comments, quoted values, continuation if any).
- **Detect duplicate keys**: if the same variable is defined twice, report both line contexts; state which wins for Docker Compose / your loader.
- **Required for this stack when using `docker compose` as written**:
  - `JWT_SECRET` — non-empty (**Compose marks it mandatory** via `${JWT_SECRET:?}`).
- **Conditional — ElevenLabs (cloud-safe TTS)**:
  If `NEXT_PUBLIC_TTS_PROVIDER=elevenlabs` **or** `TTS_PROVIDER=elevenlabs` (backend), validate:
  - `ELEVENLABS_API_KEY` non-empty
  - `ELEVENLABS_VOICE_ID` non-empty (voice must allow API synthesis on your plan)
  - Optional: `ELEVENLABS_MODEL_ID`
- **WebSocket URL coherence**:
  - `NEXT_PUBLIC_WS_URL` and/or `NEXT_PUBLIC_AGENT_WS`: must be a valid `ws://` or `wss://` URL ending with **`/ws/agent`** for this codebase (unless you intentionally use a gateway path — document deviation).
  - **Browser vs Docker hostname**: URLs like `ws://backend:8000/...` are **wrong from the browser**; host must reach the machine where the browser runs (typically `127.0.0.1` mapped ports).
  - **`NEXT_PUBLIC_*` are build-time inlined in Next**: changing them requires **restart/rebuild** the Next process consuming them.
- **Edge TTS caveat**: Default `NEXT_PUBLIC_TTS_PROVIDER=edge` / `TTS_PROVIDER=edge` uses Microsoft Edge online TTS; **datacenter / cloud egress IPs often get HTTP 403** on handshake. If synthesis must work remotely, mandate **ElevenLabs** end-to-end and verify keys exist on **frontend** Compose service too.

## 2) Docker

- Run `docker info`; fail fast if daemon unreachable.
- Run `docker compose config` — must exit **0** (validates interpolated env + YAML).
- Run `docker compose up -d` (or `-d --build` if images stale); wait until **`backend`**, **`db`**, **`redis`** are **running** (`docker compose ps` / health).
- Confirm **published ports align with `.env` expectations**:
  - API/WebSocket commonly **host `8000` → backend `8000`**.
  - Frontend dev **host `3000`**.
  - Optional `avatar_brain` **8011**, optional Chroma **8010**.

## 3) Backend (FastAPI)

- **HTTP**: `GET` `/api/health` on the resolved API base (**browser-reachable**, e.g. `http://127.0.0.1:8000/api/health`) — expect success body / 200.
- **WebSocket**: open `NEXT_PUBLIC_WS_URL` (guest mode if JWT absent must match Compose `COGNI_WS_ALLOW_ANONYMOUS` parity). Fail with **exact close code/reason** if handshake fails.

## 4) Frontend (Next.js)

- Confirm the running Next process exposes env (server-only vs `NEXT_PUBLIC_*`).
- Confirm **same WebSocket URL** in browser logs matches `.env`.

## 5) Audio / TTS

- When policy is ElevenLabs, confirm **upstream path** hits ElevenLabs (Next `/api/tts-elevenlabs` **direct keys** preferred on cloud IPs, or backend `TTS_PROVIDER=elevenlabs` with keys).
- **Success criteria**: audible playback starts, **no** recurring `tts_unavailable` + **no** `[edge_forbidden]` in BFF payloads.
- **`speak:start` lifecycle**: `avatar:speak:start` must precede audible path; stray `speak:end` logs without start indicate broken TTS or cleanup ordering.

## 6) Error taxonomy (explicit)

| Symptom | Likely tier |
|---------|--------------|
| Missing `JWT_SECRET` | ENV / Compose |
| Duplicate keys / wrong host in `NEXT_PUBLIC_WS_URL` | ENV |
| Containers exit / unhealthy | Docker / Compose |
| `502` / `[edge_forbidden]` on TTS while `TTS_PROVIDER=edge` | Network / Edge block — fix provider + keys |
| WS connects but **`tts_unavailable`** | Backend WS TTS pipeline or entitlement |
| ElevenLabs 401/402/plan limits | ElevenLabs config |
| ENV correct, Docker healthy, synth still absent | Application code (**TTS BFF**, **AgentDirector**, **`useAgentAgent`**) |

---

## Final output format

Return **SUCCESS** or **FAILURE**.

- List **exact root cause(s)** with file names, keys, URLs, ports, commands, HTTP status codes, and WebSocket close codes.
- Separate **validated by command** vs **requires manual UI check**.
- Do **not** claim success if any checklist item fails.

---

## إطار العربية (تلخيص)

- هذا البرومبت يوجّه وكيلاً ليشغّل فحصًا حقيقيًا (قراءة `.env`، `docker compose`، `/api/health`، المصافحة، ثم سياسة TTS).
- **إذا توافقت كل المتغيرات والحاويات وما زال الصوت لا يعمل**، نُحيل التفسير لتسلسل الشيفرة: **مسار WS → `tts_unavailable` → `speakWithTTS` / Edge vs ElevenLabs / lip-sync payloads** — هذه النقطة منطقيًا «بعد الانتهاء من الدمج البيئي».

---

## مستودع Cogni فقط — مرجع سريع

| Variable | Purpose |
|----------|---------|
| `JWT_SECRET` | Compose **required** |
| `NEXT_PUBLIC_WS_URL`, `NEXT_PUBLIC_AGENT_WS` | Browser agent WS (**host-reachable**) |
| `NEXT_PUBLIC_API_URL` | Browser → API (**host**) |
| `NEXT_PUBLIC_TTS_PROVIDER` | `edge` \| `elevenlabs` (Next build-time semantics) |
| `TTS_PROVIDER` | Backend `edge` \| `auto` \| `elevenlabs` |
| `ELEVENLABS_*` | Set on **frontend** Compose service **and** backend when using ElevenLabs |
