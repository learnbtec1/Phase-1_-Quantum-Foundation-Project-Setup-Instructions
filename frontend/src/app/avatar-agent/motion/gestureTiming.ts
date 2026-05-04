'use client';
/**
 * Gesture Timing Engine
 * Provides a phase-based timing weight for intent-driven body gestures:
 *   idle → delay (80–120ms) → peak (150ms) → hold (250ms) → release (300ms) → idle
 *
 * Call tickGestureTiming(intent) once per frame to get a 0–1 weight.
 * Multiply bone deltas in intentBodyLayer (or any additive layer) by this weight.
 */

type TimingPhase = 'idle' | 'delay' | 'peak' | 'hold' | 'release';

const DELAY_MS   = 100;
const PEAK_MS    = 150;
const HOLD_MS    = 250;
const RELEASE_MS = 300;

const _s = {
  phase:        'idle' as TimingPhase,
  phaseStartMs: 0,
  lastIntent:   '',
  weight:       0,
};

function nowMs(): number {
  return typeof performance !== 'undefined' ? performance.now() : Date.now();
}

/**
 * Call once per frame with the current active intent string.
 * Returns a 0–1 timing weight that should multiply gesture bone deltas.
 */
export function tickGestureTiming(intent: string): number {
  const t       = nowMs();
  const active  = !!intent;
  const elapsed = t - _s.phaseStartMs;

  // Intent changed → restart cycle
  if (intent !== _s.lastIntent) {
    _s.lastIntent   = intent;
    _s.phase        = active ? 'delay' : 'release';
    _s.phaseStartMs = t;
  }

  switch (_s.phase) {
    case 'delay':
      if (elapsed >= DELAY_MS) {
        _s.phase        = 'peak';
        _s.phaseStartMs = t;
      }
      _s.weight = 0.05 + 0.05 * (elapsed / DELAY_MS);
      break;

    case 'peak':
      if (elapsed >= PEAK_MS) {
        _s.phase        = 'hold';
        _s.phaseStartMs = t;
      }
      _s.weight = Math.min(1, elapsed / PEAK_MS);
      break;

    case 'hold':
      if (!active || elapsed >= HOLD_MS) {
        _s.phase        = 'release';
        _s.phaseStartMs = t;
      }
      _s.weight = 1.0;
      break;

    case 'release':
      if (elapsed >= RELEASE_MS) {
        _s.phase  = 'idle';
        _s.weight = 0;
      } else {
        _s.weight = 1 - elapsed / RELEASE_MS;
      }
      break;

    default:
      _s.weight = 0;
      break;
  }

  // Non-linear shaping: faster attack, stronger peak, slower decay.
  return Math.pow(_s.weight, 0.6);
}

/** Diagnostic snapshot for logging. */
export function getGestureTimingSnapshot(): Readonly<{ phase: TimingPhase; weight: number; intent: string }> {
  return { phase: _s.phase, weight: _s.weight, intent: _s.lastIntent };
}

/** Public accessor — last weight produced by tickGestureTiming(). 0..1.
 * Non-linear curve: Math.pow(w, 0.6) → faster attack, stronger peak, slower decay.
 */
export function getGestureTimingWeight(): number {
  return Math.pow(_s.weight, 0.6);
}

/** Reset on VRM load / session reset. */
export function resetGestureTiming(): void {
  _s.phase        = 'idle';
  _s.phaseStartMs = 0;
  _s.lastIntent   = '';
  _s.weight       = 0;
}
