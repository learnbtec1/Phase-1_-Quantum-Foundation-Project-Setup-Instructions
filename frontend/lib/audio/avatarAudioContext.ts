/**
 * Single shared AudioContext for avatar TTS + analyser graph.
 * Do not construct additional AudioContexts for playback — reuse this instance.
 */
'use client';

let _shared: AudioContext | null = null;

/**
 * When false, `getSharedAudioContext()` returns null until a real UI path sets it true
 * (sync stack of click / pointer / key from `tryResumeSharedAudioContextSync` or global unlock listeners).
 * Prevents `new AudioContext()` from observability ticks or other non-gesture code.
 */
let _allocationAllowed = false;

/** Dedupes overlapping `resume()` awaits (parallel TTS paths, canvas wire, VAD). */
let _resumeInFlight: Promise<AudioContext | null> | null = null;

/** Dev probes: AudioContext state transitions (`suspended` → `running`). */
function wireSharedAudioContextStateDebug(ctx: AudioContext): void {
  const dbg =
    (typeof process !== 'undefined' && process.env.NODE_ENV === 'development') ||
    (typeof process !== 'undefined' && process.env.NEXT_PUBLIC_DEBUG_TTS === 'true');
  if (!dbg || typeof ctx.addEventListener !== 'function') return;
  try {
    ctx.addEventListener('statechange', () => {
      // eslint-disable-next-line no-console
      console.log('[avatarAudio] AudioContext transition →', ctx.state);
    });
  } catch {
    /* */
  }
}

function markAudioUnlockedIfRunning(ctx: AudioContext | null): void {
  if (typeof window === 'undefined' || !ctx) return;
  if (ctx.state === 'running') {
    (window as Window & { __AUDIO_UNLOCKED__?: boolean }).__AUDIO_UNLOCKED__ = true;
  }
}

function logUnlockDebug(message: string, extra?: Record<string, unknown>): void {
  const debug =
    (typeof process !== 'undefined' && process.env.NEXT_PUBLIC_DEBUG_TTS === 'true') ||
    (typeof process !== 'undefined' && process.env.NODE_ENV === 'development');
  if (!debug || typeof console === 'undefined') return;
  // eslint-disable-next-line no-console
  console.log(`[avatarAudio] ${message}`, extra ?? {});
}

/**
 * Singleton if it already exists.
 * Does **not** call `new AudioContext()` unless `_allocationAllowed` (after first user-facing unlock).
 */
export function peekSharedAudioContext(): AudioContext | null {
  return typeof window !== 'undefined' ? _shared : null;
}

