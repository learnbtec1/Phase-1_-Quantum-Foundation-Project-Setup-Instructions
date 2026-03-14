# APPLY GUIDE — Verona Avatar Hardened v3 + Angelic Voice Integration
> **Patch set**: WS v1 protocol · VRM fallback chain · TTS circuit breaker · STT hardening · PDF reports repository  
> **Applies to**: `frontend/` (Next.js 14) + `backend/` (FastAPI / Python 3.11+)

---

## Files Changed in This Patch Set

| File | Change |
|------|--------|
| `frontend/src/config/avatar.ts` | Added WS/voice protocol constants |
| `frontend/src/hooks/useAgentAgent.ts` | Heartbeat watchdog, TTS circuit breaker, `req_id` stamping |
| `frontend/src/app/avatar-agent/AvatarCanvas.tsx` | Recursive VRM fallback chain |
| `frontend/.env.example` | Added Avatar VRM + feature flag vars |
| `backend/app/services/settings.py` | **NEW** — runtime config from env |
| `backend/app/api/v1/endpoints/agent_ws.py` | `v:1` frames, heartbeat sender, pong handler, `req_id` threading |
| `backend/app/services/whisper_stt.py` | `STTError`, `validate_audio()`, structured logging |
| `backend/repository/evaluations.py` | `get_by_student()` + `get_all_by_student()` on Protocol + both impls |
| `backend/requirements.txt` | Added `reportlab`, `arabic-reshaper`, `python-bidi`, `psycopg2-binary` |
| `backend/.env.example` | Added STT config block + WS heartbeat block |

---

<!-- PREVIOUS GUIDE CONTENT BELOW (retained for reference) -->
## نظرة عامة (المرجعية السابقة)

هذا الدليل يشرح خطوة بخطوة كيفية دمج التغييرات وتشغيل منصة NEXUS مع:
- **الجزء 1**: التحسينات الأمامية (verona.vrm، fallback، وضع التفكير)
- **الجزء 2**: تدفق STT (transcribing، transcript، grade_result)
- **الجزء 3**: الذاكرة الدائمة (PostgreSQL + Repository)

---

## 1. نسخ الملفات والهيكل

تأكد من وجود الملفات التالية:

```
backend/
├── app/
│   ├── repository/
│   │   ├── __init__.py
│   │   └── evaluations.py
│   ├── database.py
│   ├── models/
│   │   ├── __init__.py
│   │   └── db_models.py
│   └── api/v1/endpoints/
│       ├── assessment.py
│       └── agent_ws.py
├── alembic/
│   ├── env.py
│   ├── script.py.mako
│   └── versions/
│       └── 001_initial_nexus_tables.py
├── alembic.ini
├── requirements.txt
└── .env.example

frontend/
├── src/
│   ├── app/
│   │   ├── avatar-agent/
│   │   │   ├── AvatarCanvas.tsx
│   │   │   └── AvatarAgentClient.tsx
│   │   ├── assessment/
│   │   │   └── page.tsx
│   │   └── api/
│   │       ├── evaluate/
│   │       │   └── route.ts
│   │       └── evaluate-multi-file/
│   │           └── route.ts
│   └── hooks/
│       └── useAgentAgent.ts

docker-compose.yml
```

---

## 2. إعداد البيئة

### 2.1 Backend

```bash
cd backend
cp .env.example .env
# عدّل .env وأضف قيم postgres إذا USE_DB=true:
# POSTGRES_USER=nexus
# POSTGRES_PASSWORD=nexus_secret
# POSTGRES_DB=nexus_db
# USE_DB=false   # ابدأ بهذا للتحقق
```

### 2.2 تثبيت الحزم

```bash
pip install -r requirements.txt
```

---

## 3. تشغيل قاعدة البيانات (اختياري)

للذاكرة الدائمة:

```bash
# من جذر المشروع
docker-compose up -d db

# انتظر حتى يصبح صحيًا
docker-compose ps

# نفّذ migrations
cd backend
alembic upgrade head
```

---

## 4. تفعيل الميزات

### 4.1 بدون قاعدة بيانات (افتراضي)

