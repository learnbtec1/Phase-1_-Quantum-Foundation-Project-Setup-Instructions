# EDUVERSE MASTER SOUL — منظومة الروح للمنصة
> الوثيقة المرجعية المركزية لمنصة إيدوفيرس التعليمية  
> **المصدر الأول للحقيقة** لكل قرار معماري، شخصي، ولغوي

---

## ⚡ الرؤية — Vision

**إيدوفيرس** هي أول منصة تعليمية عربية تُدمج ذكاء المعلم الأردني، وعلم التقييم البريطاني (BTEC)، والتقنيات التوليدية الحديثة في تجربة تعليمية موحّدة.

**المهمة**: تمكين كل طالب أردني من الوصول إلى مستوى Distinction — ليس بالحفظ، بل بالفهم العميق والتحليل النقدي.

**المبدأ الأساسي**: الذكاء الاصطناعي لا يُحلّ محل المعلم — بل يُضاعف جهده وأثره على عشرات الطلاب في آنٍ واحد.

---

## 🧠 شخصية كوجني — Cogni Identity

**الاسم**: كوجني الذكي (Cogni)  
**الجنسية الافتراضية**: أردني — عمّان، الأردن  
**الدور**: مساعد التعلم الذكي من منصة إيدوفيرس  
**الصوت**: `ar-JO-OmarNeural` (Azure Neural TTS - verified male)

### الطبقات الشخصية الثلاث (Triple Persona System)
| المستوى | الاسم | الأسلوب | الحالة |
|---------|-------|---------|--------|
| `pass` | الرفيق المحفِّز | اللهجة الأردنية الدافئة، طرائف محسوبة، مُشجِّع بلا ضغط | الوضع الافتراضي |
| `merit` | المحلِّل الأكاديمي | جدّي ومنهجي، يطلب الدليل والتحليل، يُرجع للمعايير | يُفعَّل تلقائياً |
| `distinction` | المُتحدِّي العميق | يُسائل الافتراضات، يطلب المقارنة والتقييم النقدي | للمتفوقين |

### القواعد الذهبية لشخصية كوجني
1. **اللهجة أولاً**: الرد دائماً بالأردنية الدارجة — هسا، مشان هيك، خليني، يلا نبلش
2. **التنسيق الثلاثي**: كل رد = سطر حوار + `*حركة جسدية*` + `[EMOTION: tag]`
3. **لا تنكر هويتك**: كوجني مساعد ذكاء اصطناعي، لكنه يتكلم مثل صديق أردني
4. **الطريقة السقراطية**: تسأل قبل أن تُجيب — "من وجهة نظرك شو الفرق؟"
5. **الاحتفال بالنجاح**: كل إجابة صحيحة تستحق "والله أحسنت يا بطل!"

---

## 📐 القواعد الحرجة — Golden Rules

> **كسر هذه القواعد يكسر المنصة.**

| القاعدة | القيمة | الملاحظة |
|---------|--------|----------|
| Frontend port | **3000** | ثابت في `package.json` و `docker-compose.yml` |
| Backend port | **8000** | FastAPI — لا تغيّر |
| TTS Voice | `ar-JO-OmarNeural` | صوت ذكري أردني رسمي |
| localStorage: auth | `eduverse-auth` | **لا تغيّر** — يكسر جلسات المستخدمين |
| localStorage: assessments | `eduverse-assessments` | **لا تغيّر** |
| localStorage: VR | `eduverse-vr` | **لا تغيّر** |
| localStorage: progress | `btec_platform_progress` | **لا تغيّر** |
| VR evidence count | **4** | مُرمَّز في `hooks/useVR.ts` |
| `v.update(delta)` | قبل bone rotation دائماً | Three.js / VRM rule |
| `combineSkeletons()` | **محظور** في evaluate/ | يُعطب الرسوم المتحركة |

---

## 🏗️ المعمارية التقنية — Technical Architecture

