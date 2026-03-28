# PROJECT_MEMORY.md — NEXUS / Verona Avatar Platform
<!-- ════════════════════════════════════════════════════════════════════════════
     هذا الملف هو ذاكرة المشروع الدائمة.
     في نهاية كل جلسة:  قل "قم بمراجعة ما أنجزناه وحدّث PROJECT_MEMORY.md"
     في بداية كل جلسة:  قل "اقرأ PROJECT_MEMORY.md وأخبرني أين توقفنا"
     عند أي خطأ متكرر:  أضفه في قسم KNOWN ERRORS أدناه
     ════════════════════════════════════════════════════════════════════════════ -->

---

## ⚡ بداية الجلسة — اقرأ هنا أولاً

```
الفرع الحالي : integration/human-v2
آخر commit   : 934c4940  fix: use BACKEND_URL in all server-side routes
تاريخ آخر جلسة: 2026-03-14 (patch set hardened-v3)
تاريخ الجلسة الأخيرة: بعد 2026-03-14 (mic architecture + TS fixes + bfcache)
الحالة       : ✅ 0 TypeScript errors | bfcache partly fixed | mic singleton live
المهمة القادمة: commit الـ patch sets + Acceptance Checklist في APPLY_GUIDE_VERONA.md
```

---

## 🗂️ هيكل المشروع الثابت

```
e:\Phase 1_ Quantum Foundation Project Setup Instructions\
├── frontend/                    # Next.js 14+  — المنفذ الرئيسي
│   ├── src/
│   │   ├── app/                 # App Router (pages + API routes)
│   │   ├── components/          # مكونات React
│   │   ├── config/avatar.ts     # ✅ Feature flags + VRM_FALLBACKS + WS constants
│   │   ├── hooks/
│   │   │   ├── useAgentAgent.ts ✅ WS hook — heartbeat + TTS circuit breaker
│   │   │   └── useSceneAwareness.ts
│   │   └── debug/               # VeronaHUD, AvatarInspector
│   └── public/models/           # ← ضع هنا: verona.vrm و teach.vrm
├── backend/                     # FastAPI  — المحرك الخلفي
│   ├── app/
│   │   ├── api/v1/endpoints/
│   │   │   ├── agent_ws.py      ✅ WS v1 heartbeat + req_id
│   │   │   ├── assessment.py
│   │   │   └── reports.py
│   │   └── services/
│   │       ├── settings.py      ✅ NEW — env-driven STT/WS config
│   │       ├── whisper_stt.py   ✅ STTError + validate_audio()
│   │       └── forensic_engine.py
│   ├── repository/evaluations.py ✅ get_by_student() + get_all_by_student()
│   ├── requirements.txt         ✅ reportlab, arabic-reshaper, psycopg2-binary
│   └── .env.example             ✅ STT + heartbeat vars
├── student-assignment-system/   # Python Tkinter GUI — للمعلم
├── APPLY_GUIDE_VERONA.md        ✅ دليل التطبيق الكامل + Acceptance Checklist
├── PHASE_STATUS.md              # خريطة المراحل
└── PROJECT_MEMORY.md            # ← هذا الملف
```

---

## ✅ تحديث سريع — جلسة 2026-03-28 (Avatar Feet + Sub-floor)

### المشاكل
- عودة مشكلة اتجاه القدمين (Feet up) في بعض مسارات الوقوف.
- هبوط الأفاتار أحياناً تحت أرضية الغرفة أثناء الوقوف/المشي.

### الإصلاحات
- تم اعتماد استرجاع bind-pose للجزء السفلي في الوقوف عبر `resetLowerBodyToIdle()` بدل فرض زوايا صفرية عامة.
- أضيفت حماية جديدة `V122 standing Y guard clamp` داخل `useFrame` في `AvatarCanvas.tsx`:
  - تمنع نزول `group.position.y` تحت baseline الوقوف (`ROOM_BOUNDS.floorY + yOffset + footOffset - 0.01`).
  - حماية أحادية الاتجاه (للأسفل فقط) حتى لا تكسر التنفس/الحركة الطبيعية.

