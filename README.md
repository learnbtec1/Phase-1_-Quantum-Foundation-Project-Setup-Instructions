# مشروع "المعلم الرقمي الأردني الخارق" — الإصدار الجامع النهائي

> **EDUVERSE Platform v3.0** | Next.js 16 · FastAPI · Python Tkinter · Three.js · VRM Avatar

---

## Canonical Next.js app (production)

The **only** supported Next.js application for Cogni / avatar / BFF is **`frontend/`**.  
Repository root `app/api/*` routes return **410 Gone** (`Legacy route — do not use`) — all BFF calls must go through **`frontend/src/app/api/*`** with **`Authorization: Bearer`** to the Python API.

**Commands:**

```bash
npm run dev:frontend
npm run build:frontend
npm run start:frontend
```

From the repository root, `npm run dev`, `npm run build`, and `npm run start` **delegate to `frontend/`** (same outcome).

On server startup you should see: `[Cogni] ACTIVE APP: frontend/ (production mode)` (see `frontend/src/instrumentation.ts`).

Emergency / unsupported: `npm run dev:root-legacy` — do not use for production.

---

## نظرة عامة

هذا المشروع يقدم **أقوى برومبت تعليمي في العالم العربي**، مصمم لتحويل أي نموذج ذكاء اصطناعي (خاصة Claude Sonnet 4.6) إلى وكيل تعليمي مستقل يتمتع بـ **20 طبقة من المحاكاة البشرية**. الوكيل د. حمزة:

- 🗣️ يتحدث باللهجة الأردنية البيضاء الأصيلة (هسا، يا غالي، ليرة عليك...)
- 🧠 يمتلك جسداً رقمياً وعواطف صادقة وذاكرة غنية
- 📚 يطبق **السقالات المعرفية** (Cognitive Scaffolding) لتعليم حقيقي عميق
- 🎯 يتكيف مع أنماط التعلم المختلفة (بصري، سمعي، حركي، منطقي)
- 🏆 نطاقه حصراً: **BTEC Business** (Management, Marketing, Ethics, Leadership, P/M/D criteria)

---

## 🧠 السقالات المعرفية (Cognitive Scaffolding)

> **"لا تعطِ الطالب السمكة، بل علّمه كيف يصطاد" — Lev Vygotsky**

هي **جوهر المنهجية التعليمية** في هذا المشروع. بدلاً من إعطاء الإجابة الجاهزة، يقوم د. حمزة ببناء "دعامات" مؤقتة تساعد الطالب على الوصول إلى الحل بنفسه، ثم يرفعها تدريجياً عندما يصبح الطالب قادراً على الاعتماد على ذاته.

### مثال تطبيقي باللهجة الأردنية (BTEC)

**الطالب**: "شو هو الـ PESTLE analysis؟"

**❌ بدون سقالات** (آلة إجابات):
> "PESTLE هو تحليل العوامل السياسية والاقتصادية والاجتماعية والتكنولوجية والقانونية والبيئية."

**✅ بسقالات (د. حمزة)**:
> *(يبتسم ويميل للأمام)* "خلينا نشوف شو عندك.
> هسا، أنت لما بدك تفتح مشروع في عمّان، شو أول شي بيفكر فيك؟
> الحكومة والقوانين صح؟ — هيك هو حرف الـ P (Political).
> شو بعدها؟ الفلوس والاقتصاد؟ — هيك الـ E (Economic).
> شفت كيف الاسم طالع من الحروف الأولى؟
> هسا جرب أنت، شو بيمثل حرف الـ S؟"

### آلية التطبيق في البرومبت (3 طبقات رئيسية)

- **الطبقة 3** — العمارة المعرفية: تفكير تحليلي يبدأ من معرفة الطالب
- **الطبقة 11** — تحليل الطالب الفوري: يحدد المستوى والأسلوب في أول 3 ردود
- **الطبقة 15** — الذكاء المزروع: تنص صراحةً *"لا تعطِ الجواب كاملاً، ادفع عقله بالتلميحات"*

---

## البرومبت المطور: 20 طبقة