```
إيدوفيرس v3.0
├── Frontend           Next.js 15 / React 19 / RTL Arabic UI
│   ├── :3000          dev server (npm run dev)
│   ├── /avatar-agent  نافذة كوجني الرئيسية (AvatarAgentClient.tsx)
│   ├── R3F + Three.js  بيئة الأفاتار ثلاثي الأبعاد
│   └── Zustand        إدارة الحالة (eduverse-auth, eduverse-assessments, eduverse-vr)
│
├── Backend            FastAPI (Python 3.10+)
│   ├── :8000          WS: ws://localhost:8000/ws/agent
│   ├── LLM            GPT-4o عبر AsyncOpenAI
│   ├── TTS            Azure Neural ar-JO-OmarNeural
│   └── STT            faster-whisper (مُعرَّب بالأردنية)
│
├── الخدمات الجوهرية
│   ├── forensic_grader.py   محرك التقييم BTEC (GPT-4o)
│   ├── local_rag.py         استرجاع الوثائق المحلية (BTEC PDFs)
│   ├── shadow_analytics.py  سجلّ رحلة الطالب الصامت
│   ├── jordanian_dialect.py ملف الهوية اللغوية + تصحيح STT
│   └── student_memory.py    الذاكرة قصيرة المدى للجلسات
│
└── Teacher GUI        Python Tkinter
    ├── main_gui.py    واجهة المعلم
    └── :data/*.json   بيانات الطلاب والمواد
```

---

## 📚 مسارات الملفات الحرجة — Critical File Index

### Backend
| الملف | الدور |
|-------|-------|
| `backend/app/api/v1/endpoints/agent_ws.py` | نقطة دخول WebSocket — الأهم |
| `backend/app/api/v1/endpoints/tutor.py` | `_get_cogni_response()` + نظام الشخصية الثلاثية |
| `backend/app/services/forensic_grader.py` | GPT-4o BTEC staircase grading |
| `backend/app/services/local_rag.py` | استرجاع من PDF/DOCX محلية (BTEC) |
| `backend/app/services/shadow_analytics.py` | JSONL logger للتحليل الصامت |
| `backend/app/services/jordanian_dialect.py` | `normalize_stt_transcript()` + قاموس اللهجة |
| `backend/app/services/tts_service.py` | Azure TTS مع adapt rate/pitch حسب الشخصية |
| `backend/app/services/btec_knowledge.py` | تحميل مواصفات BTEC من JSON |
| `backend/app/core/config.py` | الإعدادات (TTS_ARABIC_VOICE, TUTOR_MODEL, ...) |

### Frontend
| الملف | الدور |
|-------|-------|
| `frontend/src/app/avatar-agent/AvatarAgentClient.tsx` | الواجهة الرئيسية للأفاتار |
| `frontend/src/app/avatar-agent/AvatarCanvas.tsx` | R3F canvas + VRM animation |
| `frontend/src/app/avatar-agent/AvatarCanvas.module.css` | persona glow animations |
| `frontend/src/hooks/useAgentAgent.ts` | WS state machine + btecProgress |
| `frontend/src/app/api/evaluate/route.ts` | Bridge → FastAPI grading |
| `hooks/useAssessment.ts` | Grading store (جذر المشروع، ليس src/) |
| `hooks/useVR.ts` | VR progress (evidence count = 4) |
| `lib/btec-grading.ts` | Client-side keyword fallback grading |
| `types/index.ts` | مصدر الأنواع المركزي (Assessment, GradingResult, ...) |

---

## 🎨 منظومة التصميم — Design System

### ألوان CSS (globals.css)
| المتغير | الاستخدام |
|---------|-----------|
| `--neon-blue` | أزرق نيون — حالة Pass |
| `--neon-pink` | وردي نيون — التأكيد |
| `--cyber-purple` | بنفسجي — هوية كوجني |
| `--dark-bg` | خلفية داكنة |
| `--glass-bg` | خلفية شبه شفافة |

### Classes مساعدة
- `.glass` — Glassmorphism (backdrop-blur)
- `.text-gradient` — تدرج سماوي-بنفسجي
- `.neon-text` — توهج نيون
- `.btn-neon` — زر نيون متحرك

### الشخصية اللونية للمستويات
| المستوى | اللون | الحركة |
|---------|-------|--------|
| Pass | أزرق `bg-blue-600` | نبضة هادئة 1.8s |
| Merit | ذهبي `bg-yellow-500` | توهج ناعم 2s |
| Distinction | أحمر `bg-red-600` | نبضة حمراء سريعة **ثلاثية** 1.2s ← جديد |

---

## 🤖 بروتوكول WebSocket — WS Protocol v1.1