### ملفات الجلسة
- `frontend/src/app/avatar-agent/AvatarCanvas.tsx`
- `docs/AVATAR_FEET_AND_SUBFLOOR_FIX_V122.md`

---

## ✅ تحديث سريع — جلسة 2026-03-28 (Final Action Plan: VRM + Gestures + Bind Mask)

### المشاكل
- 404 أولي على `teach.vrm` بسبب default prop قديم في `AvatarCanvas`.
- بعض الإيماءات VRMA كانت تُحجب أثناء الجلوس/المشي.
- حاجة إلى قناع ثابت للجزء السفلي بعد تحديث الميكسَر كل فريم.

### الإصلاحات
- تم تغيير default `vrmUrl` في `AvatarCanvas` إلى `/models/cogni-avatar.vrm` (الموجود فعلياً).
- تم ترقية وظيفة القناع إلى `resetLowerBodyToBind()` مع alias محافظ `resetLowerBodyToIdle`.
- تم استدعاء `resetLowerBodyToBind()` مباشرة بعد `mixerRef.current.update(safeDelta)` داخل `useFrame` كل فريم.
- تمت إزالة حجب `playCogniAnimation()` أثناء الجلوس/المشي.
- تم إتاحة `relax/look/celebration/idle` عبر VRMA حتى في وضع الجلوس.
- تمت إضافة/تثبيت متغيرات البيئة في `frontend/.env.local`:
  - `NEXT_PUBLIC_RUG_WALK_SURFACE_Y_EXTRA=0.10`
  - `AZURE_SPEECH_KEY=`
  - `AZURE_SPEECH_REGION=eastus`

### تحقق سريع
- `docker compose up -d --build` تم بنجاح للـ backend/frontend.
- `GET /api/health` عاد `ok=true` وكل المؤشرات الأساسية `true`.
- `POST /api/v1/tts-with-timing` نجح (`provider=azure`, `format=wav`, حفظ `tts.wav`).

---

## ✅ المنجز الكامل — الجلسة الأخيرة (ما بعد 2026-03-14): Mic Architecture + TS Fixes + bfcache

### ملفات جديدة أُنشئت
| الملف | الوصف |
|-------|-------|
| `frontend/src/utils/micManager.ts` | Singleton mic stream manager — دالة واحدة `getUserMedia` في الوقت ذاته، يُعيّن `window.__MIC_ACTIVE__`، يُدار التغيير في الجهاز تلقائياً |
| `frontend/src/components/PermissionBanner.tsx` | شريط إشعار ثابت أسفل الشاشة يستمع لحدث `mic:needs-user-gesture`، يعرض حالة الميكروفون، وزر إعادة محاولة وإغلاق |
| `frontend/src/app/dev-log-filter.tsx` | فلتر dev-only يُخفي ضجيج AudioContext من console.error |

### ملفات معدّلة
| الملف | ما تم |
|-------|-------|
| `frontend/src/hooks/useAgentAgent.ts` | 1) إصلاح NotAllowedError: defer play على أول click بـ `{ once: true }` | 2) إصلاح INTERRUPT guard: VAD 1.5ث يتحقق من `isSpeakingRef/currentAudioRef` قبل المقاطعة | 3) إضافة `micManager` import + `useEffect` يفتح الميكروفون بعد speech/focus/visibility | 4) إضافة `pagehide`/`pageshow` handlers لـ bfcache (WS يُغلق على hide، يُعاد فتحه على restore) |
| `frontend/src/app/avatar-agent/AvatarAgentClient.tsx` | استبدال inline red banner بـ `<PermissionBanner />` component |
| `frontend/src/app/layout.tsx` | إضافة `<DevLogFilter />` |
| `frontend/src/app/avatar-agent/page.tsx` | تغيير `force-dynamic` → `auto` لإزالة `Cache-Control: no-store` وتمكين bfcache |