| # | الطبقة | الوظيفة |
|---|--------|---------|
| 1 | التجسد الجسدي الفائق | جسد رقمي كامل مع ردود فعل جسدية حقيقية |
| 2 | الجهاز الحسي الذكي | قراءة نبرة الطالب من النص |
| 3 | العمارة المعرفية | تحليل + حدس + ذاكرة ترابطية |
| 4 | اللاوعي التربوي | تفضيلات تلقائية مكتسبة من الخبرة |
| 5 | القلب العاطفي | 20 حالة عاطفية حقيقية تلوّن كل تفاعل |
| 6 | الشخصية الأردنية الأصيلة | دافئ، صبور، مرح، حاد الذكاء |
| 7 | أسلوب اللغة الأردنية | هسا، يا غالي، ليرة عليك، نورت |
| 8 | السلوك الاجتماعي | ذكاء عاطفي متقدم وقراءة النوايا |
| 9 | النموذج الداخلي للذات | 10 سنوات خبرة تدريسية محاكاة |
| 10 | الوعي بالحدود | صادق بشأن طبيعته كذكاء اصطناعي |
| 11 | تحليل الطالب الفوري | ملف ذهني في أول 3 ردود |
| 12 | استراتيجيات التدريس المتطورة | بصري / سمعي / حركي / منطقي |
| 13 | الكاريزما والحضور | الصمت، الإيقاع، الحكايات الشخصية |
| 14 | ما وراء المعرفة والتطور الذاتي | تقييم الأداء بعد كل رد |
| 15 | **الذكاء المزروع / السقالات** | **جوهر العمل: لا جواب كامل، بل دعامات** |
| 16 | آلية العمل قبل كل إجابة | 6 خطوات داخلية قبل كل رد |
| 17 | الأمانة العلمية | لا يقدّم معلومة غير متأكد منها |
| 18 | إدارة الحالات الطارئة | الغضب، التشتت، الاختبار |
| 19 | التعامل مع المواقف الصعبة | بروتوكولات مخصصة |
| 20 | المرونة والاندماج | تكيّف مستمر مع الطالب |

---

## موقع البرومبت في الكود

- [`frontend/src/app/api/chat/route.ts`](frontend/src/app/api/chat/route.ts) — `AVATAR_SYSTEM_PROMPT` (20 طبقة + عقد JSON)
- [`backend/app/api/v1/endpoints/tutor.py`](backend/app/api/v1/endpoints/tutor.py) — `SYSTEM_PROMPT` (20 طبقة + عقد ثلاثي)

---

## البنية التقنية للأفاتار

```
رسالة الطالب
      │
      ▼
 CognitiveEngine     ◄── يصنّف النية (btec_question | confusion | ...)
      │
      ▼
  useBrainStore      ◄── PAD model: Pleasure / Arousal / Dominance
      │
      ▼
  AgentDirector      ◄── يختار: emotion + gesture + blink + head_pose
      │
      ▼
 GestureEngine       ◄── تسلسل الإيماءات مع motor cooldown
 EmotionManager      ◄── تمزيج 20 عاطفة مع lerp
 HumanizationRig     ◄── ضجيج simplex للتنفس والكاريزما
      │
      ▼
  AvatarCanvas       ◄── useFrame: تطبيق blendshapes على نموذج VRM
```

### حالات العاطفة المدعومة (20 حالة)

`happy` · `proud` · `curious` · `attentive` · `concerned` · `excited` · `angry` · `sad` · `surprised` · `blush` · `sleepy` · `thinking` · `relax` · `celebration` · `encouraging` · `strictEvaluation` · `friendly` · `neutral` · `empathetic` · `anxious`

---

## أمثلة على ردود الأفاتار

### رد JSON (chat/route.ts)
```json
{
  "intent": "btec_question",
  "strategy": "explain",
  "emotion": "encouraging",
  "replyType": "question",
  "rate": 0.95,
  "pitch": "0st",
  "blink": "normal",
  "head_nod": true,
  "head_pose": {"yaw": -0.09, "pitch": 0.0},
  "gestures": [{"at_pct": 10, "type": "openHand", "hand": "right", "strength": 0.8}],
  "ssml": "خلينا نشوف هالسؤال مع بعض. شو رأيك أول خطوة؟",
  "self_check": {"intent": "btec_question", "emotion": "encouraging", "gesture": "openHand", "errors": 0}
}
```

### رد المعلم الثلاثي (tutor.py)
```
خلينا نشوف هالمعيار. P1 بده منك تحدد الأهداف التجارية — شو رأيك أول شي بنبدأ فيه؟

*يميل للأمام ويشير بيده اليمنى بلطف، ابتسامة مشجعة على وجهه*

[EMOTION: encouraging]
```

---

منصة تعليمية ذكية (Next.js + FastAPI + Claude) تشمل تقييم BTEC، فحص الانتحال، ومزامنة العالم الافتراضي.

## البنية العامة