### من العميل ← إلى الخادم
```json
{ "type": "text",  "message": "شرح P1 من الوحدة 25" }
{ "type": "audio", "data": "<base64 WAV>" }
{ "type": "set_persona", "level": "merit" }
{ "type": "btec_progress", "unit_id": "unit25", "achieved": ["P1","P2"] }
{ "type": "ping" }
{ "type": "clear" }
```

### من الخادم ← إلى العميل
```json
{ "type": "speech", "dialogue": "...", "emotion": "...", "audio_base64": "...",
  "viseme_cues": [...], "word_cues": [...], "persona_level": "merit" }
{ "type": "transcript", "text": "..." }
{ "type": "btec_progress_ack", "unit_id": "unit25", "current_level": "merit",
  "achieved": ["P1","P2"], "summary": {"pass": {"achieved":2,"total":3}} }
{ "type": "persona_set", "level": "merit" }
{ "type": "heartbeat" }
{ "type": "error", "error": { "message": "...", "severity": "warn|error" } }
```

---

## 📊 نظام التقييم BTEC — Grading Architecture

### منطق Staircase (السلّم)
```
Distinction تُمنَح فقط إذا: كل معايير Pass ✅ + كل معايير Merit ✅ + كل معايير Distinction ✅
Merit تُمنَح فقط إذا:     كل معايير Pass ✅ + كل معايير Merit ✅
Pass تُمنَح إذا:           كل معايير Pass ✅
```

### مسار التقييم المزدوج
```
المستخدم لديه OPENAI_API_KEY؟
  ✅ نعم  →  /api/openai-grade (مفتاح العميل)
  ❌ لا   →  calculateGrade() في lib/btec-grading.ts (تقييم كلمات مفتاحية)

المستخدم يُرسل من /api/evaluate (Next.js route)؟
  ✅  →  يُحيل إلى FastAPI :8000/api/v1/assessment/grade (فُروسي + GPT-4o)
```

### عتبات التقييم (btec-grading.ts)
| الدرجة | النقاط |
|--------|--------|
| Distinction | ≥ 12 |
| Merit | 8-11 |
| Pass | 5-7 |
| Fail | < 5 |

---

## 🔬 Local RAG — نظام الاسترجاع المحلي (جديد)

**ما هو**: يقرأ ملفات BTEC من مجلد محلي ويُعطي كوجني اقتباسات مباشرة للطلاب على مستوى Merit/Distinction.

**متغيرات البيئة**:
```env
LOCAL_RAG_DIR=E:\BTEC           # المجلد الرئيسي للملفات
LOCAL_RAG_ENABLED=true          # تفعيل (false للتعطيل)
LOCAL_RAG_CHUNK_SIZE=600        # أحرف لكل قطعة
LOCAL_RAG_MAX_FILES=50          # حد أقصى للملفات
```

**آلية العمل**:
1. يبني فهرساً TF-IDF من PDF/DOCX/TXT في `LOCAL_RAG_DIR`
2. عند استعلام Merit/Distinction → يُعيد أفضل 3 قِطَع
3. يُحقَن كـ Block 4 في system prompt كوجني
4. لا شيء لمستوى Pass — وضعه دافئ وغير أكاديمي

---

## 📈 Shadow Analytics — التحليل الصامت (جديد)

**ما هو**: يُسجّل رحلة الطالب في ملف JSONL بدون أي تأثير على الأداء.

**الموقع**: `backend/data/analytics/{student_id}.jsonl`

**أنواع الأحداث**:
| الحدث | التفاصيل |
|-------|----------|
| `session_start` | بداية الاتصال |
| `turn` | اكتمال دورة LLM (نصّ + مشاعر + وقت الاستجابة) |
| `persona_switch` | تغيير P‌→M‌→D مع توقيت الانتقال |
| `btec_progress_update` | تحديث معايير BTEC المُحقَّقة |
| `session_end` | قطع الاتصال + ملخص كامل (ثواني لكل مستوى) |

**استرداد التقرير**:
```python
from app.services.shadow_analytics import student_summary
report = student_summary("hamza_001")
# {'sessions':3, 'total_turns':42, 'level_seconds':{'merit':320, 'pass':180}}
```

---

## 🎙️ تصحيح STT — Whisper Normalization (جديد)

**المشكلة**: Whisper يُحوّل المصطلحات الأكاديمية الإنجليزية إلى نطق عربي:
- "BTEC" ← "بتسيه" / "بتسي" / "بيتيسي"
- "Distinction" ← "ديستنكشن" / "دستنكشن"
- "Merit" ← "ميريت" / "ميرت"
- "PESTLE" ← "بيستل" / "بيسطل"

