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
 *   • **Enhanced: Dynamic emotional transitions and gesture variety via EMOTION_GESTURES**
 *   • **Enhanced: Utilization of `avoidGesture` from CognitiveEngine**
 *   • **Enhanced: More robust speech timing estimation**
 */

import type { ResponsePlan } from './brain';
import { classifyReplyType, emotionToProsody, humanizeTelemetry } from '@/ai/cognitive/CognitiveEngine';
import { gestureEngine }     from '@/ai/cognitive/GestureEngine';
import { checkGestureCooldown, recordGestureLog } from '@/ai/memory/store';
import { dispatchAvatar } from '@/utils/events/normalizeAvatarEvents';

// Rough Arabic speech rate: ~4 chars/second (conservative, includes pauses)
function estimateSpeechMs(text: string): number {
  const charCount = text.replace(/\s+/g, ' ').trim().length;
  const words = text.split(/\s+/).filter(Boolean).length;
  return Math.max(2000, (charCount * 180) + (words * 50));
}

function dispatch(name: string, detail: Record<string, unknown>): void {
  if (typeof window === 'undefined') return;
  // Route normalised avatar events through dispatchAvatar; pass everything else directly.
  if (name === 'avatar:gesture' || name === 'avatar:emotion' || name === 'avatar:listening' ||
      name === 'avatar:voice'   || name === 'avatar:blink'   || name === 'avatar:headpose' ||
      name === 'avatar:nod'     || name === 'avatar:laugh') {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    dispatchAvatar(name as any, detail as any);
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
 * Dispatch a gesture only if motor-memory cooldown permits and it's not explicitly avoided.
 * Falls back silently if the gesture was played too recently or is in the avoid list.
 */
function safeGesture(
  type: string,
  side: string,
  duration: number,
  intensity: number,
  delayMs = 0,
  avoidGestureType?: string,
): void {
  if (avoidGestureType && type === avoidGestureType) return;
  if (!checkGestureCooldown(type)) return;
  recordGestureLog(type);
  const _fireMs = Math.max(0, delayMs - GESTURE_PREROLL_MS);
  // eslint-disable-next-line no-console
  console.log(`%c[DIRECTOR][EMIT] gesture=${type} side=${side} dur=${duration}s fire_in=${_fireMs}ms`, 'color:#a78bfa;font-weight:bold');
  later(_fireMs, () =>
    dispatch('avatar:gesture', { type, side, duration, intensity, variance: Math.random() }),
  );
}

// ─── Gesture variations for emotions ──────────────────────────────────────────
const EMOTION_GESTURES: Record<string, Array<() => void>> = {
  celebration: [
    () => gestureEngine.waveBothHands(3.0),
    () => safeGesture('openHand', 'both', 2.5, 0.9),
  ],
  excited: [
    () => safeGesture('openHand', 'both', 2.2, 0.9),
    () => safeGesture('beat', 'both', 1.8, 0.8),
  ],
  happy: [
    () => safeGesture('beat', 'right', 1.4, 0.6),
    () => safeGesture('openHand', 'right', 1.2, 0.5),
  ],
  friendly: [
    () => safeGesture('openHand', 'right', 1.6, 0.7),
    () => safeGesture('openHand', 'left', 1.6, 0.7),
  ],
  thinking: [
    () => gestureEngine.headTilt('left', 0.13, 4500),
    () => safeGesture('beat', 'right', 1.5, 0.5),
  ],
  sad: [
    () => dispatch('avatar:headpose', { yaw: 0, pitch: 0.12, duration: 5500 }),
    () => safeGesture('openHand', 'left', 1.5, 0.6),
  ],
  angry: [
    () => safeGesture('point', 'right', 1.6, 1.0),
    () => safeGesture('point', 'left', 1.6, 1.0),
  ],
  strict: [
    () => safeGesture('point', 'right', 1.6, 1.0),
    () => dispatch('avatar:headpose', { yaw: 0, pitch: -0.07, duration: 900 }),
  ],
  encouraging: [
    () => safeGesture('openHand', 'both', 2.0, 0.85),
    () => safeGesture('beat', 'right', 1.5, 0.7),
  ],
  blush: [
    () => dispatch('avatar:headpose', { yaw: 0.09, pitch: 0.07, duration: 3200 }),
  ],
  sleepy: [
    () => dispatch('avatar:headpose', { yaw: 0, pitch: 0.09, duration: 5500 }),
  ],
  relax: [
    () => safeGesture('openHand', 'both', 1.8, 0.6),
  ],
  proud: [
    () => dispatch('avatar:headpose', { yaw: 0, pitch: -0.06, duration: 3500 }),
    () => safeGesture('openHand', 'both', 1.6, 0.7),
  ],
  curious: [
    () => dispatch('avatar:headpose', { yaw: -0.09, pitch: 0, duration: 3200 }),
    () => safeGesture('beat', 'right', 1.0, 0.4),
  ],
  attentive: [
    () => dispatch('avatar:headpose', { yaw: 0, pitch: -0.04, duration: 4000 }),
  ],
  concerned: [
    () => dispatch('avatar:headpose', { yaw: 0, pitch: 0.08, duration: 4000 }),
    () => safeGesture('openHand', 'both', 1.4, 0.5),
  ],
  empathetic: [
    () => safeGesture('openHand', 'both', 1.8, 0.7),
    () => dispatch('avatar:headpose', { pitch: 0.05, yaw: 0, duration: 3000 }),
  ],
  frustrated: [
    () => safeGesture('beat', 'right', 2.0, 0.8),
    () => dispatch('avatar:headpose', { yaw: 0.05, pitch: 0.1, duration: 3500 }),
  ],
};

function getRandomGestureForEmotion(emotion: string, avoidGestureType?: string): (() => void) | undefined {
  const gestures = EMOTION_GESTURES[emotion];
  if (!gestures || gestures.length === 0) return undefined;
  const available = avoidGestureType
    ? gestures.filter(g => !g.toString().includes(`'${avoidGestureType}'`))
    : gestures;
  const pool = available.length > 0 ? available : gestures;
  return pool[Math.floor(Math.random() * pool.length)];
}

/**
 * Schedule a complete avatar performance from an AI ResponsePlan.
 * Call once per AI reply immediately after receiving the LLM response.
 */
export function directAvatarPerformance(plan: ResponsePlan & { strategy?: { avoidGesture?: string } }): void {
  const { text, gestures, head } = plan;
  let { emotion } = plan;
  const speechMs = estimateSpeechMs(text);
  const avoidGestureType = plan.strategy?.avoidGesture;

  // ── Phase 10: Upgrade neutral/friendly emotion using reply-text classification ──
  if (emotion === 'neutral' || emotion === 'friendly' || emotion === 'relax' || emotion === 'thinking') {
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

  // ── 2. Behavior contracts: EMOTION_GESTURES first, else explicit fallbacks ──
  if (emotion === 'surprised') {
    gestureEngine.headJerks();
    dispatch('avatar:blink', { style: 'double', count: 2 });
  }

  const selectedGestureFn = getRandomGestureForEmotion(emotion, avoidGestureType);
  if (selectedGestureFn) {
    selectedGestureFn();
    if (emotion === 'celebration') {
      dispatch('avatar:laugh',  { intensity: 0.95, duration: 1.6 });
      dispatch('avatar:blink',  { style: 'rapid', count: 3 });
    } else if (emotion === 'excited') {
      dispatch('avatar:laugh',  { intensity: 0.65, duration: 1.0 });
      dispatch('avatar:blink',  { style: 'rapid', count: 2 });
    } else if ((emotion as string) === 'thinking' || (emotion as string) === 'sad' || (emotion as string) === 'relax' ||
               (emotion as string) === 'sleepy'   || (emotion as string) === 'blush' || (emotion as string) === 'concerned' ||
               (emotion as string) === 'empathetic') {
      dispatch('avatar:blink',  { style: 'slow' });
    } else if (emotion === 'angry' || emotion === 'strictEvaluation') {
      dispatch('avatar:blink',  { style: 'rapid', count: 1 });
    }
  } else {
    if (emotion === 'happy')    safeGesture('beat',     'right', 1.4, 0.6, 0, avoidGestureType);
    if (emotion === 'friendly') safeGesture('openHand', 'right', 1.6, 0.7, 0, avoidGestureType);
  }

  // ── 3. Phrase-timed head nods ──────────────────────────────────────────────
  if (head.nodAtPhrases) {
    const phrases  = text.split(/[.!?،؟。]/g).filter((p) => p.trim().length > 4);
    const nodCount = Math.min(phrases.length, 4);
    for (let i = 0; i < nodCount; i++) {
      const delay     = ((i + 0.4) / nodCount) * speechMs * 0.72;
      const intensity = 0.20 + Math.random() * 0.24;
      later(delay, () =>
        dispatch('avatar:nod', { intensity, duration: (450 + Math.random() * 230) / 1000 }),
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
    later(delay, () => safeGesture(g.type, side, 1.5, g.strength, 0, avoidGestureType));
  });

  // ── 6. Post-speech: return to neutral with a fade ───────────────────────────
  const postSpeechHold = Math.min(1500, speechMs * 0.2);
  later(speechMs + postSpeechHold, () => {
    dispatch('avatar:emotion',  { emotion: 'neutral', duration: 1000 });
    dispatch('avatar:headpose', { yaw: 0, pitch: 0, duration: 1000 });
  });

  // ── 7. [HUMANIZE][GESTURE] telemetry ────────────────────────────────────
  humanizeTelemetry('GESTURE', {
    emotion,
    gestures: gestures.map((g) => ({ type: g.type, at: g.at, hand: g.hand })),
    prosody,
    speechMs,
    avoidGestureType,
  });
  // [SELF-CHECK] is emitted from page.tsx after this call with full intent+memory context.
}

/**
 * Convenience wrapper for useAvatarAgent — converts a raw WS speech frame
 * (dialogue + emotion + action strings) into a ResponsePlan and fires the
 * full director pipeline.
 */
export function directFromAgentFrame({
  dialogue,
  emotion,
  action,
  strategy,
}: {
  dialogue: string;
  emotion: string;
  action: string;
  strategy?: { avoidGesture?: string };
}): void {
  const { inferResponsePlan }  = require('./brain') as typeof import('./brain');
  const plan = inferResponsePlan(dialogue);
  // Override brain-inferred emotion with the one from the server if provided.
  if (emotion && emotion !== 'neutral') {
    (plan as { emotion: string }).emotion = emotion;
  }
  // Merge strategy if provided.
  if (strategy) {
    (plan as ResponsePlan & { strategy?: { avoidGesture?: string } }).strategy = strategy;
  }
  // Map action string to a gesture if present.
  if (action) {
    const side = /left|يسار/i.test(action) ? 'L' : /both|كلا/i.test(action) ? 'both' : 'R';
    const type = /wave|تلويح/i.test(action)       ? 'openHand'
               : /point|إشارة/i.test(action)      ? 'point'
               : /nod|هز|موافقة/i.test(action)    ? 'beat'
               : /headtilt|إمالة/i.test(action)     ? 'beat'
               : /scratch|حك/i.test(action)         ? 'beat'
               : 'emphasis';
    plan.gestures.unshift({ type: type as never, at: 0.1, hand: side as never, strength: 0.9 });
  }
  directAvatarPerformance(plan);
}