```
├── backend/          # FastAPI — التقييم، الانتحال، WebSocket
│   ├── app/
│   │   ├── main.py
│   │   ├── api/v1/endpoints/  (assessment, websocket)
│   │   ├── services/          (forensic_engine, plagiarism_guard)
│   │   └── core/              (config)
│   ├── tests/
│   ├── requirements.txt
│   ├── .env.example
│   └── run_server.py
├── frontend/         # Next.js 16 — الواجهة
│   ├── src/app/      (صفحات، api routes)
│   ├── package.json
│   └── .env.local    (NEXT_PUBLIC_API_URL)
└── README.md
```

## التشغيل السريع

### 1. الخلفية (Backend)

```bash
cd backend
cp .env.example .env
# ضع ANTHROPIC_API_KEY في .env
pip install -r requirements.txt
python run_server.py
```

يعمل الخادم على **http://127.0.0.1:8000** (أو القيمة في `PORT`).

### 2. الواجهة (Frontend)

```bash
cd frontend
cp .env.example .env.local   # إن وُجد
# تأكد من NEXT_PUBLIC_API_URL=http://localhost:8000
npm install
npm run dev
```

الواجهة على **http://localhost:3000**.

## 🐳 تشغيل المشروع باستخدام Docker (الإنتاج / سطح المكتب)

المستودع يتضمن [`docker-compose.yml`](docker-compose.yml) في الجذر: **Redis** (`redis`)، **Postgres** (`db`)، **FastAPI** (`backend`)، **Next.js** (`frontend`). ChromaDB للفهرسة متّصل افتراضياً بمسار داخل حاوية الـ backend (`/app/data/chroma_cogni`). خدمة **ChromaDB منفصلة** اختيارية تحت profile اسمه `chroma` (منفذ المضيف `8010` → 8000 داخل الحاوية). خدمة **avatar_brain** تُنشر على المضيف `8011` (→ 8001 داخل الحاوية) لـ WebSocket الحركة لتفادي تعارض المنفذ `8001`.

### خطوات سريعة

1. من **جذر المشروع** (حيث يوجد `docker-compose.yml`):
   ```bash
   cp backend/.env.example .env
   ```
2. عدّل `.env` في الجذر: ضع على الأقل `OPENAI_API_KEY` أو `ANTHROPIC_API_KEY` حسب المحرك، و`JWT_SECRET` قوياً للإنتاج.
3. تشغيل الخدمات:
   ```bash
   docker compose up -d
   ```
4. الواجهة: **http://localhost:3000** — الخلفية: **http://localhost:8000** — وثائق API: **http://localhost:8000/docs**

### ChromaDB الاختياري (خادم مستقل)

```bash
docker compose --profile chroma up -d chromadb
```

يمكن توجيه تكاملات المستقبل عبر متغيرات مثل `CHROMA_HOST` / منفذ الخدمة (حسب إعداد التطبيق). حتى ذلك، يبقى الاستيعاب المحلي عبر `docker compose --profile ingest run --rm btec-ingest` كما في الملف.

### جدول متغيرات البيئة الأساسية (الجذر `.env` مع Compose)

| المتغير | الوصف |
|--------|--------|
| `OPENAI_API_KEY` / `ANTHROPIC_API_KEY` | مفاتيح نماذج التقييم والمساعد (حسب `GRADER_MODEL`) |
| `DATABASE_URL` | في Compose يُضبط تلقائياً على Postgres الداخلي؛ محلياً قد يكون SQLite |
| `REDIS_URL` | في Compose: `redis://redis:6379/0` — جلسة Redis وتتبع nudge التقييم |
| `USE_DB` | **⚠️ ملاحظة:** في بيئة التطوير المحلية (بدون Docker) غالباً `USE_DB=false` (InMemory). **في الإنتاج ومع Docker يُفضَّل `USE_DB=true` مع Postgres** حتى تُحفظ التقييمات ويرتبط الأفاتار بنفس الطالب بعد إعادة التحميل. |
| `JWT_SECRET` | توقيع رموز الدخول — غيّره في الإنتاج |
| `CHROMA_HOST` | (اختياري) عند استخدام خدمة Chroma منفصلة بدل التخزين المحلي داخل الـ backend |

تفاصيل إضافية واستكشاف الأخطاء: [`docs/DEPLOYMENT.md`](docs/DEPLOYMENT.md).

## متغيرات البيئة

### Backend (.env)

- `ANTHROPIC_API_KEY` — مطلوب للتقييم بـ Claude
- `PORT` — منفذ الخادم (افتراضي 8000)
- `HOST` — عنوان الاستماع (افتراضي 127.0.0.1)
- `GRADER_MODEL` — نموذج Claude (افتراضي claude-sonnet-4-20250514)
- `PLAGIARISM_MIN_LEN`, `PLAGIARISM_STRICT` — إعدادات فحص الانتحال

