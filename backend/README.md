# NEXUS Backend — FastAPI + Claude

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
| `GRADER_MODEL` | نموذج التقييم | `claude-sonnet-4-20250514` |
| `PORT` | منفذ الخادم | `8000` |
| `HOST` | عنوان الاستماع | `127.0.0.1` |
| `PLAGIARISM_MIN_LEN` | حد أدنى لطول النص لفحص الانتحال | `80` |
| `PLAGIARISM_STRICT` | تشديد قواعد الانتحال | `false` |

## نقاط النهاية الرئيسية

| الطريقة | المسار | الوصف |
|--------|--------|--------|
| GET | `/` | الحالة والاتصال |
| POST | `/api/v1/assessment/forensic-grade-v3` | تقييم دفعة واحدة (Claude) |
| POST | `/api/v1/assessment/forensic-grade-v3/stream` | تقييم متدفق (NDJSON) |
| POST | `/api/v1/assessment/check_plagiarism` | فحص الانتحال/البصمة الرقمية |
| POST | `/api/v1/assessment/grade` | توافق مع الإصدارات القديمة |
| WS | `/ws/world/{room_id}` | مزامنة حالة العالم الافتراضي |

## الاختبارات

```bash
cd backend
pytest tests/ -v
```

## البنية

- `app/main.py` — تطبيق FastAPI، CORS، حد الطلبات، Request-ID
- `app/api/v1/endpoints/assessment.py` — التقييم وفحص الانتحال
- `app/api/v1/endpoints/websocket.py` — WebSocket للعالم الافتراضي
- `app/services/forensic_engine.py` — محرك التقييم (Claude، BTEC P→M→D)
- `app/services/plagiarism_guard.py` — فحص الانتحال (مؤشرات أسلوبية)
