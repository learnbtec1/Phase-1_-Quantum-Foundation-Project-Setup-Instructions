# نشر وتشغيل Cogni / EDUVERSE

دليل عملي للخلفية (FastAPI)، قواعد البيانات، Redis، وChromaDB — مع أو بدون Docker.

---

## 1. تشغيل كامل عبر Docker Compose

- الملف: `docker-compose.yml` في جذر المشروع.
- أنشئ `.env` في الجذر من `backend/.env.example` وعدّل المفاتيح.
- الأمر: `docker compose up -d`
- الخدمات الداخلية:
  - `db` — Postgres 16 (قاعدة `eduverse`، مستخدم `eduverse` — أو القيم في `.env`)
  - `redis` — Redis 7
  - `backend` — يضبط `DATABASE_URL` و`REDIS_URL` و`USE_DB=true` تلقائياً ضمن Compose
  - `frontend` — Next.js (وضع تطوير مع bind mount لمجلد `frontend`)

### ChromaDB

- **الافتراضي:** بيانات المتجهات تحت `./backend/data/chroma_cogni` داخل حاوية الـ backend.
- **خادم منفصل (اختياري):** `docker compose --profile chroma up -d chromadb` — المنفذ على المضيف `8010` (داخل الحاوية 8000). **avatar_brain** يُنشر على المضيف **`8011`** (→ 8001 داخل الحاوية)؛ اضبط `NEXT_PUBLIC_GENERATIVE_GESTURE_WS=ws://127.0.0.1:8011` للمتصفح على المضيف.

### استيعاب BTEC إلى Chroma

```bash
docker compose --profile ingest run --rm btec-ingest
```

---

## 2. Postgres يدوياً (بدون Docker)

1. ثبّت PostgreSQL 14+ وأنشئ مستخدماً وقاعدة:
   ```sql
   CREATE USER eduverse WITH PASSWORD 'your_secret';
   CREATE DATABASE eduverse OWNER eduverse;
   ```
2. في `backend/.env`:
   ```env
   DATABASE_URL=postgresql+psycopg2://eduverse:your_secret@localhost:5432/eduverse
   USE_DB=true
   ```
3. من مجلد `backend` شغّل ترحيلات Alembic إن وُجدت (`alembic upgrade head`) حسب إعداد المشروع.

---

## 3. Redis يدوياً (بدون Docker)

1. شغّل `redis-server` محلياً (المنفذ الافتراضي 6379).
2. في `backend/.env`:
   ```env
   REDIS_URL=redis://127.0.0.1:6379/0
   ```
3. بدون Redis: التطبيق يتجاهل مزامنة الجلسة ورسائل `eval_nudge_ack` عبر Redis؛ يبقى السلوك محلياً أو عبر blob الجلسة حسب الكود الحالي.

---

## 4. التبديل بين InMemoryEvaluationRepository و PostgresEvaluationRepository

- يتحكم المتغير **`USE_DB`** في البيئة:
  - `USE_DB=false` (أو غير مُعرَّف) → `InMemoryEvaluationRepository` — التقييمات **لا تُحفظ** بعد إعادة تشغيل العملية.
  - `USE_DB=true` → `PostgresEvaluationRepository` — يتطلب `DATABASE_URL` صالحاً واتصالاً ناجحاً؛ عند الفشل قد يُعاد خطأ 503 من مسارات التقييم.
- عند الإقلاع، يسجّل التطبيق في السجلات وضع التخزين (راجع `backend/app/main.py`).

---

## 5. السجلات (logs) واستكشاف الأخطاء

### مستوى السجل

- **`LOG_LEVEL`** في `backend/.env` (مثال: `INFO` للإنتاج، `DEBUG` للتطوير). مستوى `DEBUG` يزيد حجم السجلات ولا يُنصح به في الإنتاج.

### مشاكل شائعة

| العرض | سبب محتمل | ما يمكن فعله |
|--------|------------|----------------|
| فشل الاتصال بـ Postgres عند `USE_DB=true` | الخادم غير شغّل أو `DATABASE_URL` خاطئ | تحقق من `pg_isready` والسلسلة |
| Redis غير متاح | `REDIS_URL` فارغ أو الخدمة متوقفة | شغّل Redis أو اترك بدون Redis للتطوير البسيط |
| Chroma / RAG فارغ | لم يُشغَّل `btec-ingest` أو المسار فارغ | نفّذ الاستيعاب وتحقق من `backend/data/chroma_cogni` |
| WebSocket يرفض الاتصال | CORS أو عكس وكيل أو منفذ خاطئ | تأكد من `NEXT_PUBLIC_API_URL` ومسار `/ws/agent` |
| **`FATAL: role "eduverse" does not exist`** | مجلد بيانات Postgres على المضيف قديم وتم إنشاؤه بمستخدم آخر؛ Docker لا يعيد تهيئة القاعدة عند تغيير `POSTGRES_USER` | انظر الفقرة التالية |

