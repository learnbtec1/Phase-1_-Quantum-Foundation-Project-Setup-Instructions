# 🎯 Conversation Manager — NotAllowedError Fix

## المشكلة الأصلية
```
NotAllowedError: play() is not allowed without a user gesture
```

متصفح Chrome وغيره يحجبان تشغيل الصوت تلقائياً بدون تفاعل واضح من المستخدم (انقر / لمس / اضغط على لوحة المفاتيح).

---

## ✅ الحل المطبق (كامل)

### 1️⃣ معالجة الأخطاء في `tts.ts` 

**الملف:** `frontend/src/ai/io/tts.ts` (السطر ~280)

```typescript
// TRY: Normal playback أولاً
const playPromise = audio.play();
if (playPromise !== undefined) {
  try {
    await playPromise;
  } catch (playErr: unknown) {
    const err = playErr as Error;
    
    // CHECK: هل هي مشكلة سياسة التشغيل الآلي؟
    if (err.name === 'NotAllowedError') {
      console.warn('[speakWithTTS] 🔇 Autoplay blocked');
      
      // FALLBACK: شغّل مكتوماً
      audio.muted = true;
      await audio.play();
      
      // SIGNAL: أخبر الواجهة (UI) بالحجب
      window.dispatchEvent(new CustomEvent('cogni:autoplay-blocked', {
        detail: { audio, text },
      }));
    } else {
      throw err;
    }
  }
}
```

**الفكرة:**
- ✅ تحاول التشغيل الطبيعي أولاً
- 🔇 إذا فشل مع `NotAllowedError`، تشغّل الصوت **مكتوماً**
- 🎨 ترسل event `cogni:autoplay-blocked` لتخبر الواجهة

---

### 2️⃣ نفس المعالجة في `useAgentAgent.ts`

**الملف:** `frontend/src/hooks/useAgentAgent.ts` (في دالة `playPCMAudio`)

نفس pattern:
```typescript
const playPromise = audio.play();
if (playPromise !== undefined) {
  try {
    await playPromise;
  } catch (playErr: unknown) {
    const err = playErr as Error;
    if (err.name === 'NotAllowedError') {
      // Start muted, dispatch event...
    }
  }
}
```

---

### 3️⃣ مكون جديد: `ConversationManager.tsx`

**الملف:** `frontend/src/components/ConversationManager.tsx`

```typescript
export default function ConversationManager({ onSessionStart, ... }) {
  // Phase 1: عرض overlay "ابدأ الجلسة" حتى ينقر المستخدم
  if (!sessionStarted) {
    return (
      <div className="fixed inset-0 z-[999] ...">
        <button onClick={initializeAudio}>
          ▶️ ابدأ الجلسة
        </button>
      </div>
    );
  }
  
  // Phase 2: بعد النقر، يتم:
  // - إنشاء / استئناف AudioContext
  // - ترسل event 'cogni:conversation:started'
  //  - تفعيل الاستماع
}
```

**المسؤوليات:**
1. ✅ عرض overlay "ابدأ الجلسة" عند البداية
2. ✅ استدعاء `AudioContext.resume()` عند النقر
3. ✅ إدارة state: `isUserSpeaking`, `isAvatarSpeaking`
4. ✅ **قطع الأفاتار فوراً عند تحدث المستخدم** (استدعاء `stopTTS()`)

---

### 4️⃣ تعديل `AvatarAgentClient.tsx`

**الملفات المعدلة:**
- ✅ استيراد `ConversationManager`
- ✅ إضافة `blockedAudio` state
- ✅ استماع لـ `cogni:autoplay-blocked` event
- ✅ زر "🔊 شغّل الصوت" يحذف الكتم: `audio.muted = false`

```typescript
// Listen for autoplay block
useEffect(() => {
  const onBlocked = (e: CustomEvent) => {
    setAudioBlocked(true);
    setBlockedAudio(e.detail?.audio ?? null);  // احفظ الـ audio element
  };
  window.addEventListener('cogni:autoplay-blocked', onBlocked);
}, []);

// في JSX:
{audioBlocked && (
  <div className="...">
    <button onClick={() => {
      blockedAudio.muted = false;  // ⭐ أزل الكتم
      blockedAudio.play();
      setAudioBlocked(false);
    }}>
      🔊 شغّل الصوت
    </button>
  </div>
)}
```

---

## 🔄 كيفية سير العملية (Flow)

