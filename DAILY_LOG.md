# NEXUS Platform — Daily Work Log

---

## 2026-03-14 (السبت)

### الإصلاحات المطبقة — Pipeline الصوت (Fixes #1–#10)

| # | الملف | المشكلة | الإصلاح |
|---|-------|---------|---------|
| 1 | `frontend/src/hooks/useAgentAgent.ts` | Hook-order violation | `onSpeechEnd` نُقل إلى slot 23 |
| 2 | `frontend/src/hooks/useVAD.ts` | NotFoundError يُعاد رميها | تم تغيير `throw` إلى `return` |
| 3 | `frontend/src/hooks/useAgentAgent.ts` | WS reconnect flood | maxRetries=5 + `wasClosedIntentionallyRef` |
| 4 | `backend/app/services/whisper_stt.py` | np.frombuffer crash على odd-byte | truncation بايت فردي |
| 5 | `frontend/src/hooks/useVAD.ts` | EBML header يُحذف | `firstChunkSavedRef` + `hadSpeechThisSegmentRef` |
| 6 | `frontend/src/hooks/useVAD.ts` | stopListening لا تعيد تهيئة flags | reset كامل في stopListening |
| 7 | `frontend/src/hooks/useVAD.ts` | ondataavailable بدون activeRef guard | `if (!activeRef.current) return` |
| 8 | `frontend/src/hooks/useVAD.ts` | startListening بدون defensive reset | 4-line reset block في بداية startListening |
| 9 | `frontend/src/hooks/useAgentAgent.ts` | empty_transcript يُفيض الـ UI | `lastEmptyErrorMsRef` — rate-limit 2s |
| 10 | `frontend/src/hooks/useAgentAgent.ts` | لا يوجد schema validation قبل WS | `E_WS_SCHEMA` guard على empty audioBase64 |

**نتيجة TypeScript:** `npx tsc --noEmit` → **0 errors**

---

### Docker Self-Heal

- **المشكلة:** `docker info` يتجمد — engine يُرجع 500 على npipe لكل API versions
- **السبب الجذري:** `docker-desktop` WSL distro تبدأ بطيئة جداً بعد `wsl --shutdown`
- **الحل المطبق:**
  - حذف `DOCKER_API_VERSION` من environment
  - إيقاف Docker Desktop وإعادة تشغيله من: `C:\Program Files\Docker\Docker\frontend\Docker Desktop.exe`
  - إضافة `DOCKER_API_VERSION=1.44` كـ fallback
  - إصلاح `docker-compose.yml` — healthcheck كان يضرب `/health` (404) بدل `/api/health` (200)
- **النتيجة:** Stack يعمل بالكامل:
  - `nexus_db` → healthy ✓
  - `nexus_backend` → healthy ✓
  - `nexus_frontend` → running ✓

### فحص API النهائي

| Endpoint | النتيجة |
|----------|---------|
| `GET /api/health` | ok=true, env=true, reach=true |
| `GET /openapi.json` | 21 route مسجلة |
| `POST /api/v1/tts-with-timing` | format=mp3, sr=24000, visemes=6, words=3 |

---

### ملفات أُنشئت/عُدّلت اليوم

- `frontend/src/hooks/useVAD.ts` — 4 إصلاحات
- `frontend/src/hooks/useAgentAgent.ts` — 4 إصلاحات
- `backend/app/services/whisper_stt.py` — إصلاح واحد
- `docker-compose.yml` — إصلاح healthcheck
- `scripts/docker_heal.ps1` — سكريبت self-heal كامل
- `scripts/stack_up.ps1` — سكريبت تشغيل Stack
- `scripts/docker_check.ps1` — سكريبت تشخيص Docker
- `backend/alembic/versions/0002_add_conversations_table.py` — migration جديدة للـ conversations table

---

### ملاحظات مهمة

