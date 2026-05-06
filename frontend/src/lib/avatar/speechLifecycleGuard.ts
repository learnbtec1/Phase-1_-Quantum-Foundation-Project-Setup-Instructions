'use client';

/**
 * Speech-lifecycle race-condition guard.
 *
 * Provides a strict state machine for `avatar:speak:start` / `avatar:speak:end`
 * window events. Sits as a CAPTURE-phase listener registered before any
 * consumer effect runs, so it sees every dispatch first and can block invalid
 * transitions via `stopImmediatePropagation()`.
 *
 * Rules enforced (matches user spec):
 *   1. `speak:end` BEFORE `speak:start`        → blocked, [SPEAK_RACE_CONDITION] PREMATURE_END
 *   2. `speak:start` while already speaking    → blocked, [SPEAK_RACE_CONDITION] OVERLAPPING_START
 *   3. Two `speak:start` within 50 ms          → blocked, DUPLICATE_START_DEBOUNCED
 *   4. Stuck "speaking" > 60 s                 → auto-recovers via forced `speak:end`
 *
 * Public API:
 *   • initSpeechLifecycleGuard()   — idempotent; call once at app boot
 *   • isSpeechLifecycleActive()    — read-only state for diagnostics
 *   • getSpeechLifecycleState()    — returns full diagnostic snapshot
 *   • dispatchSafeSpeakEnd(detail) — convenience: emits speak:end iff currently speaking
 *
 * Side effects:
 *   • Window event listeners on 'avatar:speak:start' / 'avatar:speak:end' (capture).
 *   • Console warnings when a transition is blocked (prefixed [SPEAK_RACE_CONDITION]).
 *   • Exposes `window.__speechLifecycle` for live inspection.
 */

const _state: {
  isSpeaking: boolean;
  lastStartMs: number;
  lastEndMs: number;
  blockedCount: { prematureEnd: number; overlappingStart: number; debounced: number };
  forcedEndCount: number;
} = {
  isSpeaking: false,
  lastStartMs: -Infinity,
  lastEndMs: -Infinity,
  blockedCount: { prematureEnd: 0, overlappingStart: 0, debounced: 0 },
  forcedEndCount: 0,
};

/** Minimum interval between two `speak:start` events to be considered distinct. */
const _MIN_START_GAP_MS = 50;
/** Hard ceiling: after this long, a stuck "speaking" state is force-cleared. */
const _MAX_SPEAKING_MS = 60_000;

let _forceEndTimer: ReturnType<typeof setTimeout> | null = null;
let _initialized = false;

function _now(): number {
  return typeof performance !== 'undefined' ? performance.now() : Date.now();
}

function _exposeDebug(): void {
  if (typeof window === 'undefined') return;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (window as any).__speechLifecycle = {
    isSpeaking:     _state.isSpeaking,
    lastStartMs:    _state.lastStartMs,
    lastEndMs:      _state.lastEndMs,
    blockedCount:   { ..._state.blockedCount },
    forcedEndCount: _state.forcedEndCount,
  };
}

function _onStartCapture(e: Event): void {
  const now = _now();

  // RULE 2 — overlapping start.
  if (_state.isSpeaking) {
    _state.blockedCount.overlappingStart += 1;
    e.stopImmediatePropagation();
    e.preventDefault();
    console.warn('[SPEAK_RACE_CONDITION]', {
      reason:               'OVERLAPPING_START',
      blocked:              true,
      elapsedSinceStartMs:  Math.round(now - _state.lastStartMs),
      hint:                 'New speak:start arrived while still speaking. Ignored.',
    });
    _exposeDebug();
    return;
  }

  // RULE 3 — duplicate-start debounce.
  if (now - _state.lastStartMs < _MIN_START_GAP_MS) {
    _state.blockedCount.debounced += 1;
    e.stopImmediatePropagation();
    e.preventDefault();
    console.warn('[SPEAK_RACE_CONDITION]', {
      reason:        'DUPLICATE_START_DEBOUNCED',
      blocked:       true,
      gapMs:         Math.round(now - _state.lastStartMs),
      minGapMs:      _MIN_START_GAP_MS,
    });
    _exposeDebug();
    return;
  }

  // ALLOWED — promote to speaking.
  _state.isSpeaking = true;
  _state.lastStartMs = now;
  if (_forceEndTimer) clearTimeout(_forceEndTimer);
  _forceEndTimer = setTimeout(() => {
    if (_state.isSpeaking && typeof window !== 'undefined') {
      _state.forcedEndCount += 1;
      console.warn('[SPEECH_LIFECYCLE] Forced speak:end after MAX_SPEAKING_MS — recovering from stuck state', {
        ms: _MAX_SPEAKING_MS,
      });
      // Synthetic end — let it pass through (state will flip to !isSpeaking in _onEndCapture).
      window.dispatchEvent(new CustomEvent('avatar:speak:end', { detail: { reason: 'forced_recovery' } }));
    }
  }, _MAX_SPEAKING_MS);
  _exposeDebug();
}