```env
USE_DB=false
```

- التقييمات تُخزّن مؤقتاً في الذاكرة
- الاستجابة تحتوي `ephemeral: true` و `evaluation_id` (UUID عشوائي)

### 4.2 مع PostgreSQL

```env
USE_DB=true
DATABASE_URL=postgresql://nexus:nexus_secret@localhost:5432/nexus_db
```

- تأكد من تشغيل `docker-compose up -d db`
- نفّذ `alembic upgrade head`
- أعد تشغيل الخادم

---

## 5. تشغيل التطبيق

```bash
# Backend
cd backend
uvicorn app.main:app --reload --host 0.0.0.0 --port 8000

# Frontend (في نافذة أخرى)
cd frontend
npm run dev
```

---

## 6. اختبار سريع يدوي

1. **افتح الصفحة** `/avatar-agent`
   - تأكد من ظهور فيرونا (أو teach.vrm كـ fallback)
   - تأكد من وضع التفكير عند التحدث

2. **تحدث بالميكروفون**
   - تحقق من ظهور "تفكر..." وحركة الرقبة
   - بعد النسخ، تحقق من ظهور النص

3. **انتقل إلى صفحة التقييم** `/assessment`
   - أرسل إجابة
   - تحقق من ظهور التصحيح وعودة فيرونا لوضعها الطبيعي

4. **إعادة تحميل الصفحة** (مع USE_DB=true)
   - تحقق من بقاء النتيجة في localStorage
   - مع Postgres، يمكن استرجاع التقييم من `evaluation_id`

---

## 7. قائمة التحقق من عدم الانحدار

| البند | التحقق |
|-------|--------|
| لا أخطاء TypeScript | `npm run build` بدون `any` |
| إطارات WebSocket مُعالَجة | لا رسائل "unhandled" في console |
| التنفس يستمر أثناء التفكير | الحركات إضافية (additive) |
| الرمش عشوائي | 3–6 ثوانٍ |
| العيون لا تثبت | micro-saccades |
| USE_DB=false | التقييمات فورية دون انتظار DB |
| USE_DB=true | البيانات تُحفظ وتُستعاد |
| الصوت قصير (<0.4 ثانية) | يُرفض بهدوء |
| لا memory leaks | مراجعة useFrame |

---

## 8. استكشاف الأخطاء

### قاعدة البيانات غير متاحة (503)

```
قاعدة البيانات غير متاحة، يرجى التحقق من الإعدادات.
```

- تأكد من `docker-compose up -d db`
- تحقق من `DATABASE_URL` في `.env`
- نفّذ `alembic upgrade head`

### فيرونا لا تظهر

- تأكد من وجود `/models/verona.vrm` أو `/models/teach.vrm` في `public/`
- راجع console للأخطاء

### التقييم لا يُحفظ

- مع USE_DB=false: طبيعي (ephemeral)
- مع USE_DB=true: تحقق من اتصال Postgres وسجلات الخادم

---

## 9. الملفات المُعدّلة

| الملف | التغييرات |
|-------|------------|
| `AvatarAgentClient.tsx` | VERONA_VRM، TEACH_VRM، fallback |
| `AvatarCanvas.tsx` | fallbackVrmUrl، تحميل verona/teach |
| `useAgentAgent.ts` | isTranscribing، readLastGrade، grade_result، transcribing/transcript |
| `whisper_stt.py` | 0.4 s minimum، initial_prompt |
| `agent_ws.py` | v:1، id، transcribing/transcript/error frames |
| `assessment.py` | student_id، repository، evaluation_id |
| `evaluate/route.ts` | evaluation_id، ephemeral |
| `assessment/page.tsx` | evaluation_id في saveLastGrade |
| `repository/evaluations.py` | Protocol، InMemory، Postgres |
| `database.py` | engine، SessionLocal |
| `models/db_models.py` | users، assignments، evaluations |

---

## Hardened v3 — Step-by-Step Apply Guide

### Step 1 — Install Python Dependencies

```bash
cd backend
pip install -r requirements.txt
```

New packages added by this patch set:

