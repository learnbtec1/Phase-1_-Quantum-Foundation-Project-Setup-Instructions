# EDUVERSE Backend — FastAPI + Claude

محرك التقييم الذكي (BTEC P/M/D) وفحص الانتحال ومزامنة WebSocket.

## المتطلبات

- Python 3.10+
- متغير بيئة `ANTHROPIC_API_KEY` (للتقييم عبر Claude)

## التثبيت والتشغيل

```bash
cd backend
pip install -r requirements.txt
```

تشغيل الخادم (المنفذ الافتراضي **8000**):

```bash
python run_server.py
# أو مباشرة:
uvicorn app.main:app --host 127.0.0.1 --port 8000 --reload
```

الوثائق التفاعلية: **http://127.0.0.1:8000/docs**

## متغيرات البيئة (.env)

| المتغير | الوصف | افتراضي |
|--------|--------|---------|
| `ANTHROPIC_API_KEY` | مفتاح Claude API | مطلوب |
| `GRADER_MODEL` | نموذج التقييم (BTEC forensic) | `gpt-5` (استخدم `claude-*` إن رغبت في Claude) |
| `PORT` | منفذ الخادم | `8000` |
| `HOST` | عنوان الاستماع | `127.0.0.1` |
| `PLAGIARISM_MIN_LEN` | حد أدنى لطول النص لفحص الانتحال | `80` |
| `PLAGIARISM_STRICT` | تشديد قواعد الانتحال | `false` |
| `ENVIRONMENT` أو `ENV` | `development` \| `production` — في الإنتاج يُفرض JWT قوي ويُقلّل استجابة الـ health | `development` |
| `JWT_SECRET` | في `production`: لا يقبل القيمة الافتراضية ولا أقل من 32 حرفاً | انظر `.env.example` |
| `AUTO_CREATE_TABLES` | إن لم تُضبط: `true` في التطوير، `false` في الإنتاج (الجداول عبر Alembic) | حسب البيئة |
| `STRIPE_WEBHOOK_SECRET` | في `production`: مطلوب لقبول webhooks موقّعة | فارغ في التطوير |

**قاعدة البيانات في الإنتاج:** شغّل ترحيلات Alembic بدل `AUTO_CREATE_TABLES` (مثلاً من مجلد `backend`: `alembic upgrade head` بعد ضبط `DATABASE_URL`).

## نقاط النهاية الرئيسية

| الطريقة | المسار | الوصف |
|--------|--------|--------|
| GET | `/` | الحالة والاتصال |
| POST | `/api/v1/assessment/forensic-grade-v3` | تقييم دفعة واحدة (Claude) |
| POST | `/api/v1/assessment/forensic-grade-v3/stream` | تقييم متدفق (NDJSON) |
| POST | `/api/v1/assessment/check_plagiarism` | فحص الانتحال/البصمة الرقمية |
| POST | `/api/v1/assessment/grade` | توافق مع الإصدارات القديمة |
| POST | `/api/v1/chat` | محادثة HTTP رئيسية (Bearer + حد LLM لكل مستخدم) |
| POST | `/api/v1/tutor/chat` | شكل طلب/استجابة المدرّس الكلاسيكي (`ChatRequest`/`ChatResponse`)؛ Bearer + نفس حد LLM |
| WS | `/ws/agent` | وكيل الصوت/النص (مصادقة JWT عبر `Sec-WebSocket-Protocol: cogni-auth-v1, <jwt>` أو أول إطار `{"type":"auth","token":"..."}` — **ممنوع** `?token=` في الرابط) |
| WS | `/ws/world/{room_id}` | مزامنة العالم الافتراضي؛ أول إطار مصادقة مطلوب (`auth` + token)، ثم رسائل `action` |

**WebSocket `/ws/agent` (العميل):** لا تضع JWT في query string. الخيارات: (1) `new WebSocket(url, ['cogni-auth-v1', accessToken])`؛ (2) بعد `onopen` أرسل `{ "type": "auth", "token": "<JWT>", "v": 1.1 }` قبل `persona_init`. للتطوير بدون تسجيل دخول: `COGNI_WS_ALLOW_ANONYMOUS=true`.

## الاختبارات

```bash
cd backend
pytest tests/ -v
```

إن كان الطرفية يضبط `ENVIRONMENT=production` بدون `JWT_SECRET` قوي، يفرض `tests/conftest.py` العودة إلى `development` ما لم تُضبط `PYTEST_ALLOW_PRODUCTION_ENV=1` مع سر صالح.

## البنية

- `app/main.py` — تطبيق FastAPI، CORS، حد الطلبات، Request-ID، `/` و `/api/health` (مختصران في الإنتاج)
- `app/core/production_guards.py` — التحقق من `JWT_SECRET` عند `ENVIRONMENT=production`
- `app/api/v1/endpoints/assessment.py` — التقييم وفحص الانتحال
- `app/api/v1/endpoints/websocket.py` — WebSocket للعالم الافتراضي
- `app/services/forensic_engine.py` — محرك التقييم (Claude، BTEC P→M→D)
- `app/services/plagiarism_guard.py` — فحص الانتحال (مؤشرات أسلوبية)
