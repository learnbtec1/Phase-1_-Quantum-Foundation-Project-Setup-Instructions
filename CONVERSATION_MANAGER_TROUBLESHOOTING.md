# 🔍 Troubleshooting & Edge Cases

## المشاكل الشائعة والحلول

### ❌ المشكلة #1: الصوت المكتوم لا يزال لا يعمل

**السبب:**
```
audio.muted = true; audio.play() → Promise.resolve()
// لكن الصوت الفعلي لا يشتغل
```

**الحل:**
```typescript
// في ConversationManager.tsx
const initializeAudio = async () => {
  let ctx = audioContextRef.current || new AudioContext();
  
  // ✅ CRITICAL: Resume FIRST قبل أي play()
  if (ctx.state === 'suspended') {
    await ctx.resume();  // <-- يجب هذا!
  }
  
  audioContextRef.current = ctx;
  // الآن audio.play() سيعمل
};
```

**تحقق:**
- اضغط الزر "ابدأ الجلسة" ✅
- DevTools Console يجب أن يقول: `AudioContext initialized`
- RefreshPage → حاول مرة أخرى

---

### ❌ المشكلة #2: Notification banner لا تختفي

**السبب:**
```typescript
// خطأ شائع:
setAudioBlocked(false);  // لكن blockedAudio ما زال موجود

// User clicks "شغّل الصوت" لكن الـ state ما تغيّر
```

**الحل:**
```typescript
{blockedAudio ? (
  <button
    onClick={() => {
      if (blockedAudio) {
        // ✅ ثلاث خطوات:
        1. blockedAudio.muted = false;     // أزل الكتم
        2. await blockedAudio.play();      // شغّل الصوت
        3. setAudioBlocked(false);         // أخفِ الـ UI
           setBlockedAudio(null);          // امسح الـ reference
      }
    }}
  >
    شغّل الصوت
  </button>
) : null}
```

---

### ❌ المشكلة #3: Avatar يتحدث فوق المستخدم

**السبب:**
```typescript
// ConversationManager لم يتم تفعيله
// أو avatar:listening event لم يُطلق

// → Avatar لا تعرف أن المستخدم يتحدث
```

**الحل:**
تحقق من الـ event chain:
```
1. User clicks mic button
   ↓
2. useAgentAgent → toggleListening()
   ↓
3. emitListeningEvent(true)
   ↓
4. window.dispatchEvent('avatar:listening', { active: true })
   ↓
5. ConversationManager.useEffect يستمع
   ↓
6. setIsUserSpeaking(true) → stopTTS()
```

**Debug logs:**
```typescript
// في ConversationManager.tsx
window.addEventListener('avatar:listening', (e: Event) => {
  const evt = e as CustomEvent;
  console.log('[ConversationManager] avatar:listening event:', evt.detail);
  if (evt.detail?.active) {
    console.log('→ User started speaking, stopping avatar...');
  }
});
```

---

### ❌ المشكلة #4: audio.play() Promise تعليق

**السبب:**
```typescript
const playPromise = audio.play();
await playPromise;  // تعليق هنا إذا كان Android

// على هواتف Android، play() قد ترجع undefined بدلاً من Promise
```

**الحل:**
```typescript
// ✅ الكود الحالي يتعامل مع هذا:
const playPromise = audio.play();
if (playPromise !== undefined) {  // <-- تحقق أولاً
  try {
    await playPromise;
  } catch (err) {
    // معالجة الخطأ
  }
}
```

**لا تحتاج تعديل** — الحل موجود بالفعل ✅

---

### ❌ المشكلة #5: ConversationManager overlay لا تختفي

**السبب:**
```typescript
// sessionStarted = false
// لكن initializeAudio() فشلت بصمت

// → المستخدم انقر لكن ما حصل شيء
```

**الحل:**
```typescript
// في ConversationManager.tsx
const initializeAudio = async () => {
  try {
    // ... your code ...
    setSessionStarted(true);  // ✅ MUST be called
    console.log('✅ Session started');
  } catch (err) {
    console.error('❌ Failed:', err);
    // ⚠️ لا تنسى setSessionStarted(true) حتى في حالة الخطأ
    // أو أظهِر رسالة خطأ للمستخدم
    setSessionStarted(true);  // Fallback
  }
};
```

---

### ❌ المشكلة #6: Muted audio ما زال لا يشتغل

**السبب:**
```typescript
audio.muted = true;
audio.play();  // قد تفشل على بعض المتصفحات

// Safari أو بعض الإصدارات الأقدم من Chrome
```

**الحل:**
```typescript
// Fallback to Web Speech API
if (muted audio.play() fails) {
  console.warn('Muted playback failed, using Web Speech');
  window.speechSynthesis.speak(new SpeechSynthesisUtterance(text));
}
```