| Package | Purpose |
|---------|---------|
| `reportlab>=4.0.0` | PDF report generation |
| `arabic-reshaper>=3.0.0` | Arabic text shaping for PDF |
| `python-bidi>=0.4.2` | RTL bi-directional text for PDF |
| `psycopg2-binary>=2.9.0` | PostgreSQL driver (`USE_DB=true`) |

> GPU users: set `WHISPER_DEVICE=cuda` and `WHISPER_COMPUTE=float16` in `.env`.

---

### Step 2 — Configure Environment Variables

**Backend** — append to `backend/.env`:

```env
# STT
WHISPER_DEVICE=cpu
WHISPER_COMPUTE=int8
STT_MIN_MS=400
STT_MAX_MB=8
STT_MIME_OK=audio/webm,audio/ogg,audio/wav,audio/mp4

# WebSocket heartbeat
HEARTBEAT_INTERVAL_SEC=15
```

**Frontend** — append to `frontend/.env.local`:

```env
# Leave blank → uses VRM_FALLBACKS chain automatically
NEXT_PUBLIC_AVATAR_VRM_URL=

# Avatar humanization feature flags
NEXT_PUBLIC_USE_HUMANIZATION=true
NEXT_PUBLIC_USE_IK=false
NEXT_PUBLIC_USE_CAMERA_GAZE=false
NEXT_PUBLIC_USE_VISEME_PREDICT=false
```

---

### Step 3 — Place VRM Model Files

```
frontend/public/models/verona.vrm    ← primary avatar
frontend/public/models/teach.vrm     ← teacher variant (auto-fallback)
```

Set `NEXT_PUBLIC_AVATAR_VRM_URL` to a custom URL to override the chain entirely.

---

### Step 4 — Database Migrations (if `USE_DB=true` only)

```bash
docker-compose up -d db
cd backend
alembic upgrade head
```

Default (`USE_DB=false`) — skip this step entirely.

---

### Step 5 — Start the Backend

```bash
cd backend
uvicorn app.main:app --reload --host 127.0.0.1 --port 8000
```

Health check: `curl http://127.0.0.1:8000/`

---

### Step 6 — Start the Frontend

```bash
cd frontend
npm install   # first time
npm run dev   # → http://localhost:3000
```

Type-check before production deploy: `npm run type-check`

---

### Step 7 — Acceptance Checklist

| # | Item | Expected Result |
|---|------|----------------|
| A | Remove `verona.vrm`, reload avatar page | Console: `[VRM] Trying fallback 1: …teach.vrm` → avatar loads |
| B | Remove all VRM files | Console: `[VRM] All candidates exhausted` → error UI, no crash |
| C | Watch backend logs every ~15 s | `[WS_FRAME_SENT] type=heartbeat id=hb` appears |
| D | Stop backend, wait 40 s | Console: `[Verona WS] Missed 2 heartbeats — forcing reconnect` |
| E | Use invalid `OPENAI_API_KEY`, trigger TTS twice | Console: `[Verona TTS] Circuit OPEN until <ts>` after 2 failures |
| F | Send mic tap (<400 ms) | WS error frame: `{"type":"error","code":"too_short","id":"r…"}` |
| G | Speak a phrase, inspect WS frames | `transcribing` and `transcript` frames echo same `id` as audio frame |
| H | `python -c "from repository.evaluations import InMemoryEvaluationRepository; r=InMemoryEvaluationRepository(); print(r.get_by_student('x'))"` | Prints `[]` with no errors |

---

### Rollback

All changes are additive. Restore any file from git:

```bash
git checkout HEAD -- frontend/src/hooks/useAgentAgent.ts
git checkout HEAD -- frontend/src/app/avatar-agent/AvatarCanvas.tsx
git checkout HEAD -- backend/app/api/v1/endpoints/agent_ws.py
git checkout HEAD -- backend/app/services/whisper_stt.py
git checkout HEAD -- backend/repository/evaluations.py
# Remove the new settings module if desired:
del backend\app\services\settings.py
```

`agent_ws.py` and `whisper_stt.py` both contain inline fallbacks — they continue functioning without `settings.py`.