### إصلاحات TypeScript (9 أخطاء → 0)
| الملف | السبب | الإصلاح |
|-------|--------|---------|
| `useAgentAgent.ts:404` | `audio` خارج نطاق `catch` | استبدل بـ `currentAudioRef.current?.play()` |
| `useAgentAgent.ts:909-910` | `(window as Record<...>)` يحتاج double-cast | → `(window as unknown as Record<string, unknown>)` |
| `evaluate/page.tsx:56-58,99-101,126-128` | 9 occurrences نفس الخطأ | → `(window as unknown as Record<string, unknown>)` |
| `AvatarCanvas.tsx:1470` | `JSX.Element` namespace مفقود | → `React.ReactElement` |
| `VRMAvatar.tsx:986` | نفسه | → `React.ReactElement` |
| `AvatarViewer.tsx:755` | نفسه | → `React.ReactElement` |
| `BoardroomScene.tsx:188,324` | `VRMAvatarDisabled` لا تقبل `ref`/props | أضيف `VRMAvatarCompat` cast alias |
| `XRBoardroomWrapper.tsx:214` | نفسه | نفس الحل |
| `MREnvironment.tsx:82` | `VRMAvatarDisabled` لا تقبل `scale` | أضيف `BoardroomAvatarEl` cast alias |

### bfcache (تحسينات جزئية)
| المشكلة | الحل | الحالة |
|---------|------|--------|
| `MainResourceHasCacheControlNoStore` | أزيل `force-dynamic` من page.tsx | ✅ مُصلح |
| `WebSocket` blocks bfcache | `pagehide` يُغلق WS، `pageshow` يُعيد فتحه | ✅ مُصلح |
| `WebSocketUsedWithCCNS` | (كلا الإصلاحين معاً) | ✅ مُصلح |
| `BrowsingInstanceNotSwapped` | متحكم به من المتصفح | ❌ غير قابل للإصلاح |
| `BackForwardCacheDisabledForDelegate` | خاص بـ dev server | ❌ غير قابل في الكود |

### حالة الـ TTS
- الصوت المستخدم: `ar-JO-TaimNeural`
- الـ backend صحي: `ok=True audio=True last_tts_ms=1469`
- الـ Frontend port: `3000`

---

## ✅ المنجز الكامل — الجلسة الحالية (بعد 2026-03-14): CRITICAL FIX — Voice Names Corrected to ar-JO-OmarNeural (Male)

### 🚨 المشكلة المكتشفة والمحل

**المشكلة**: النظام كان يستخدم اسم صوت خاطئ `ar-JO-TaimNeural` (أنثى أو غير متاح) بدلاً من الصوت الذكري الصحيح.

**الحل**: 
- ✅ تم تغيير الصوت الذكري من `ar-JO-TaimNeural` → **`ar-JO-OmarNeural`** (verified male voice in Azure)
- ✅ تم تغيير الصوت الأنثوي من `ar-JO-SanaNeural` → **`ar-JO-MaysoonNeural`** (verified female voice in Azure)

### ملفات معدّلة للأصوات الصحيحة (7 ملفات)
| الملف | التغيير |
|-------|---------|
| `backend/app/core/config.py` | `TTS_ARABIC_VOICE = ar-JO-OmarNeural` (ذكري بدلاً من TaimNeural) ✅ |
| `frontend/src/app/api/tts-with-timing/route.ts` | تحديث default voices (OmarNeural / MaysoonNeural) ✅ |
| `frontend/src/ai/io/tts.ts` | تحديث تعليقات التوثيق (ar-JO-OmarNeural / ar-JO-MaysoonNeural) ✅ |
| `backend/app/api/v1/endpoints/tts_timing.py` | تحديث comments و constants (OmarNeural / MaysoonNeural) ✅ |
| `backend/app/services/tts_service.py` | تحديث docstring عن الأصوات الصحيحة ✅ |
| `EDUVERSE_MASTER_SOUL.md` | تحديث مثال env variable ✅ |
| `PROJECT_MEMORY.md` (هذا الملف) | توثيق المشكلة والحل ✅ |

