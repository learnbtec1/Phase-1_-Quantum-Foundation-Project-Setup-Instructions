/**
 * Avatar Director — AI-controlled performance orchestrator.
 *
 * Takes an `inferResponsePlan` result and converts it into a full timed
 * performance schedule dispatched as avatar:* custom events.
 *
 * New events introduced here (handled by AvatarCanvas):
 *   avatar:blink    { style: 'normal'|'slow'|'double'|'rapid', count?: number }
 *   avatar:nod      { intensity: number, duration?: number }
 *   avatar:laugh    { intensity: number, duration?: number }
 *   avatar:headpose { yaw: number, pitch: number, duration: number }
 *
 * Existing events also dispatched:
 *   avatar:emotion  { emotion: string }
 *   avatar:gesture  { type, side, duration, intensity, variance }
 */

import type { ResponsePlan } from './brain';

// Rough Arabic speech rate: ~4 chars/second (conservative, includes pauses)
function estimateSpeechMs(text: string): number {
  return Math.max(2000, text.replace(/\s+/g, ' ').trim().length * 210);
}

function dispatch(name: string, detail: Record<string, unknown>): void {
  if (typeof window === 'undefined') return;
  window.dispatchEvent(new CustomEvent(name, { detail }));
}

function later(ms: number, fn: () => void): void {
  if (ms <= 0) { fn(); return; }
  setTimeout(fn, ms);
}

/**
 * Schedule a complete avatar performance from an AI ResponsePlan.
 * Call once per AI reply immediately after receiving the LLM response.
 */
export function directAvatarPerformance(plan: ResponsePlan): void {
  const { text, emotion, gestures, head } = plan;
  const speechMs = estimateSpeechMs(text);

  // ── 1. Instant emotion ─────────────────────────────────────────────────────
  dispatch('avatar:emotion', { emotion });

  // ── 2. Emotion-specific immediate reactions ────────────────────────────────

  if (emotion === 'surprised') {
    // Double-blink + head jerk back then forward
    dispatch('avatar:blink',    { style: 'double', count: 2 });
    dispatch('avatar:headpose', { yaw: 0,    pitch: -0.10, duration: 380 });
    later(400,  () => dispatch('avatar:headpose', { yaw: 0.07, pitch: 0,    duration: 500 }));
    later(920,  () => dispatch('avatar:headpose', { yaw: 0,    pitch: 0,    duration: 700 }));
  }

  if (emotion === 'celebration') {
    dispatch('avatar:laugh',   { intensity: 0.95, duration: 1600 });
    dispatch('avatar:gesture', { type: 'wave', side: 'both',     duration: 3.0, intensity: 1.0, variance: Math.random() });
    dispatch('avatar:blink',   { style: 'rapid', count: 3 });
  } else if (emotion === 'excited') {
    dispatch('avatar:laugh',   { intensity: 0.65, duration: 1000 });
    dispatch('avatar:gesture', { type: 'openHand', side: 'both', duration: 2.2, intensity: 0.9, variance: Math.random() });
    dispatch('avatar:blink',   { style: 'rapid', count: 2 });
  }

  if (emotion === 'happy') {
    dispatch('avatar:blink',   { style: 'slow' });
    dispatch('avatar:gesture', { type: 'beat', side: 'right',    duration: 1.4, intensity: 0.6, variance: Math.random() });
  }

  if (emotion === 'friendly') {
    dispatch('avatar:blink',   { style: 'slow' });
    dispatch('avatar:gesture', { type: 'openHand', side: 'right', duration: 1.6, intensity: 0.7, variance: Math.random() });
  }

  if (emotion === 'thinking') {
    // Lean head sideways, slow deliberate blinking
    dispatch('avatar:headpose', { yaw: 0.13, pitch: -0.06, duration: Math.min(speechMs * 0.75, 4500) });
    dispatch('avatar:blink',    { style: 'slow' });
  }

  if (emotion === 'sad') {
    // Head slightly drooped, slow mournful blinks
    dispatch('avatar:headpose', { yaw: 0,    pitch: 0.12, duration: Math.min(speechMs * 0.80, 5500) });
    dispatch('avatar:blink',    { style: 'slow' });
  }

  if (emotion === 'angry' || emotion === 'strictEvaluation') {
    dispatch('avatar:gesture',  { type: 'point', side: 'right', duration: 1.6, intensity: 1.0, variance: Math.random() });
    dispatch('avatar:blink',    { style: 'rapid', count: 1 });
    dispatch('avatar:headpose', { yaw: 0,    pitch: -0.07, duration: 900 });
  }

  if (emotion === 'encouraging') {
    dispatch('avatar:gesture', { type: 'openHand', side: 'both', duration: 2.0, intensity: 0.85, variance: Math.random() });
  }

  if (emotion === 'blush') {
    dispatch('avatar:blink',    { style: 'slow' });
    dispatch('avatar:headpose', { yaw: 0.09,  pitch: 0.07, duration: Math.min(speechMs * 0.60, 3200) });
  }

  if (emotion === 'sleepy') {
    dispatch('avatar:blink',    { style: 'slow' });
    dispatch('avatar:headpose', { yaw: 0,    pitch: 0.09, duration: Math.min(speechMs, 5500) });
  }

  if (emotion === 'relax') {
    dispatch('avatar:blink',    { style: 'slow' });
  }

  // ── 3. Phrase-timed head nods ──────────────────────────────────────────────
  if (head.nodAtPhrases) {
    const phrases  = text.split(/[.!?،؟。]/g).filter((p) => p.trim().length > 4);
    const nodCount = Math.min(phrases.length, 4);
    for (let i = 0; i < nodCount; i++) {
      const delay     = ((i + 0.4) / nodCount) * speechMs * 0.72;
      const intensity = 0.20 + Math.random() * 0.24;
      later(delay, () =>
        dispatch('avatar:nod', { intensity, duration: 450 + Math.random() * 230 }),
      );
    }
  }

  // ── 4. Natural mid-speech blink ────────────────────────────────────────────
  later(speechMs * 0.46, () => dispatch('avatar:blink', { style: 'normal' }));

  // ── 5. Scheduled gestures from plan ───────────────────────────────────────
  // Skip index 0 for celebration/excited (already dispatched above)
  const skipFirst = emotion === 'celebration' || emotion === 'excited';
  gestures.forEach((g, i) => {
    if (i === 0 && skipFirst) return;
    const delay = Math.max(0, (g.at / 100) * speechMs - 250);
    const side  = g.hand === 'L' ? 'left' : g.hand === 'both' ? 'both' : 'right';
    later(delay, () =>
      dispatch('avatar:gesture', {
        type: g.type, side, duration: 1.5, intensity: g.strength, variance: Math.random(),
      }),
    );
  });

  // ── 6. Post-speech: return to neutral ─────────────────────────────────────
  later(speechMs + 600, () => {
    dispatch('avatar:emotion',  { emotion: 'neutral' });
    dispatch('avatar:headpose', { yaw: 0, pitch: 0, duration: 900 });
  });
}
