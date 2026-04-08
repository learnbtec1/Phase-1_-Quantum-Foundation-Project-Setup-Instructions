# 👨‍💻 Developer Reference — Code Integration Points

## الملفات المعدلة (المرجع الكامل)

---

## 1️⃣ `frontend/src/ai/io/tts.ts`

### التعديل الموجود:
**السطر تقريباً ~280-310**

```typescript
// ─────────────────────────────────────────────────────────────────
// BEFORE (الكود القديم)
// ─────────────────────────────────────────────────────────────────
await audio.play();  // ❌ قد ترمي NotAllowedError
return true;

// ─────────────────────────────────────────────────────────────────
// AFTER (الكود الجديد)
// ─────────────────────────────────────────────────────────────────

// ── Handle autoplay policy per browser specs ──────────────────────
// Try normal playback first. If NotAllowedError, start muted and let UI
// show an "Unmute" button (like Facebook/YouTube). This ensures we never
// get stuck with a pending promised play() that rejects silently.
const playPromise = audio.play();
if (playPromise !== undefined) {
  try {
    await playPromise;  // ✅ محاولة عادية
  } catch (playErr: unknown) {
    const err = playErr as Error;
    // Check if it's NotAllowedError (autoplay policy violation)
    if (err.name === 'NotAllowedError') {
      console.warn('[speakWithTTS] 🔇 Autoplay blocked — starting muted. User must unmute.');
      
      // Restart with muted audio to establish playback context
      audio.muted = true;  // 🔇 Start muted
      const mutePlayPromise = audio.play();
      if (mutePlayPromise !== undefined) {
        try {
          await mutePlayPromise;  // ✅ سينجح الآن
          console.log('[speakWithTTS] 🔊 Muted playback started — UI should show Unmute button');
        } catch (muteErr) {
          console.warn('[speakWithTTS] Muted playback also failed:', muteErr);
          throw muteErr;
        }
      }
      
      // Signal to UI: show "Unmute" button
      if (typeof window !== 'undefined') {
        window.dispatchEvent(new CustomEvent('cogni:autoplay-blocked', {
          detail: { audio, text },  // 📢 إرسال Audio element للواجهة
        }));
      }
    } else {
      // Other play() errors (not autoplay policy)
      throw err;
    }
  }
}
return true;
```

### نقاط مهمة:
1. ✅ `if (playPromise !== undefined)` — بعض الأجهزة قد ترجع `undefined`
2. ✅ `audio.muted = true` → تشغيل مكتوم قبل الـ unmute
3. ✅ `window.dispatchEvent('cogni:autoplay-blocked', { detail: { audio } })`
   - **CRITICAL**: تمرير `audio` element حتى تستطيع الواجهة استدعاء `audio.muted = false`

---

## 2️⃣ `frontend/src/hooks/useAgentAgent.ts`

### موقع التعديل:
**في دالة `playPCMAudio`، السطر ~310-330**

```typescript
// ─────────────────────────────────────────────────────────────────
// BEFORE
// ─────────────────────────────────────────────────────────────────
await audio.play();

// ─────────────────────────────────────────────────────────────────
// AFTER
// ─────────────────────────────────────────────────────────────────

// ── Handle autoplay policy per browser specs ──────────────────────
// Try normal playback first. If NotAllowedError, start muted and let UI
// show an "Unmute" button. This ensures we never get stuck with a
// pending promised play() that rejects silently.
const playPromise = audio.play();
if (playPromise !== undefined) {
  try {
    await playPromise;
  } catch (playErr: unknown) {
    const err = playErr as Error;
    // Check if it's NotAllowedError (autoplay policy violation)
    if (err.name === 'NotAllowedError') {
      console.warn('[useAgentAgent] 🔇 Autoplay blocked — starting muted. User must unmute.');
      
      // Restart with muted audio to establish playback context
      audio.muted = true;
      const mutePlayPromise = audio.play();
      if (mutePlayPromise !== undefined) {
        try {
          await mutePlayPromise;
          console.log('[useAgentAgent] 🔊 Muted playback started — UI should show Unmute button');
        } catch (muteErr) {
          console.warn('[useAgentAgent] Muted playback also failed:', muteErr);
          throw muteErr;
        }
      }
      
      // Signal to UI: show "Unmute" button
      if (typeof window !== 'undefined') {
        window.dispatchEvent(new CustomEvent('cogni:autoplay-blocked', {
          detail: { audio, text: fallbackText },  // تمرير text للـ fallback
        }));
      }
    } else {
      // Other play() errors
      throw err;
    }
  }
}
```