```
┌─────────────────────────────────────────────────────────┐
│ 1. صفحة تحميل → عرض overlay "ابدأ الجلسة"              │
└─────────────────────────────────────────────────────────┘
                         ⬇️  (نقرة المستخدم)
┌─────────────────────────────────────────────────────────┐
│ 2. ConversationManager.initializeAudio()                │
│    ✅ AudioContext.resume()                             │
│    ✅ event 'cogni:conversation:started'                │
│    ✅ hasInteracted = true (فتح الطريق للصوت)           │
└─────────────────────────────────────────────────────────┘
                         ⬇️  (الأفاتار يتحدث)
┌─────────────────────────────────────────────────────────┐
│ 3. speakWithTTS() → /api/tts-with-timing                │
│    ✅ audio.play() — محاولة عادية                      │
│    ✅ نجحت → تشغيل عادي 🔊                             │
│    ❌ فشلت (NotAllowedError) → مكتوم 🔇                 │
│       + event 'cogni:autoplay-blocked'                  │
└─────────────────────────────────────────────────────────┘
                    ⬇️  (browser blocked)
┌─────────────────────────────────────────────────────────┐
│ 4. AvatarAgentClient يستمع 'cogni:autoplay-blocked'    │
│    ✅ عرض زر "🔊 شغّل الصوت" بجانب الأفاتار            │
│    ✅ حفظ audio element في state                       │
└─────────────────────────────────────────────────────────┘
                    ⬇️  (نقرة المستخدم)
┌─────────────────────────────────────────────────────────┐
│ 5. زر "شغّل الصوت" → audio.muted = false              │
│    ✅ audio.play() — الآن نجحت (لأن كان مكتوماً أولاً) │
│    ✅ الصوت يبدأ 🔊                                    │
│    ✅ أخفِ الزر والـ banner                             │
└─────────────────────────────────────────────────────────┘
```

---

## 🛡️ Turn-Taking Logic (النظام الأساسي)

### عند بدء تحدث المستخدم:
```typescript
const onUserSpeaking = () => {
  setIsUserSpeaking(true);
  
  // ⭐ قطع الأفاتار فوراً
  if (isAvatarSpeaking) {
    stopTTS();  // pause + currentTime = 0
    window.dispatchEvent(new CustomEvent('cogni:avatar:interrupt'));
  }
};
```

**النتيجة:**
- ✅ `avatar:speak:start` لن يُطلق
- ✅ الأفاتار لن يتحدث فوق المستخدم
- ✅ بعد المستخدم → انتظر `/api/v1/assessment/grade` → الأفاتار يرد

---

## 📊 الملفات المعدلة

| الملف | التعديل |
|------|---------|
| `frontend/src/ai/io/tts.ts` | ✅ معالجة NotAllowedError + مكتوم fallback |
| `frontend/src/hooks/useAgentAgent.ts` | ✅ نفس المعالجة في playPCMAudio |
| `frontend/src/components/ConversationManager.tsx` | ✨ **ملف جديد** — overlay + turn-taking |
| `frontend/src/app/avatar-agent/AvatarAgentClient.tsx` | ✅ استيراد + event listening + زر unmute |

---

## 🧪 كيفية الاختبار

### ✅ Test 1: Autoplay محظور
1. افتح `http://localhost:3000/avatar-agent`
2. شوف الزر "ابدأ الجلسة" overlay
3. انقر على الزر
4. الأفاتار يجب أن يقول مرحبا
5. إذا ظهر banner amber "🔇 تم حجب الصوت" — شغّل الصوت بالزر ✅

### ✅ Test 2: Turn-taking
1. ابدأ الجلسة
2. اضغط زر الميكروفون (🎤)
3. تحدث قليلاً
4. الأفاتار **يجب أن يسكت فوراً** (stopTTS يعمل)
5. أرسل رسالة عبر الـ input
6. الأفاتار يرد ✅

### ✅ Test 3: State Logging
في Browser Console:
```
[ConversationManager] ✅ AudioContext initialized
[speakWithTTS] 🔇 Autoplay blocked — starting muted
[ConversationManager] Avatar is now speaking
[ConversationManager] 🛑 User is speaking — interrupting avatar
```

---

## 🔧 Advanced: القائمة المكتومة

إذا أردت عرض أزرار يدوية للصوت (بدلاً من الاعتماد على الـ unmute):

```typescript
{audioBlocked && !blockedAudio && (
  <button
    onClick={() => {
      // Fallback to Web Speech API
      window.speechSynthesis.speak(new SpeechSynthesisUtterance(lastReply));
    }}
    className="px-3 py-1 bg-blue-500 ..."
  >
    🗣️ استخدم Web Speech
  </button>
)}
```

---

## 📌 ملاحظات مهمة

1. **لا تعدّل localStorage keys** — `eduverse-auth`, `eduverse-assessments` إلخ محفوظة
2. **`stopTTS()` يجب أن يُستدعى من `tts.ts` مباشرة** — لا تحاول فعل copy-paste
3. **الصوت المكتوم يعمل على جميع المتصفحات الحديثة** — Firefox، Chrome، Safari
4. **ConversationManager عنصر اختياري** — يمكن إزالته إذا كان لديك نظام آخر للحجب

---

## 🎯 الهدف النهائي

✅ **لا مزيد من NotAllowedError**
✅ **تجربة سلسة بدون عودة من الأخطاء**
✅ **زر واضح جداً لـ unmute**
✅ **الأفاتار يسكت عند تحدث المستخدم**
✅ **نظام turn-taking صحيح**

---

## 🚀 الخطوات التالية

1. **اختبر في متصفح جديد** (بدون cache)
2. **فعّل DevTools Console** لمراقبة الـ logs
3. **قيّس أداء الصوت** مع الـ mic وبدونه
4. **ادمج ConversationManager في صفحات أخرى** إذا لزم الحال

---

**محدثة: 2026-03-18 | حمزة | إيدوفيرس Platform v3.0**