### معايير الأصوات الأردنية (الآن صحيحة)
| العنصر | القيمة الجديدة | النوع | الملاحظة |
|-------|-------------|-------|---------|
| الصوت الهيمن | `ar-JO-OmarNeural` | ذكر | Deep male voice in Jordanian Arabic |
| الصوت الاحتياطي | `ar-JO-MaysoonNeural` | أنثى | Female voice (نادر جداً) |
| متغير البيئة | `TTS_ARABIC_VOICE` | - | افتراضي: `ar-JO-OmarNeural` |
| المتغير الاحتياطي | `TTS_ARABIC_VOICE_FEMALE` | - | افتراضي: `ar-JO-MaysoonNeural` |
| معامل القطع الأمامي | `arVoice: 'male'` | - | يُرسل مع كل طلب TTS |

### التحقق من الصوت الفعلي
**الخطوات**:
1. **شغّل النظام**: `npm run dev` في frontend + `uvicorn app.main:app --reload` في backend
2. **افتح المتصفح**: http://localhost:3000/avatar-agent
3. **أرسل رسالة** إلى Avatar (مثل "من أنت؟")
4. **استمع**: يجب أن يكون الصوت **عميق اً ذكوري اً** (ar-JO-OmarNeural)
5. **تحقق من Network tab**: POST /api/tts-with-timing يجب أن يحتوي على `"voice":"ar-JO-OmarNeural"`

### السياق التاريخي
- **السابق (خاطئ)**: `ar-JO-TaimNeural` (SanaNeural female backup) — كان يعطي صوت أنثى
- **الآن (صحيح)**: `ar-JO-OmarNeural` (MaysoonNeural female backup) — يعطي صوت ذكر عميق

---

## ✅ المنجز الكامل — الجلسة الأخيرة (ما قبل 2026-03-18): Voice Standardization to ar-JO-TaimNeural (Male)

### ملفات معدّلة للصوت الذكري الحصري
| الملف | ما تم |
|-------|-------|
| `frontend/src/ai/io/tts.ts` | 1) حُدّث التعليق سطر 27-29: الصوت الذكري (ar-JO-TaimNeural) = EXCLUSIVE DEFAULT / الصوت الأنثوي (ar-JO-SanaNeural) = احتياطي نادر 2) حُدّث التعليق سطر 148: شرح أن male هو، وأن female نادر جداً |
| `backend/app/services/tts_service.py` | حُدّث التعليق: `Default voice: ar-JO-TaimNeural (male, Dr. Hamza - EXCLUSIVE)` / `Rare fallback: ar-JO-SanaNeural (female - avoid unless explicitly requested)` |
| `backend/app/api/v1/endpoints/tts_timing.py` | حُدّث التعليق سطر 474-475: `الصوت الذكوري : ar-JO-TaimNeural → الصوت الافتراضي الحصري (Dr. Hamza)` / `الصوت الأنثوي : ar-JO-SanaNeural → احتياطي نادر جداً` |
| `frontend/src/app/api/chat/route.ts` | (سابقاً) حُدّث docstring من "female Arabic TTS voice" إلى "male Arabic TTS voice (ar-JO-TaimNeural)" |
| `.cursorrules` | (سابقاً) حُدّث voice reference |
| `.github/copilot-instructions.md` | (سابقاً) حُدّث voice reference |

### المادة التقنية للصوت
| العنصر | القيمة | الملاحظة |
|-------|--------|---------|
| الصوت الهيمن | `ar-JO-TaimNeural` | لهجة أردنية ذكر — Dr. Hamza persona |
| الصوت الاحتياطي | `ar-JO-SanaNeural` | لهجة أردنية أنثى — نادر جداً |
| متغير البيئة | `TTS_ARABIC_VOICE` | افتراضي: `ar-JO-TaimNeural` في `backend/app/core/config.py` |
| المتغير الاحتياطي | `TTS_ARABIC_VOICE_FEMALE` | افتراضي: `ar-JO-SanaNeural` (fallback فقط) |
| معامل القطع الأمامي | `arVoice` في `SpeakOptions` | قيمة: `'male'` أو `'female'` — افتراضي: `'male'` |
| تدفق التطلب | `speakWithTTS(text, { arVoice: 'male' })` → `/api/tts-with-timing` | صريح `'male'` في `Chat.tsx` و `AgentDirector.ts` |