### الفرق الوحيد:
- `text` → `fallbackText` (في useAgentAgent, النص للـ fallback ليس الـ response الحقيقي)

---

## 3️⃣ `frontend/src/components/ConversationManager.tsx` ✨ **NEW FILE**

### ملف جديد كامل:

```typescript
'use client';

import { useEffect, useRef, useState } from 'react';
import { stopTTS } from '@/ai/io/tts';

export interface ConversationManagerProps {
  onSessionStart?: () => void;
  onUserSpeaking?: () => void;
  onUserSilent?: () => void;
}

export default function ConversationManager({
  onSessionStart,
  onUserSpeaking,
  onUserSilent,
}: ConversationManagerProps) {
  const [sessionStarted, setSessionStarted] = useState(false);
  const [isUserSpeaking, setIsUserSpeaking] = useState(false);
  const [isAvatarSpeaking, setIsAvatarSpeaking] = useState(false);

  const audioContextRef = useRef<AudioContext | null>(null);
  const hasInteractedRef = useRef(false);

  // ── Initialize AudioContext on first user gesture
  const initializeAudio = async () => {
    if (!hasInteractedRef.current) {
      try {
        let ctx = audioContextRef.current;
        if (!ctx) {
          ctx = new AudioContext();
          audioContextRef.current = ctx;
        }

        if (ctx.state === 'suspended') {
          await ctx.resume();  // ✅ CRITICAL: Resume first!
        }

        hasInteractedRef.current = true;
        setSessionStarted(true);

        if (typeof window !== 'undefined') {
          window.dispatchEvent(new CustomEvent('cogni:conversation:started'));
        }

        onSessionStart?.();
        console.log('[ConversationManager] ✅ AudioContext initialized, session started');
      } catch (err) {
        console.error('[ConversationManager] Failed to initialize AudioContext:', err);
      }
    }
  };

  // ── Listen for avatar speaking events
  useEffect(() => {
    const onAvatarSpeakStart = () => {
      setIsAvatarSpeaking(true);
      console.log('[ConversationManager] Avatar is now speaking');
    };

    const onAvatarSpeakEnd = () => {
      setIsAvatarSpeaking(false);
      console.log('[ConversationManager] Avatar finished speaking');
    };

    if (typeof window === 'undefined') return;

    window.addEventListener('avatar:speak:start', onAvatarSpeakStart);
    window.addEventListener('avatar:speak:end', onAvatarSpeakEnd);

    return () => {
      window.removeEventListener('avatar:speak:start', onAvatarSpeakStart);
      window.removeEventListener('avatar:speak:end', onAvatarSpeakEnd);
    };
  }, []);

  // ── Listen for VAD/user speaking events
  useEffect(() => {
    const onUserStart = () => {
      setIsUserSpeaking(true);
      
      // ✅ Force silence avatar immediately
      if (isAvatarSpeaking) {
        console.log('[ConversationManager] 🛑 User is speaking — interrupting avatar');
        stopTTS();  // pause + currentTime = 0
        if (typeof window !== 'undefined') {
          window.dispatchEvent(new CustomEvent('cogni:avatar:interrupt'));
        }
      }

      onUserSpeaking?.();
    };

    const onUserStop = () => {
      setIsUserSpeaking(false);
      onUserSilent?.();
    };

    if (typeof window === 'undefined') return;

    window.addEventListener('avatar:listening', (e: Event) => {
      const evt = e as CustomEvent;
      if (evt.detail?.active) {
        onUserStart();
      } else {
        onUserStop();
      }
    });

    window.addEventListener('cogni:user:speaking', onUserStart);
    window.addEventListener('cogni:user:silent', onUserStop);

    return () => {
      window.removeEventListener('avatar:listening', onUserStart);
      window.removeEventListener('cogni:user:speaking', onUserStart);
      window.removeEventListener('cogni:user:silent', onUserStop);
    };
  }, [isAvatarSpeaking, onUserSpeaking, onUserSilent]);

  // ── Session start overlay
  if (!sessionStarted) {
    return (
      <div className="fixed inset-0 z-[999] flex items-center justify-center
        bg-black/80 backdrop-blur-sm">
        <div className="flex flex-col items-center gap-6 text-white">
          <div className="text-6xl animate-bounce">🤖</div>
          <div className="text-center">
            <h1 className="text-3xl font-bold mb-2">مرحباً بك في Cogni</h1>
            <p className="text-gray-300 text-sm max-w-xs">
              اضغط الزر أدناه لبدء الجلسة التعليمية مع أفاتارك الشخصي
            </p>
          </div>
          <button
            onClick={initializeAudio}
            className="px-8 py-3 bg-gradient-to-r from-violet-600 to-cyan-600
              text-white font-bold rounded-full text-lg
              hover:from-violet-500 hover:to-cyan-500
              active:scale-95 transition-all duration-200
              shadow-lg shadow-violet-500/50"
          >
            ▶️ ابدأ الجلسة
          </button>
          <div className="text-xs text-gray-400 text-center max-w-xs">
            <p>📍 سيطلب منك الوصول إلى الميكروفون</p>
            <p className="mt-1">الصوت والصورة مشفرة ومحمية</p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="fixed bottom-4 left-4 text-xs text-gray-400 z-0 pointer-events-none">
      <div className="hidden">
        {isUserSpeaking && 'user:speaking'}
        {isAvatarSpeaking && 'avatar:speaking'}
      </div>
    </div>
  );
}
```