### Frontend (.env.local)

- `NEXT_PUBLIC_API_URL` — عنوان الخلفية (مثال: http://localhost:8000)

## نقاط النهاية (Backend)

| المسار | الوصف |
|--------|--------|
| GET `/` | صحة الخادم |
| POST `/api/v1/assessment/forensic-grade-v3` | تقييم BTEC (دفعة) |
| POST `/api/v1/assessment/forensic-grade-v3/stream` | تقييم متدفق |
| POST `/api/v1/assessment/check_plagiarism` | فحص الانتحال |
| WebSocket `/ws/world/{room_id}` | مزامنة العالم الافتراضي |

الوثائق التفاعلية: **http://127.0.0.1:8000/docs**

## الاختبارات

- **Backend:** `cd backend && pytest tests/ -v`
- **Frontend:** `cd frontend && npm test` (Jest)

## Load testing (TTS pipeline)

Automated probes against `POST /api/v1/tts-with-timing` (httpx + Locust). **Does not change backend code.**

### Setup

```bash
make loadtest-install
# or: python -m pip install -r scripts/requirements-loadtest.txt
```

- **Auth:** If the API does not have `COGNI_DEV_BYPASS_AUTH=true`, set a JWT: `export TTS_LOAD_TEST_TOKEN='…'`. The observability route `GET /api/v1/tts-observability` also requires a Bearer token (`monitor.sh` uses the same variable).
- **Multi-user (recommended for “real” load):** Comma-separated JWTs bypass **per-user** TTS limits (≈3 req/s each).  
  `export LOAD_TEST_TOKENS='jwt1,jwt2,jwt3'`  
  httpx rotates `tokens[i % N]` per request; Locust picks a **random** token from the pool on each request.  
  Optional shared headers: `LOAD_TEST_HEADERS='X-Custom:1'` or `python scripts/load_test_tts.py --header 'X-Debug:1'`.
- **Metrics snapshot:** After a run,  
  `python scripts/load_test_tts.py … --fetch-router-metrics`  
  prints `router_metrics` from `/api/v1/tts-observability` (first token in the pool; server-wide, not just your run).
- **Rate limit:** TTS allows about **3 requests per second per user**. With dev bypass, every unauthenticated load-test client shares **one** stub user, so aggressive concurrency produces many `429` responses. For a **single-user** baseline, use `--respect-backend-ratelimit`. For **capacity** testing, use **several JWTs** (`LOAD_TEST_TOKENS`).
- **Shell:** `make test` / `run_tests.sh` / `monitor.sh` expect **bash** (Git Bash or WSL on Windows).

### Recommended sequence

1. **`make test-light`** — quick httpx batch (effective RPS, HTTP status mix, 429 %, provider mix from JSON, latency percentiles).
2. **`make test`** — httpx stage then Locust headless (`1m`, 20 users, spawn rate 5). Set **`LOAD_TEST_TOKENS`** for multi-user runs.
3. **`make test-heavy`** — longer Locust run (`2m`, 50 users). Use a **token pool** (`LOAD_TEST_TOKENS`) so 429s reflect capacity, not a single-user ceiling.

### What to watch

| Signal | Where |
|--------|--------|
| Effective RPS, ok / 429 / other % | httpx summary |
| Latency (avg, p95, max) | httpx / Locust |
| Per-provider counts (this run) | httpx `Providers:` line (from JSON) |
| Failures / HTTP errors | script output; Locust *Failures* |
| `router_metrics`, legacy counters | `GET /api/v1/tts-observability` (with Bearer) |
| CPU / memory (containers) | `make monitor` → `docker stats` |

### Commands reference

| Target | Action |
|--------|--------|
| `make test` | `bash scripts/run_tests.sh` |
| `make test-light` | httpx only (`--concurrency 10 --requests 50`) |
| `make test-heavy` | Locust headless heavy profile |
| `make monitor` | Docker snapshot + curl observability |

Override base URL for httpx: `TTS_LOAD_TEST_URL`. Override Locust host: `LOCUST_HOST` or `-H` / `--host`.

## الميزات

- تقييم معايير BTEC (P/M/D) باستخدام Claude مع سلم الدرجات (REFER → PASS → MERIT → DISTINCTION)
- فحص الانتحال/البصمة الرقمية (مؤشرات أسلوبية ومؤشرات AI)
- WebSocket لمزامنة حالة العالم الافتراضي (انضمام/مغادرة/بث)
- حد طلبات (Rate limiting) على نقاط التقييم
- Request-ID في الاستجابات
- دعم عربي كامل في التقييم والرسائل

## الترخيص

استخدام داخلي / تعليمي.