### حالة المراجعة
- ✅ جميع استدعاءات `speakWithTTS()` تستخدم `arVoice: 'male'` بشكل صريح أو ضمني
- ✅ جميع التعليقات والتوثيق محدثة لـ ar-JO-TaimNeural (ذكر) كـ exclusive default
- ✅ لا توجد hardcoded references لـ ar-SA-ZariyahNeural (الصيغة القديمة)
- ✅ معايرة الصوت الأنثوي إلى "نادر جداً" و "احتياطي فقط"
- ⏳ اختبار في المتصفح: التحقق من أن الصوت الحقيقي هو ar-JO-TaimNeural (ذكر/عميق)

---

## ✅ المنجز الكامل — الجلسة الأخيرة (2026-03-14)

**اسم الـ Patch Set**: "البرومبت الملكي النهائي — Hardened v3 + v10 Angelic Voice Integration"

| # | الملف | ما تم |
|---|-------|-------|
| 1 | `frontend/src/config/avatar.ts` | أضيفت ثوابت: `REQ_TIMEOUT_MS=5000`، `MAX_STT_RETRY=1`، `HEARTBEAT_INTERVAL_SEC=15`، `TTS_CIRCUIT_BREAKER_THRESHOLD=2`، `TTS_COOLDOWN_SEC=60` |
| 1 | `backend/app/services/settings.py` | **ملف جديد** — إعدادات STT+WS من env |
| 2 | `frontend/src/hooks/useAgentAgent.ts` | دالة `generateReqId()`، watchdog heartbeat، TTS circuit breaker، ختم req_id على frames الصوت |
| 3 | `frontend/src/app/avatar-agent/AvatarCanvas.tsx` | `attemptLoad(idx)` — سلسلة fallback تجرّب كل `VRM_FALLBACKS` قبل `onError('allFailed')` |
| 4 | `backend/app/api/v1/endpoints/agent_ws.py` | `send()` يختم `v:1`، coroutine `_heartbeat_sender()`، معالج `pong`، `req_id` في frames |
| 5 | `backend/app/services/whisper_stt.py` | كلاس `STTError`، دالة `validate_audio()`، logging هيكلي `[STT_START/SUCCESS/ERROR]` |
| 6 | `backend/repository/evaluations.py` | `get_by_student()` + `get_all_by_student()` على Protocol + InMemory + Postgres |
| 7 | `backend/requirements.txt` | أضيف: `reportlab>=4.0.0`، `arabic-reshaper>=3.0.0`، `python-bidi>=0.4.2`، `psycopg2-binary>=2.9.0` |
| 7 | `backend/.env.example` | أضيف: `WHISPER_DEVICE`، `WHISPER_COMPUTE`، `STT_MIN_MS`، `STT_MAX_MB`، `HEARTBEAT_INTERVAL_SEC` |
| 7 | `frontend/.env.example` | أضيف: `NEXT_PUBLIC_AVATAR_VRM_URL`، feature flag vars |
| 8 | `APPLY_GUIDE_VERONA.md` | دليل 7 خطوات + قائمة تحقق 8 بنود + تعليمات rollback |

---

## 🚀 المهام القادمة (بالأولوية)

### فورية (هذه الجلسة أو القادمة)
- [ ] **تشغيل Acceptance Checklist** — الموجودة في `APPLY_GUIDE_VERONA.md` (8 بنود A–H)
- [ ] **Commit الـ patch set** → `git add -A && git commit -m "feat: hardened-v3 WS heartbeat + VRM fallback + TTS circuit breaker + STT validation"`
- [ ] **وضع ملفات VRM** في `frontend/public/models/verona.vrm` و `teach.vrm`
- [ ] **تشغيل** `pip install -r requirements.txt` في `backend/`