export function getSharedAudioContext(): AudioContext | null {
  if (typeof window === 'undefined') return null;
  if (!_shared) {
    if (!_allocationAllowed) return null;
    try {
      const Ctor =
        window.AudioContext ??
        (window as Window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (Ctor) {
        _shared = new Ctor();
        wireSharedAudioContextStateDebug(_shared);
      }
    } catch {
      return null;
    }
  }
  return _shared;
}

/**
 * Call synchronously inside **onClick/onPointerDown** (same synchronous stack as the gesture).
 * Browsers associate `resume()` with user activation most reliably before any await.
 */
export function tryResumeSharedAudioContextSync(): void {
  _allocationAllowed = true;
  const ctx = getSharedAudioContext();
  if (!ctx) return;
  if (ctx.state === 'running') {
    markAudioUnlockedIfRunning(ctx);
    return;
  }
  try {
    if (ctx.state === 'suspended') {
      void ctx
        .resume()
        .then(() => markAudioUnlockedIfRunning(ctx))
        .catch((err: unknown) => {
          if (typeof console !== 'undefined' && console.warn) {
            console.warn('[avatarAudio] sync-stack resume rejected — awaiting ensureAudioUnlocked:', err);
          }
        });
    }
  } catch (err: unknown) {
    if (typeof console !== 'undefined' && console.warn) {
      console.warn('[avatarAudio] tryResumeSharedAudioContextSync:', err);
    }
  }
}

/**
 * Ensures shared AudioContext is **running** (awaitable, single-flight).
 * Pass explicit `AudioContext` to resume a caller-owned instance if needed later.
 */
export async function ensureAudioUnlocked(passCtx?: AudioContext | null): Promise<AudioContext | null> {
  const ctx = passCtx ?? getSharedAudioContext();
  if (!ctx) return null;
  if (ctx.state === 'running') {
    markAudioUnlockedIfRunning(ctx);
    return ctx;
  }
  const wasSuspended = ctx.state === 'suspended';
  if (!_resumeInFlight) {
    const prevState = ctx.state;
    logUnlockDebug('ensureAudioUnlocked:start', {
      AudioContext_state: prevState,
    });
    _resumeInFlight = (async (): Promise<AudioContext | null> => {
      try {
        if (ctx.state !== 'running' && ctx.state !== 'closed') {
          await ctx.resume();
        }
      } catch (err) {
        if (typeof console !== 'undefined' && console.warn) {
          console.warn('[avatarAudio] AudioContext.resume() failed:', err);
        }
      }
      markAudioUnlockedIfRunning(ctx);
      const runningNow = ctx.state === 'running';
      logUnlockAudioResult(wasSuspended, prevState, ctx.state);
      logUnlockDebug('ensureAudioUnlocked:done', { AudioContext_state: ctx.state });
      _resumeInFlight = null;
      return ctx.state === 'closed' ? null : ctx;
    })();
  }
  return _resumeInFlight;
}

function logUnlockAudioResult(wasSuspended: boolean, prev: AudioContextState, next: AudioContextState): void {
  if (
    typeof process !== 'undefined' &&
    process.env.NODE_ENV === 'development' &&
    wasSuspended &&
    next === 'running'
  ) {
    // eslint-disable-next-line no-console
    console.log('🔊 AudioContext resumed (awaited unlock)', {
      AudioContext_was: prev,
      AudioContext_now: next,
    });
  }
}

/** Must be awaited before starting playback so the graph is not suspended (autoplay policy). */
export async function resumeSharedAudioContext(): Promise<AudioContext | null> {
  return ensureAudioUnlocked();
}

/**
 * Intended for **`addEventListener('click', …)` only** — not React `onClick`.
 * One sync body: allow ctor → `getSharedAudioContext()` → `resume()` (not awaited).
 * Log line fires immediately after; state may still read `suspended` until the microtask completes.
 */
export function hardUnlockSharedAudioNative(): void {
  _allocationAllowed = true;
  const ctx = getSharedAudioContext();
  if (!ctx) {
    if (typeof console !== 'undefined') {
      // eslint-disable-next-line no-console
      console.warn('[hard-unlock] no AudioContext');
    }
    return;
  }
  if (ctx.state === 'suspended') {
    void ctx.resume().then(() => markAudioUnlockedIfRunning(ctx));
  }
  // eslint-disable-next-line no-console
  console.log('🔊 HARD UNLOCK DONE:', ctx.state);
}

/**
 * First line of primary UI actions (ابدأ الآن، إرسال، ميكروفون، نقر منطقة الكانفاس).
 * Starts `AudioContext.resume()` synchronously — never `await` in the same handler before this.
 */
export function resumeSharedAudioFromClick(): void {
  tryResumeSharedAudioContextSync();
  const c = peekSharedAudioContext();
  // eslint-disable-next-line no-console
  console.log('AudioContext state:', c?.state ?? 'no-context');
}

let _userGestureUnlockInstalled = false;

/** Sync resume only — callers must not `await`; use `resumeSharedAudioContext` before `play()`. */
export function unlockAudioFromUserGesture(): void {
  tryResumeSharedAudioContextSync();
}

/**
 * Browser autoplay policy: resume AudioContext on first user gesture.
 * Capture phase fires before React bubbling handlers so synchronous `resume()` stays on gesture stack.
 */
export function installUserGestureAudioUnlock(): void {
  if (typeof window === 'undefined' || _userGestureUnlockInstalled) return;
  _userGestureUnlockInstalled = true;
  const unlock = (): void => {
    /** First line: allocation must be allowed inside the gesture stack before any ctor. */
    _allocationAllowed = true;
    tryResumeSharedAudioContextSync();
  };
  window.addEventListener('pointerdown', unlock, { capture: true, passive: true });
  window.addEventListener('touchstart', unlock, { capture: true, passive: true });
  window.addEventListener('keydown', unlock, { capture: true });
}

export { isAvatarAudioEnhancerEnabled } from '@/lib/audio/audioEnhancer';
