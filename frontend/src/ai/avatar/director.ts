/**
 * Avatar Director — AI-controlled performance orchestrator.
 *
 * Takes an `inferResponsePlan` result and converts it into a full timed
 * performance schedule dispatched as avatar:* custom events.
 *
 * Hybrid Persona Kernel additions:
 *   • Behavior contracts per emotion (listening / explaining / emphasizing / etc.)
 *   • 200ms pre-roll before keyword gestures
 *   • Prosody dispatch (avatar:voice rate + pitch) per emotion
 *   • Motor memory cooldown via GestureEngine  
 *   • [HUMANIZE][COG] telemetry after each performance
 */

import type { ResponsePlan } from './brain';
import { classifyReplyType, emotionToProsody, humanizeTelemetry } from '@/ai/cognitive/CognitiveEngine';
import { gestureEngine }     from '@/ai/cognitive/GestureEngine';
import { checkGestureCooldown, recordGestureLog } from '@/ai/memory/store';
import { dispatchAvatar } from '@/utils/events/normalizeAvatarEvents';

// Rough Arabic speech rate: ~4 chars/second (conservative, includes pauses)
function estimateSpeechMs(text: string): number {
  return Math.max(2000, text.replace(/\s+/g, ' ').trim().length * 210);
}

function dispatch(name: string, detail: Record<string, unknown>): void {
  if (typeof window === 'undefined') return;
  // Route normalised avatar events through dispatchAvatar; pass everything else directly.
  if (name === 'avatar:gesture' || name === 'avatar:emotion' || name === 'avatar:listening') {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    dispatchAvatar(name as 'avatar:gesture', detail as any);
  } else {
    window.dispatchEvent(new CustomEvent(name, { detail }));
  }
}

function later(ms: number, fn: () => void): void {
  if (ms <= 0) { fn(); return; }
  setTimeout(fn, ms);
}

// ─── Pre-roll constant ────────────────────────────────────────────────────────
const GESTURE_PREROLL_MS = 200; // 200ms before the keyword emphasis

/**
 * Dispatch a gesture only if motor-memory cooldown permits.
 * Falls back silently if the gesture was played too recently.
 */
function safeGesture(
  type: string,
  side: string,
  duration: number,
  intensity: number,
  delayMs = 0,
): void {
  if (!checkGestureCooldown(type)) return;
  recordGestureLog(type);
  const _fireMs = Math.max(0, delayMs - GESTURE_PREROLL_MS);
  // eslint-disable-next-line no-console
  console.log(`%c[DIRECTOR][EMIT] gesture=${type} side=${side} dur=${duration}s fire_in=${_fireMs}ms`, 'color:#a78bfa;font-weight:bold');
  later(_fireMs, () =>
    dispatch('avatar:gesture', { type, side, duration, intensity, variance: Math.random() }),
  );
}

/**
 * Schedule a complete avatar performance from an AI ResponsePlan.
 * Call once per AI reply immediately after receiving the LLM response.
 */