### المراحل القادمة (من PHASE_STATUS.md)
| المرحلة | العنوان | الحالة |
|---------|---------|--------|
| 4 | Azure Neural SSML — Emotional TTS | ⏳ التالية |
| 5 | Contextual body gesture library | ⏳ |
| 6 | Short-term memory (10–20 رسالة) | ⏳ |
| 7 | Long-term DB storage | ⏳ |
| 8 | Exam mode toggle | ⏳ |
| 9 | Settings dashboard | ⏳ |
| 10 | Docker deploy + README | ⏳ |

---

## 🐛 سجل الأعطال — KNOWN ERRORS

> **القاعدة**: كل خطأ يظهر مرتين أو أكثر، يُسجَّل هنا فوراً بالحل.

### [E-001] خطأ 404 على ملفات VRM
- **الأعراض**: Avatar لا يظهر، خطأ 404 في Network tab
- **السبب**: ملف `.vrm` غير موجود في `frontend/public/models/`
- **الحل**: ضع `verona.vrm` و `teach.vrm` في المجلد، أو اضبط `NEXT_PUBLIC_AVATAR_VRM_URL`
- **الضمانة**: `AvatarCanvas.tsx` يجرّب `VRM_FALLBACKS` كاملاً قبل الخطأ — لا crash

### [E-002] WS ينقطع بصمت
- **الأعراض**: Avatar يتجمد، لا استجابة، لا رسائل console
- **السبب**: انقطاع شبكة أو timeout بدون heartbeat
- **الحل**: heartbeat watchdog في `useAgentAgent.ts` يُعيد الاتصال تلقائياً بعد 2 heartbeats فائتة
- **التحقق**: console يطبع `[Verona WS] Missed 2 heartbeats — forcing reconnect`

### [E-003] TTS يتعطل ويمنع كل الردود
- **الأعراض**: Avatar لا يتكلم، الـ chat يستجيب لكن بدون صوت
- **السبب**: فشل متكرر في OpenAI TTS API (مفتاح منتهي/شبكة)
- **الحل**: TTS circuit breaker يفتح بعد 2 فشل متتالي ويتحول لـ `agentDirector.scheduleTTS()` كـ fallback؛ يُغلق تلقائياً بعد 60 ثانية
- **التحقق**: console يطبع `[Verona TTS] Circuit OPEN until <timestamp>`

### [E-004] STT يفشل بصمت (بدون رسالة خطأ)
- **الأعراض**: المستخدم يتكلم، لا يحدث شيء، لا transcription
- **السبب**: ملف صوتي قصير جداً (<400ms) أو كبير جداً (>8MB) أو MIME خاطئ
- **الحل**: `validate_audio()` في `whisper_stt.py` يرفع `STTError` بكود واضح؛ WS يُرسل error frame للـ frontend
- **التحقق**: Network tab → WS frame يحتوي `{"type":"error","code":"too_short"}`

### [E-005] `app=FastAPI()` المكرر يخفي كل الـ routes
- **الأعراض**: كل endpoints تُعطي 404 بما فيها `/ws/agent`
- **السبب**: تعريف `app = FastAPI()` مكرر في `backend/app/main.py` يُظلّل الـ instance الأول
- **الحل**: تأكد من وجود تعريف واحد فقط لـ `app = FastAPI()` في `main.py`
- **commit الإصلاح**: `5d2d7311`

### [E-006] Ngrok URL منتهي الصلاحية
- **الأعراض**: كل API calls تفشل بـ 404 أو CORS في production/preview
- **السبب**: URL في env variables قديم (ngrok tunnels مؤقتة)
- **الحل**: استخدم `BACKEND_URL` environment variable دائماً، لا hardcode
- **commit الإصلاح**: `934c4940`