- Docker Desktop exe: `C:\Program Files\Docker\Docker\frontend\Docker Desktop.exe`
- WSL data: `D:\DockerData` (فارغ — Docker يستخدم default LocalAppData)
- `audio=false` في health → مفتاح Azure Speech غير مضبوط في `backend/.env`
- `nexus_frontend` مشكلة node_modules volume فاسد → يحتاج `docker volume rm` وإعادة build

---

## 2026-03-14 — Azure TTS Native WAV Integration

### التغييرات المطبقة

| الملف | التغيير |
|-------|---------|
| `backend/requirements.txt` | أضيف `azure-cognitiveservices-speech==1.38.0` |
| `backend/.env` | `TTS_PROVIDER=azure`, `TTS_VOICE=ar-SA-HamedNeural`, `TTS_FORMAT=riff-24khz-16bit-mono-pcm` |
| `backend/app/api/v1/endpoints/tts_timing.py` | Azure كـ priority-1 engine مع SSML و fallback تقديري |
| `backend/app/main.py` | `/api/health` audio يتحقق من Azure credentials |

### نتائج الاختبار النهائية

| Metric | النتيجة |
|--------|---------|
| `GET /api/health` → audio | `true` ✅ |
| format | `wav` ✅ |
| sample_rate | `24000` ✅ |
| timing_mode | `native` ✅ |
| visemes | `37` ✅ |
| words | `4` ✅ (كان 0) |

### الجذر التقني — سبب Words=0

`ar-SA-HamedNeural` لا يُطلق `synthesis_word_boundary` events حتى مع SSML.
**الحل:** fallback يحسب توقيت كل كلمة من مدة الـ WAV الفعلية:
```python
pcm_bytes = max(0, len(wav_bytes) - 44)
total_ms  = pcm_bytes / (24_000 * 2) * 1_000
step = total_ms / len(word_list)
```

---

## 2026-03-14 — Conversation & Audio Store (Repository Memory Architect)

### المهمة
إنشاء نظام استمرارية موحد للمحادثات والصوت (JSONL + WAV) وربطه بـ TTS endpoint بدون أي تغيير في API schema.

### التغييرات المطبقة

| الملف | العملية | التفاصيل |
|-------|---------|---------|
| `backend/app/services/conversation_store.py` | **جديد** (337 سطر) | خدمة الاستمرارية الكاملة |
| `backend/app/api/v1/endpoints/tts_timing.py` | **معدّل** (8 تغييرات) | ربط BackgroundTasks + store |
| `backend/.env` | **إضافة** | `STORE_DIR` + `AUDIO_DIR` |
| `docker-compose.yml` | **لا تغيير** | bind-mount كافٍ |

### بنية التخزين

```
backend/data/
├── store/
│   ├── YYYY-MM-DD.jsonl         ← سجل المحادثة (UTF-8، سطر لكل utterance)
│   └── YYYY-MM-DD.index.json    ← فهرس uid → metadata
└── audio/
    └── YYYY-MM-DD/
        └── <uid>.wav            ← WAV 24kHz mono
```

### schema سجل JSONL

```json
{
  "utterance_id": "uuid4",
  "ts": "ISO-8601",
  "role": "assistant",
  "text": "النص العربي",
  "provider": "azure",
  "timing_mode": "approx",
  "sample_rate": 24000,
  "duration_ms": 3912,
  "wav_path": "data/audio/YYYY-MM-DD/<uid>.wav",
  "word_count": 6,
  "viseme_count": 43,
  "meta": {"tts_latency_ms": 1265}
}
```

### تفاصيل الـ ConversationStore (المكتبة الجديدة)