### النقاط الحرجة:
1. ✅ `AudioContext.resume()` قبل أي لعب
2. ✅ استماع لـ `avatar:speak:start/end` لتتبع حالة الأفاتار
3. ✅ استماع لـ `avatar:listening` event من useAgentAgent
4. ✅ استدعاء `stopTTS()` من `@/ai/io/tts` عند تحدث المستخدم

---

## 4️⃣ `frontend/src/app/avatar-agent/AvatarAgentClient.tsx`

### 4.A: استيراد المكون
```typescript
// في الأعلى (مع الاستيرادات الأخرى)
import ConversationManager from '@/components/ConversationManager';
```

### 4.B: إضافة state جديد
```typescript
const [audioBlocked, setAudioBlocked] = useState(false);
const [blockedAudio, setBlockedAudio] = useState<HTMLAudioElement | null>(null);
```

### 4.C: تعديل useEffect
```typescript
// BEFORE:
const onBlocked = (): void => setAudioBlocked(true);
const onUnblock = (): void => setAudioBlocked(false);
window.addEventListener('audio:blocked',       onBlocked);
window.addEventListener('avatar:speak:start',  onUnblock);

// AFTER:
const onBlocked = (e: Event): void => {
  const evt = e as CustomEvent;
  setAudioBlocked(true);
  setBlockedAudio(evt.detail?.audio ?? null);  // ✅ احفظ الـ audio element
};
const onUnblock = (): void => {
  setAudioBlocked(false);
  setBlockedAudio(null);
};
window.addEventListener('cogni:autoplay-blocked', onBlocked);  // ✅ استمع لـ event الجديد
window.addEventListener('avatar:speak:start',    onUnblock);
```

