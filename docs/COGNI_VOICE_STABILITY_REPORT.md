# تقرير: استقرار صوت كوجني + توحيد الهوية الصوتية

بعد تحليل المسارين **Web Speech (احتياطي)** و**Azure/Edge TTS (رئيسي عبر Next → FastAPI)**، تم تنفيذ إصلاحات لتقليل تذبذب الصوت وتوحيد هوية كوجني.

## سبب المشكلة

1. **Web Speech API**: المتصفحات تعيد `getVoices()` بترتيب غير ثابت؛ اختيار `find()` الأول كان يغيّر الصوت بين الجمل.
2. **Azure TTS / الاحتياط**: جسر Next كان يمرّر افتراضياً **`ar-JO-OmarNeural`** بينما إعدادات الباكند الافتراضية **`ar-JO-TaimNeural`** — احتمال اختلاف عند تبديل المزود (Azure ↔ edge-tts).
3. **عدم تخزين اختيار الصوت**: إعادة بحث لكل جملة بدون تثبيت.

## الإصلاحات المنفذة

| الملف | الوصف |
|--------|--------|
| `frontend/src/ai/io/webSpeechVoice.ts` | اختيار حتمي (نقاط + ترتيب `voiceURI`)، كاش بـ `voiceURI`، `voiceschanged` يبطل الكاش لإعادة اختيار متسق. |
| `frontend/src/hooks/useAgentAgent.ts` | `speakWebSpeech` → `getStableWebSpeechVoice` + `resolveSpeakRate` مع `COGNI_PERSONA.voiceParameters.rate`؛ سجل `[useAgentAgent:TTS] Web Speech voice=`. |
| `frontend/src/app/avatar-agent/AvatarCanvas.tsx` | مسار dev `avatar:speak:text` يستخدم نفس المنتقي؛ `ar-JO` للعربية. |
| `frontend/src/app/api/tts-with-timing/route.ts` | `TTS_ARABIC_VOICE` أو افتراضي **`ar-JO-TaimNeural`**؛ `ar_voice` افتراضي **`male`**. |
| `useAgentAgent` — `fetchVisemeCuesFromTtsApi` | **`ar_voice: 'male'`** لمواءمة الفيزيمات مع صوت كوجني. |

## نتائج متوقعة

- **Web Speech**: صوت أردني/ذكوري مفضّل بشكل ثابت طالما لم تتغير قائمة أصوات النظام.
- **الخادم**: افتراضي متوافق مع `settings.TTS_ARABIC_VOICE` في الباكند عند ضبط نفس المتغير في بيئة Next.

## إصلاح إضافي — تغيّر الصوت **داخل نفس الجملة**

1. **خلل واجهة (حرج):** إطار WS `speech` من `agent_ws` يحمل **`audio_format: mp3`** (Azure)، بينما `useAgentAgent` كان يغلّف البايتات كـ **PCM داخل WAV**. ذلك يفسد فك التشفير/التشغيل وقد يُسمَع تشويش أو قطع ثم سلوك غير متسق. **الحل:** تشغيل MP3 كـ `Blob` من نوع `audio/mpeg`، وPCM كسابق، مع كشف اختياري لرؤوس RIFF/WAV.
2. **Azure SSML:** الكلمات اللاتينية (مثل `Cogni`) تُلفّ بـ `<lang xml:lang="en-GB">` في نفس الاصطناع — يُحسَب أحياناً كـ «صوت ثانٍ». **الحل:** في `_clean_tts_text` تعريب علامات ثابتة: `Cogni` → `كوجني`، `EDUVERSE` → `إيدوفيرس`، `Asas` → `أساس`.
3. **الفيزيمات:** عند وجود `viseme_cues` في إطار `speech` تُستخدم مباشرة بدل استدعاء ثانٍ لـ `/api/tts-with-timing` (أقرب لزمن الصوت الفعلي).

## ملاحظات واقعية (لا تُخفى عن المختبرين)

- محرّك **Azure** ومحرّك **edge-tts** لا يُنتجان طبقة صوتية متطابقة حرفياً حتى بنفس اسم الصوت؛ الاستقرار يعني **نفس الاسم والمسار** قدر الإمكان، وليس نفس الموجة الرقمية.
- **Web Speech** يعتمد على أصوات نظام التشغيل/المتصفح؛ إن لم يوجد صوت عربي مناسب، يبقى سلوك المتصفح الافتراضي.

## خطوات تالية مقترحة

- اختبار متكرر بعد `docker compose up --build`.
- STT: Whisper محلي أو `OPENAI_API_KEY` في الباكند (انظر `agent_ws` + `whisper_stt`).
- Locomotion: Leva — `walkForwardDistance`, `autoPatrol` في `AvatarCanvas`.
- الذاكرة العاطفية: `emotionalMemoryManager.getContextSummary()` (مدمج مسبقاً في حمولات WS عند الاستخدام).

---
*آخر تحديث: يتوافق مع الشيفرة في فرع المشروع الحالي؛ راجع الملفات أعلاه عند أي تغيير على TTS.*