**مثال كامل:**
```typescript
catch (playErr) {
  if (err.name === 'NotAllowedError') {
    audio.muted = true;
    const mutePlay = audio.play();
    
    if (mutePlay) {
      try {
        await mutePlay;
      } catch {
        // Muted playback failed too
        console.warn('Muted playback failed — using Web Speech');
        speakWebSpeech(text, lang);
        return;
      }
    }
  }
}
```

---

## 🔧 تحقق من الإعدادات

### Chrome DevTools — Audio Context

```javascript
// في Console:

// 1. تحقق من AudioContext state
const ctx = new AudioContext();
console.log(ctx.state);  // "running" أو "suspended"

// 2. جرّب Resume
if (ctx.state === 'suspended') {
  ctx.resume().then(() => console.log('✅ Resumed'));
}

// 3. اختبر audio.play()
const audio = new Audio('data:audio/wav;base64,...');
audio.play()
  .then(() => console.log('✅ Playback started'))
  .catch(err => console.error('❌', err.name, err.message));
```

### كمتصفح
```
Chrome/Edge: اضغط غرفة المقفل الأحمر في شريط العنوان → السماح بالصوت
Firefox: Settings → Permissions → Autoplay → Allow
Safari: Settings → Privacy → Autoplay (تشفير السياسة مختلف)
```

---

## 🌍 اختبار على أجهزة مختلفة

### Desktop (Windows/Mac)
```
✅ Chrome → Autoplay blocked → Muted fallback يعمل
✅ Firefox → Autoplay blocked → Muted fallback يعمل
✅ Safari → Limited autoplay → May allow muted
❌ Internet Explorer → Not supported (لا نقلق)
```

### Mobile (Android/iOS)
```
⚠️ Android Chrome → Audio playback restricted
  - Solution: User gesture required
  
⚠️ iOS Safari → Very restrictive
  - Solution: Muted video/audio plays, then unmute on user gesture
  
✅ Test: Open DevTools → Simulate Mobile
```

---

## 📋 Checklist قبل رفع للـ Production

- [ ] ✅ اختبر ConversationManager overlay يظهر
- [ ] ✅ اختبر زر "ابدأ الجلسة" يختفي بعد النقر
- [ ] ✅ اختبر Autoplay blocked banner يظهر (إذا حدث)
- [ ] ✅ اختبر زر "شغّل الصوت" يعمل (unmute)
- [ ] ✅ اختبر Avatar stop يحدث عند تحدث المستخدم
- [ ] ✅ اختبر على Mobile (Chrome + Safari)
- [ ] ✅ اختبر DevTools Console بدون errors
- [ ] ✅ اختبر أداء الصوت (latency, quality)

---

## 🛠️ Advanced Debugging

### Enable Full Event Logging
```typescript
// في ConversationManager.tsx
const eventLog = (name: string, detail?: unknown) => {
  if (process.env.NODE_ENV === 'development') {
    console.log(`[EVENT] ${new Date().toISOString().slice(11, 23)} ${name}`, detail);
  }
};

// استخدم:
eventLog('avatar:speak:start', { text });
eventLog('user:speaking', { duration: 2000 });
```

### Network Tab — TTS API
```
1. DevTools → Network
2. Filter: "tts"
3. أرسل رسالة للأفاتار
4. Watch request/response:
   - Status: 200
   - Response: { audio_base64: "...", format: "pcm" }
```

### Memory Leak Check
```javascript
// في Console:
// بعد دقائق من الاستخدام

// 1. Check current audio objects:
window.audioElements = [];
document.querySelectorAll('audio').forEach(a => {
  window.audioElements.push({
    src: a.src.slice(0, 50),
    paused: a.paused,
    currentTime: a.currentTime
  });
});
console.table(window.audioElements);

// 2. اضغط Shift+Escape → Memory profiler
// 3. اعمل بعض interactions
// 4. اختبر: هل الـ memory مستقرة؟
```

---

## 🚨 الحالات التي لم نتعامل معها (Future)

```typescript
// 1. Multi-tab synchronization
// إذا فتح المستخدم عدة tabs
// ConversationManager في كل tab سيطلب interaction ✅

// 2. Service Worker audio streaming
// إذا استخدمت اللاحقاً streaming audio
// قد تحتاج تعديل convertAudioStreamToBlob()

// 3. Audio device switching
// إذا switch بين ميك + سماعات أثناء المحادثة
// useVAD قد تحتاج reset

// → يمكن معالجة هذه لاحقاً عند الحاجة
```

---

**آخر تحديث: 2026-03-18**
