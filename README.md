# منصة NEXUS — التعليم الذكية

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

## الميزات

- تقييم معايير BTEC (P/M/D) باستخدام Claude مع سلم الدرجات (REFER → PASS → MERIT → DISTINCTION)
- فحص الانتحال/البصمة الرقمية (مؤشرات أسلوبية ومؤشرات AI)
- WebSocket لمزامنة حالة العالم الافتراضي (انضمام/مغادرة/بث)
- حد طلبات (Rate limiting) على نقاط التقييم
- Request-ID في الاستجابات
- دعم عربي كامل في التقييم والرسائل

## الترخيص

استخدام داخلي / تعليمي.