function _onEndCapture(e: Event): void {
  // RULE 1 — premature end (no matching start).
  if (!_state.isSpeaking) {
    _state.blockedCount.prematureEnd += 1;
    e.stopImmediatePropagation();
    e.preventDefault();
    console.warn('[SPEAK_RACE_CONDITION]', {
      reason:           'PREMATURE_END',
      blocked:          true,
      timeSinceLastEnd: _state.lastEndMs > 0 ? Math.round(_now() - _state.lastEndMs) : null,
      hint:             'speak:end arrived without matching speak:start. Ignored.',
    });
    _exposeDebug();
    return;
  }

  // ALLOWED — clear state.
  _state.isSpeaking = false;
  _state.lastEndMs = _now();
  if (_forceEndTimer) {
    clearTimeout(_forceEndTimer);
    _forceEndTimer = null;
  }
  _exposeDebug();
}

/**
 * Idempotent. Call once during app boot, before any speech consumer mounts.
 * Safe in SSR (no-op when window is undefined).
 */
export function initSpeechLifecycleGuard(): void {
  if (_initialized || typeof window === 'undefined') return;
  _initialized = true;
  // Capture phase + register before consumer effects run.
  // For window.dispatchEvent the capture/bubble distinction does not change
  // ordering across listeners attached to window, but capture is the safest
  // contract: it guarantees this listener runs before any descendant capture
  // listener that might be attached in some integration tests.
  window.addEventListener('avatar:speak:start', _onStartCapture, true);
  window.addEventListener('avatar:speak:end',   _onEndCapture,   true);
  _exposeDebug();
  console.log('[SPEECH_LIFECYCLE_GUARD_READY]');
}

/** Read-only access to the current state for diagnostics / motion gates. */
export function isSpeechLifecycleActive(): boolean {
  return _state.isSpeaking;
}

/** Full snapshot for `[FINAL_DIAGNOSIS]` aggregation. */
export function getSpeechLifecycleState(): Readonly<typeof _state> {
  return _state;
}

/**
 * Dispatch `avatar:speak:end` only if currently speaking.
 * Useful for cleanup paths that may fire end events redundantly.
 */
export function dispatchSafeSpeakEnd(detail?: Record<string, unknown>): boolean {
  if (typeof window === 'undefined') return false;
  if (!_state.isSpeaking) return false;
  window.dispatchEvent(new CustomEvent('avatar:speak:end', { detail }));
  return true;
}

/** Test helper — restores pristine state. Not part of the public production API. */
export function _resetSpeechLifecycleGuardForTests(): void {
  _state.isSpeaking = false;
  _state.lastStartMs = -Infinity;
  _state.lastEndMs = -Infinity;
  _state.blockedCount = { prematureEnd: 0, overlappingStart: 0, debounced: 0 };
  _state.forcedEndCount = 0;
  if (_forceEndTimer) {
    clearTimeout(_forceEndTimer);
    _forceEndTimer = null;
  }
  _initialized = false;
  if (typeof window !== 'undefined') {
    window.removeEventListener('avatar:speak:start', _onStartCapture, true);
    window.removeEventListener('avatar:speak:end',   _onEndCapture,   true);
  }
}