export function directAvatarPerformance(plan: ResponsePlan): void {
  const { text, gestures, head } = plan;
  let { emotion } = plan;
  const speechMs = estimateSpeechMs(text);

  // ── Phase 10: Upgrade neutral/friendly emotion using reply-text classification ──
  // classifyReplyType catches text cues that brain.ts may have missed (e.g. the
  // reply says "أحسنت" but emotion wasn’t set to celebration).
  if (emotion === 'neutral' || emotion === 'friendly' || emotion === 'relax') {
    const replyType = classifyReplyType(text);
    if      (replyType === 'celebration') emotion = 'celebration';
    else if (replyType === 'sad')         emotion = 'sad';
    else if (replyType === 'surprised')   emotion = 'surprised';
    else if (replyType === 'question')    emotion = 'thinking';
  }

  // ── 0. Prosody dispatch (Hybrid Persona Kernel: emotion → rate/pitch) ─────────
  const prosody = emotionToProsody(emotion);
  dispatch('avatar:voice', { rate: prosody.rate, pitch: prosody.pitch });

  // ── 1. Instant emotion ─────────────────────────────────────────────────────
  dispatch('avatar:emotion', { emotion });

  // ── 2. Behavior contracts + emotion-specific reactions ────────────────────

  if (emotion === 'surprised') {
    gestureEngine.headJerks();
    dispatch('avatar:blink', { style: 'double', count: 2 });
  }

  if (emotion === 'celebration') {
    // Behavior contract: Celebrating → raise both hands, bright smile, rapid blink ×3, laugh
    dispatch('avatar:laugh',   { intensity: 0.95, duration: 1600 });
    // eslint-disable-next-line no-console
    console.log('%c[DIRECTOR][EMIT] waveBothHands (celebration)', 'color:#a78bfa;font-weight:bold');
    gestureEngine.waveBothHands(3.0);
    dispatch('avatar:blink',   { style: 'rapid', count: 3 });
  } else if (emotion === 'excited') {
    dispatch('avatar:laugh',   { intensity: 0.65, duration: 1000 });
    safeGesture('openHand', 'both', 2.2, 0.9);
    dispatch('avatar:blink',   { style: 'rapid', count: 2 });
  }

  if (emotion === 'happy') {
    // Behavior contract: Encouraging → half-smile, gentle nod, beat right
    dispatch('avatar:blink',   { style: 'slow' });
    safeGesture('beat', 'right', 1.4, 0.6);
  }

  if (emotion === 'friendly') {
    // Behavior contract: Explaining → openHand right, chest expansion, steady gaze
    dispatch('avatar:blink',   { style: 'slow' });
    safeGesture('openHand', 'right', 1.6, 0.7);
  }

  if (emotion === 'thinking') {
    // Behavior contract: Thinking → eye squint, chin down-left, weight shift
    gestureEngine.headTilt('left', 0.13, Math.min(speechMs * 0.75, 4500));
    dispatch('avatar:blink',    { style: 'slow' });
  }

  if (emotion === 'sad') {
    // Behavior contract: De-escalating → slow blink, head droop
    dispatch('avatar:blink',    { style: 'slow' });
    dispatch('avatar:headpose', { yaw: 0, pitch: 0.12, duration: Math.min(speechMs * 0.80, 5500) });
  }

  if (emotion === 'angry' || emotion === 'strictEvaluation') {
    // Behavior contract: Emphasizing → point index, eyebrow raise
    safeGesture('point', 'right', 1.6, 1.0);
    dispatch('avatar:blink',    { style: 'rapid', count: 1 });
    dispatch('avatar:headpose', { yaw: 0, pitch: -0.07, duration: 900 });
  }

  if (emotion === 'encouraging') {
    // Behavior contract: Encouraging → open-hand both, nod
    safeGesture('openHand', 'both', 2.0, 0.85);
  }

  if (emotion === 'blush') {
    dispatch('avatar:blink',    { style: 'slow' });
    dispatch('avatar:headpose', { yaw: 0.09, pitch: 0.07, duration: Math.min(speechMs * 0.60, 3200) });
  }

  if (emotion === 'sleepy') {
    dispatch('avatar:blink',    { style: 'slow' });
    dispatch('avatar:headpose', { yaw: 0, pitch: 0.09, duration: Math.min(speechMs, 5500) });
  }

  if (emotion === 'relax') {
    // Behavior contract: De-escalating → open palms down, slow blink
    dispatch('avatar:blink',    { style: 'slow' });
    safeGesture('openHand', 'both', 1.8, 0.6);
  }

  if (emotion === 'proud') {
    // Behavior contract: Proud → chest up, open smile, gentle openHand both
    dispatch('avatar:blink',    { style: 'slow' });
    dispatch('avatar:headpose', { yaw: 0, pitch: -0.06, duration: Math.min(speechMs * 0.7, 3500) });
    safeGesture('openHand', 'both', 1.6, 0.7);
  }

  if (emotion === 'curious') {
    // Behavior contract: Curious → head tilt left, eyebrow raise, light beat
    dispatch('avatar:headpose', { yaw: -0.09, pitch: 0, duration: Math.min(speechMs * 0.65, 3200) });
    dispatch('avatar:blink',    { style: 'slow' });
    safeGesture('beat', 'right', 1.0, 0.4);
  }

  if (emotion === 'attentive') {
    // Behavior contract: Attentive → subtle forward lean, wide eyes, still hands
    dispatch('avatar:headpose', { yaw: 0, pitch: -0.04, duration: Math.min(speechMs * 0.8, 4000) });
    dispatch('avatar:blink',    { style: 'normal' });
  }

  if (emotion === 'concerned') {
    // Behavior contract: Concerned → slight head droop, soft gaze, open palms low
    dispatch('avatar:blink',    { style: 'slow' });
    dispatch('avatar:headpose', { yaw: 0, pitch: 0.08, duration: Math.min(speechMs * 0.75, 4000) });
    safeGesture('openHand', 'both', 1.4, 0.5);
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

  // ── 5. Scheduled gestures from plan (with 200ms pre-roll via safeGesture) ──
  const skipFirst = emotion === 'celebration' || emotion === 'excited';
  gestures.forEach((g, i) => {
    if (i === 0 && skipFirst) return;
    const delay = Math.max(0, (g.at / 100) * speechMs);
    const side  = g.hand === 'L' ? 'left' : g.hand === 'both' ? 'both' : 'right';
    // safeGesture handles the 200ms pre-roll internally
    later(delay, () => safeGesture(g.type, side, 1.5, g.strength));
  });

  // ── 6. Post-speech: return to neutral ─────────────────────────────────────
  later(speechMs + 600, () => {
    dispatch('avatar:emotion',  { emotion: 'neutral' });
    dispatch('avatar:headpose', { yaw: 0, pitch: 0, duration: 900 });
  });

  // ── 7. [HUMANIZE][GESTURE] telemetry ──────────────────────────────────────
  humanizeTelemetry('GESTURE', {
    emotion,
    gestures: gestures.map((g) => ({ type: g.type, at: g.at, hand: g.hand })),
    prosody,
    speechMs,
  });
  // [SELF-CHECK] is emitted from page.tsx after this call with full intent+memory context.
}