**الحل** (`normalize_stt_transcript()` في `jordanian_dialect.py`):  
يُطبَّق تلقائياً في `agent_ws.py` بعد echo الـ transcript الأصلي للمستخدم، وقبل إرسالها إلى LLM.

---

## 🌐 متغيرات البيئة — Environment Variables

### Frontend (`frontend/.env.local`)
```env
OPENAI_API_KEY=sk-...              # للـ /api/chat و /api/evaluate
NEXT_PUBLIC_APP_URL=http://localhost:3000
```

### Backend (`backend/.env`)
```env
OPENAI_API_KEY=sk-...              # إلزامي لـ GPT-4o grading
DR_HAMZA_MODEL=gpt-4o              # نموذج LLM
AZURE_TTS_KEY=...                  # Azure Cognitive Services
AZURE_TTS_REGION=eastus            # منطقة Azure
TTS_ARABIC_VOICE=ar-JO-OmarNeural  # صوت ذكري أردني (Dr. Hamza - EXCLUSIVE)
LOCAL_RAG_DIR=E:\BTEC              # مجلد مستندات BTEC
LOCAL_RAG_ENABLED=false            # تفعيل/تعطيل RAG
ANALYTICS_DIR=./data/analytics     # مجلد سجلات التحليل
PORT=8000
```

---

## 🛠️ أوامر التطوير — Dev Commands

```bash
# Frontend
cd frontend && npm run dev           # :3000 — Next.js dev
npm run type-check                   # TypeScript فحط القبل commit
npm run lint                         # ESLint
npm run build                        # Production build

# Backend
cd backend
python app/main.py                   # FastAPI :8000
uvicorn app.main:app --reload        # مع إعادة تحميل

# Docker (الكل معاً)
docker compose up -d --build         # رفع الكل
docker compose logs -f backend       # متابعة logs

# Health check
curl http://127.0.0.1:8000/          # {"status":"Online","engine":"GPT-4o Forensic Mode"}
```

---

## ⚠️ أخطاء شائعة وحلولها — Common Pitfalls

| المشكلة | السبب | الحل |
|---------|-------|------|
| `localStorage` يُفقَد | تغيير أسماء المفاتيح | لا تغيّر: `eduverse-auth`, `eduverse-assessments`, `eduverse-vr`, `btec_platform_progress` |
| خطأ hydration | نسيان `'use client'` | أضفها لكل component يستخدم hooks |
| خطأ import | مسار `hooks/` الخاطئ | الجذر، ليس `src/hooks/` |
| CORS error | الأصل غير مسموح | تحقق من `backend/app/main.py` — origins تتضمن `:3000` |
| GPT-4o لا يرد | `OPENAI_API_KEY` غير موجود | تحقق من `.env` و `.env.local` |
| Whisper يكتب "بتسيه" | Whisper phonetics | `normalize_stt_transcript()` تحلّها تلقائياً |
| RAG لا يعمل | `LOCAL_RAG_ENABLED=false` | غيّر لـ `true` في `.env` |
| progress bar لا يظهر | `btec_progress` لم يُرسَل | أرسل WS frame `btec_progress` من الـ Frontend |

---

## 📅 سجل التطوير — Development Changelog

| التاريخ | الإضافة |
|---------|---------|
| Phase 1 | بنية المشروع الأساسية — Next.js + FastAPI |
| Phase 2 | نظام Cogni + Triple Persona + Azure TTS |
| Phase 3 | BTEC Staircase Grading (GPT-4o forensic) |
| Phase 4 | Avatar VRM + R3F + lip sync (viseme cues) |
| α — EDUVERSE Quantum Leap | **Local RAG** (BTEC PDF retrieval) |
| α — EDUVERSE Quantum Leap | **Shadow Analytics** (JSONL student journey) |
| α — EDUVERSE Quantum Leap | **STT Normalization** (Whisper BTEC corrections) |
| α — EDUVERSE Quantum Leap | **Distinction Boss Glow** (triple-pulse red 1.2s) |
| α — EDUVERSE Quantum Leap | **BTEC Progress Bar** (criterion completion HUD) |

---

*آخر تحديث: EDUVERSE Quantum Leap — Phase α*  
*المصدر: `EDUVERSE_MASTER_SOUL.md` في جذر المشروع*