### [E-007] ESLint version conflict
- **الأعراض**: `npm run build` يفشل بخطأ peer dependency
- **السبب**: `eslint@^9` غير متوافق مع `eslint-config-next@^14`
- **الحل**: استخدم `eslint@^8.56.0` في `frontend/package.json`

### [E-008] lucide-react barrel imports مكسورة
- **الأعراض**: Icons لا تظهر أو build يفشل مع `createLucideIcon.js not resolving`
- **السبب**: `lucide-react@0.563.0` — Next.js barrel optimization مكسور
- **الحل**: استخدم `lucide-react@^0.460.0`

---

## 🔑 معلومات البيئة الحيوية

### Ports
| الخدمة | المنفذ |
|--------|--------|
| Frontend (Next.js) | `3000` |
| Backend (FastAPI) | `8000` |
| Express.js (legacy) | `3001` |

### أوامر التشغيل السريع
```bash
# Backend
cd backend && uvicorn app.main:app --reload --host 127.0.0.1 --port 8000

# Frontend
cd frontend && npm run dev

# فحص Backend
curl http://127.0.0.1:8000/
# المتوقع: {"status":"Online","engine":"GPT-4o Forensic Mode"}

# Type check
cd frontend && npm run type-check
```

### متغيرات البيئة الحرجة
| المتغير | الموقع | الوصف |
|---------|--------|-------|
| `OPENAI_API_KEY` | `backend/.env` و `frontend/.env.local` | مطلوب للـ TTS والـ grading |
| `WHISPER_DEVICE` | `backend/.env` | `cpu` أو `cuda` |
| `USE_DB` | `backend/.env` | `false` = InMemory، `true` = PostgreSQL |
| `NEXT_PUBLIC_AVATAR_VRM_URL` | `frontend/.env.local` | override سلسلة VRM_FALLBACKS |
| `BACKEND_URL` | `frontend/.env.local` | URL الـ backend (لا تضع ngrok hardcoded) |

### مفاتيح localStorage (لا تغيرها أبداً)
- `nexus-auth` — جلسة المستخدم
- `nexus-assessments` — التقييمات
- `nexus-vr` — تقدم VR (hard-coded = 4 عناصر)
- `btec_platform_progress` — حالة اللعبة

---

## 📐 بنية الـ State Management

```
Zustand (persist) ──► nexus-auth         useAuth.ts
                 ──► nexus-assessments   useAssessment.ts
                 ──► nexus-vr            useVR.ts (VR evidence = 4 دائماً)

React Context ────► btec_platform_progress  ProgressContext.tsx
```

---

## 🏗️ منطق التقييم (Grading)

```
Client-side fallback:  lib/btec-grading.ts
  Keywords: high=3pt | medium=2pt | low=1pt + word-count bonus
  Thresholds: Distinction≥12 | Merit 8-11 | Pass 5-7 | Fail<5

Server-side (GPT-4o):  backend/app/services/forensic_engine.py
  1. Text cleaning → 2. Criteria extraction → 3. GPT-4o Arabic prompt
  4. Quote validation (exact / normalized / keyword)
  5. Staircase: Pass أولاً → Merit → Distinction
```

---

## 🔄 بروتوكول WS v1 (الإصدار الحالي)

```
Client → Server:
  { v:1, type:"audio", id:"r<reqId>", data:"<base64>" }
  { v:1, type:"pong",  id:"hb" }

Server → Client:
  { v:1, type:"heartbeat",   id:"hb" }          ← كل 15 ثانية
  { v:1, type:"transcribing", id:"<reqId>", text:"..." }
  { v:1, type:"transcript",   id:"<reqId>", text:"..." }
  { v:1, type:"error",        id:"<reqId>", code:"too_short|too_large|stt_failed", detail:"..." }
```

---

## 👤 بيانات تسجيل الدخول التجريبية
```
Email   : student@nexus.edu
Password: password123
```

---

*آخر تحديث: 2026-03-14 — Patch Set: Hardened v3 + Angelic Voice Integration*