### Postgres: دور `eduverse` غير موجود (بعد إعادة تسمية المشروع)

مجلد `./backend/data/postgres` على المضيف يُهيَّأ **مرة واحدة فقط**. إذا كان قد أُنشئ سابقاً بمستخدم مثل `nexus`، فالمتغيرات الحالية لن تُنشئ دور `eduverse`.

**الخيار أ — تطوير بدون الاحتفاظ ببيانات قديمة (الأبسط):**

```bash
docker compose down
# احذف مجلد بيانات Postgres على المضيف (Windows: من مستكشف الملفات أو PowerShell)
#   backend/data/postgres
docker compose up -d
```

**الخيار ب — الاحتفاظ بالبيانات:** اتصل بـ Postgres كـ **المستخدم الفعلي** الذي يملك الصلاحيات (جرّب `-U nexus` أو `-U postgres` حسب إعدادك الأول):

في **bash** (Git Bash / WSL):

```bash
docker compose exec -T db psql -U nexus -d postgres < backend/scripts/postgres_add_eduverse_role.sql
docker compose exec -T db psql -U nexus -d eduverse < backend/scripts/postgres_grant_eduverse_schema.sql
```

في **PowerShell** لا يعمل `<`؛ استخدم التوجيه عبر خط الأنابيب. يجب أن تكون خدمة **`db` شغّالة** (`docker compose ps`)؛ وإلا ستظهر `service "db" is not running`.

```powershell
docker compose up -d db
Get-Content -Raw backend/scripts/postgres_add_eduverse_role.sql | docker compose exec -T db psql -U nexus -d postgres
Get-Content -Raw backend/scripts/postgres_create_eduverse_database.sql | docker compose exec -T db psql -U nexus -d postgres
Get-Content -Raw backend/scripts/postgres_grant_eduverse_schema.sql | docker compose exec -T db psql -U nexus -d eduverse
```

إذا ظهرت رسالة أن قاعدة `eduverse` موجودة مسبقاً في الخطوة الوسطى، تجاهلها وتابع الخطوة الأخيرة.

أو من جذر المشروع: `.\backend\scripts\run_postgres_eduverse_fix.ps1 -SuperUser nexus` — السكربت يشغّل `docker compose up -d db` تلقائياً إذا كانت متوقفة (استخدم `-NoStart` إن أردت الفشل بدل التشغيل التلقائي).

عدّل `nexus` واسم قاعدة `eduverse` إذا كان لديك أسماء مختلفة. إذا كانت قاعدة التطبيق ما زالت اسمها `nexus`، إمّا أن تُنشئ قاعدة `eduverse` وتُهاجر، أو تضبط في `.env` نفس `POSTGRES_DB` و`DATABASE_URL` المطابقين للاسم القديم.

**تعديل كلمة المرور في السكربت:** إذا غيّرت `POSTGRES_PASSWORD` في `.env`، عدّل السطر `CREATE ROLE ... PASSWORD '...'` في `backend/scripts/postgres_add_eduverse_role.sql` قبل التشغيل (أو نفّذ أوامر `CREATE ROLE` / `ALTER ROLE` يدوياً).

### عرض سجلات Docker

```bash
docker compose logs -f backend
docker compose logs -f frontend
docker compose logs -f redis
docker compose logs -f db
```

---

## 6. إعادة بناء الكود أثناء التطوير في Docker

- **Frontend:** في `docker-compose.yml` مُركَّب مجلد `frontend` على الحاوية؛ `npm run dev` يعيد التحميل الساخن.
- **Backend:** الحاوية الافتراضية تشغّل `uvicorn` بدون `--reload`. للتطوير السريع يمكنك تشغيل الخلفية محلياً (`python run_server.py` مع `--reload`) مع Postgres/Redis من Compose، أو إضافة volume `./backend:/app` وأمر `uvicorn ... --reload` في نسخة تطوير مخصصة (غير مضمنة افتراضياً لتفادي الاختلافات بين البيئات).

---

آخر تحديث: يتوافق مع `docker-compose.yml` الحالي (أسماء الخدمات: `backend`, `frontend`, `db`, `redis`, `chromadb` اختياري).
