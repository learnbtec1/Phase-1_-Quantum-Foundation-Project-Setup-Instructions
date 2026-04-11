# COGNI / Eduverse — خط أساس الإيماءات الرسمي (Official Gesture Baseline)

> **قفل المالك:** هذا المستند يحدّد الخريطة المعتمدة رسمياً لنظام إيماءات الأفاتار (إجرائية + تفعيلات المحرك).  
> **لا يُعدَّل الكود أو القيم الواردة هنا إلا بإذن شخصي صريح من مالك المشروع.**  
> أي تغيير تجريبي يجب أن يُسجَّل في سجل منفصل أو فرع، مع الإبقاء على هذا الملف كمرجع للرجوع إليه.

**تاريخ التثبيت:** 2026-04-11  
**مرجع تقني:** محاور الذراع `rua*` / `lua*` حسب `armGestureReference.ts` (YXZ، مرآة اليسار).

---

## 1) `armGestureReference.ts` — `ARM_OFFSETS` (دلتا فوق `ARM_IDLE`)

| الإيماءة | اليمنى | اليسرى / ملاحظات |
|----------|--------|-------------------|
| **wave** | `ruaY = +0.8` (أمام)،`ruaZ = -0.5` (رفع) | ثابتة (بدون إزاحة يسرى إضافية) |
| **point** | `ruaY = +1.5` (مد كامل للأمام) | ثابتة |
| **think** | `ruaY = +0.5`،`ruaZ = 0` | `rlaX = 0.35` كوع نحو الجذع؛`luaZ = +0.35` رفع خفيف يسار |
| **explain** | `ruaY = +0.8` | `luaY = -0.8` أمام (معكوس) |
| **clap** | `ruaY = +1.2` نحو الوسط | `luaY = -1.2` نحو الوسط |
| **agree** | تغيير طفيف + مرآة | `ruaY +0.12` / `luaY -0.12` / `ruaZ -0.05` / `luaZ +0.05` |

---

## 2) `VRMSkeletonManager.tsx`

- `BLOCK_ALL_GESTURES = false` — قبول `avatar:gesture`.
- `FREEZE_IDLE_ANIMATIONS = false` — تنفس + تمايل رأس + ضوضاء رأس.
- **listening (`avatar:listening`):** إمالة الانتباه للأمام على **محور الرقبة Y** عبر `headposeYawRef` (وليس pitch→X كسابق). دمج `headposeBlendRef` في حساب الرقبة/الرأس (`hpNeckX/Y`, `hpHeadX/Y`).

---

## 3) ملفات التفعيل الأخرى

| الملف | السلوك المعتمد |
|--------|----------------|
| `coSpeechPlanner.ts` | `CO_SPEECH_GESTURES_DISABLED = false` |
| `avatarPerformanceBridge.ts` | `DISPATCH_PERFORMANCE_ARM_GESTURES = true` |
| `useAgentAgent.ts` | `unifiedGestureEngine.play` للاستراتيجية، لـ `Thinking` عند `thinking`، ولـ `gestureHint` بعد التحليل |
| `AvatarCanvas.tsx` | `startSpontaneousBehavior` / `stopSpontaneousBehavior` في `useEffect` الإقلاع |

---

## 4) ملاحظات تشغيل

- تشغيل ملفات **`.vrma`** يبقى اختياريًا حسب وجود الأصول تحت `public/models/animations/` وتركيب `VRMAPlayer`؛ الخط الإجرائي أعلاه مستقل عن ذلك.
- مرجع سونييت للجلسات السابقة: `my memory/sonnet/SONNET-0001.md` (أقسام سابقة مثل Draco).