| الدالة | الوصف |
|--------|-------|
| `append_utterance(...)` | كتابة WAV ذرية (tmp→os.replace) + إضافة JSONL + تحديث index — thread-safe بـ Lock |
| `append_from_response(...)` | فك ترميز base64 WAV واستدعاء append_utterance |
| `get_recent(n=20)` | آخر N سجل من اليوم |
| `find_by_id(uid)` | بحث في اليوم الحالي والسابق |
| `vacuum(days=30)` | حذف الملفات الأقدم من N يوم |
| `import_legacy(paths)` | استيعاب ملفات .txt/.md/.json/.wav/.mp3 القديمة |
| `get_store()` | singleton على مستوى الـ module (يعيش خلال uvicorn --reload) |

### الربط مع tts_timing.py

8 تغييرات مطبقة:
1. `BackgroundTasks` مضاف لـ fastapi import
2. `from app.services.conversation_store import get_store as _get_store` مضاف
3. `_store = _get_store()` singleton على مستوى الـ module مع `try/except` guard
4. `background_tasks: BackgroundTasks` مضاف لـ handler signature (FastAPI DI — غير مرئي في OpenAPI)
5-10. كل نقطة `return TTSResponse(...)` الـ 6 تحولت إلى:
   ```python
   _resp = TTSResponse(...)
   if _store is not None:
       background_tasks.add_task(_store.append_from_response, ...)
   return _resp
   ```

### متغيرات البيئة المضافة

```ini
STORE_DIR=./data/store   # مسار JSONL والفهرس
AUDIO_DIR=./data/audio   # مسار WAV
```

### نتائج smoke test (2026-03-14)

| الفحص | الدليل | النتيجة |
|-------|--------|---------|
| `/api/health` | `ok=True  last_tts_ms=1265` | ✅ |
| TTS POST | `provider=azure  format=wav  words=6  visemes=43` | ✅ |
| `data/store/2026-03-14.jsonl` | 385 سطر، آخر uid: `43cd706e` | ✅ |
| `data/store/2026-03-14.index.json` | 385 مدخلة | ✅ |
| `data/audio/2026-03-14/<uid>.wav` | 187,846 B (~3.9 ثانية صوت) | ✅ |
| `import_legacy` | 5 ملفات → 383 utterance مُستوعبة | ✅ |

**النتيجة الكاملة: ALL PASS ✅**

### خصائص التصميم
- **غير معطّل للـ API**: BackgroundTasks تُطلق بعد إرسال الـ HTTP response — صفر latency impact
- **Thread-safe**: Lock يحمي كل I/O؛ WAV يُكتب ذرياً (tmp → os.replace)
- **متسامح مع الأخطاء**: `_store = None` لا يُعطّل TTS عند فشل init الـ store
- **تدوير يومي**: الملفات تتجدد تلقائياً منتصف الليل

---

## حالة البيئة الحالية (2026-03-14)

### Backend
- **التشغيل**: Native via `venv311/Scripts/uvicorn.exe` على المنفذ 8000 (Docker daemon متوقف)
- **Python**: 3.11.3 (venv311)
- **المنفذ**: `http://127.0.0.1:8000`
- **الـ TTS المُفعّل**: Azure (priority-1) → edge-tts (fallback)
- **مشكلة Azure مؤقتة**: `SpeechSynthesisCancellationDetails` attribute error — circuit breaker 60s cooldown

### متغيرات البيئة المهمة في `backend/.env`
| المتغير | القيمة |
|---------|--------|
| `TTS_PROVIDER` | `azure` |
| `TTS_VOICE` | `ar-SA-HamedNeural` |
| `TTS_FORMAT` | `riff-24khz-16bit-mono-pcm` |
| `STORE_DIR` | `./data/store` |
| `AUDIO_DIR` | `./data/audio` |

### مفاتيح localStorage الثابتة (لا تتغير أبداً)
- `nexus-auth`
- `nexus-assessments`
- `nexus-vr`
- `btec_platform_progress`

### Docker
- **الحالة**: Daemon متوقف / backend يعمل native
- **healthcheck الصحيح**: `/api/health` (وليس `/health`)
- **bind-mount**: `./backend:/app` يغطي data/ تلقائياً

---