### 4.D: تحديث UI banner
```typescript
// في جزء return statement:
{audioBlocked && (
  <div className="absolute top-0 inset-x-0 z-50 flex justify-center pointer-events-auto">
    <div className="mt-3 bg-amber-900/90 backdrop-blur-md border border-amber-500/60
        rounded-full px-6 py-2 text-amber-200 text-xs font-medium shadow-lg flex items-center gap-3">
      <span>🔇 تم حجب الصوت — </span>
      {blockedAudio ? (
        <button
          onClick={() => {
            if (blockedAudio) {
              blockedAudio.muted = false;  // ✅ أزل الكتم
              blockedAudio.play().catch(err => console.warn('Unmute failed:', err));
              setAudioBlocked(false);
              setBlockedAudio(null);
            }
          }}
          className="px-3 py-1 bg-amber-500 text-amber-900 rounded-full font-semibold text-xs
            hover:bg-amber-400 transition active:scale-95"
        >
          🔊 شغّل الصوت
        </button>
      ) : (
        <span>انقر في أي مكان لتفعيل الصوت</span>
      )}
    </div>
  </div>
)}
```

### 4.E: إضافة ConversationManager في return
```typescript
return (
  <main className="relative w-full h-screen bg-[#0a0a12] overflow-hidden" dir="rtl">
    
    {/* ── Phase 4 Conversation Manager ── */}
    <ConversationManager
      onSessionStart={() => {
        console.log('[AvatarAgentClient] Session started, ready for conversation');
      }}
      onUserSpeaking={() => {
        console.log('[AvatarAgentClient] User is speaking — may interrupt avatar');
      }}
      onUserSilent={() => {
        console.log('[AvatarAgentClient] User finished speaking');
      }}
    />

    {/* PermissionBanner + باقي الـ UI */}
    {/* ... */}
  </main>
);
```

---

## 🔗 Event Flow Diagram

```typescript
// 1. في tts.ts أو useAgentAgent.ts:
audio.play().catch(err => {
  if (err.name === 'NotAllowedError') {
    audio.muted = true;
    audio.play().then(() => {
      // 📢 Dispatch event
      window.dispatchEvent(new CustomEvent('cogni:autoplay-blocked', {
        detail: { audio, text }
      }));
    });
  }
});

// 2. في AvatarAgentClient.tsx:
window.addEventListener('cogni:autoplay-blocked', (e: Event) => {
  const evt = e as CustomEvent;
  setAudioBlocked(true);
  setBlockedAudio(evt.detail?.audio);  // ✅ Get the audio element
});

// 3. في JSX Button:
<button onClick={() => {
  blockedAudio.muted = false;  // ✅ استخدم الـ element المحفوظ
  blockedAudio.play();
  setAudioBlocked(false);
}}>
  🔊 شغّل الصوت
</button>
```

---

## 📌 Critical Integration Points

### 1. استدعاء `stopTTS()` عند التقاطع
```typescript
// في ConversationManager.tsx
import { stopTTS } from '@/ai/io/tts';  // ✅ Import from exact path

if (isAvatarSpeaking) {
  stopTTS();  // ✅ Pause + reset audio
}
```

### 2. Firebase / State Management
```typescript
// لا تغيّر localStorage keys:
✅ eduverse-auth
✅ eduverse-assessments  
✅ eduverse-vr

// استخدم window.dispatchEvent بدلاً من localStorage للـ events
window.dispatchEvent(new CustomEvent('cogni:conversation:started'));
```

### 3. WebSocket Integration
```typescript
// في useAgentAgent.ts
// لا تحتاج تعديل
// وسائط المجسات (user:speaking) تُطلق من VAD تلقائياً
```

---

## ✅ Validation Checklist

Verify before deploying:

- [ ] ✅ Imports are correct (paths match)
- [ ] ✅ `stopTTS()` is imported from `@/ai/io/tts`
- [ ] ✅ `ConversationManager` is imported in `AvatarAgentClient`
- [ ] ✅ Event names match:
  - `'cogni:autoplay-blocked'` (dispatch in tts.ts)
  - `'cogni:autoplay-blocked'` (listen in AvatarAgentClient) ✅
  - NOT `'audio:blocked'` ❌
- [ ] ✅ `audio` element passed in `detail` object
- [ ] ✅ `blockedAudio.muted = false` before `.play()`
- [ ] ✅ No TypeScript errors (`npm run type-check`)
- [ ] ✅ No runtime errors in console

---

**Version: 3.0 | Updated: 2026-03-18 | Hamza | Eduverse**
