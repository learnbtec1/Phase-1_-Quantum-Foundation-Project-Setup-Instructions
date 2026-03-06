/**
 * TimingUtils.ts — Phase 4 Human-like Timing Functions
 *
 * Provides randomised delays that mimic natural human cognitive & motor patterns:
 *   • Micro-expressions fire 80–180 ms after stimulus perception
 *   • Thinking pauses vary by emotional state (complex emotions = longer pause)
 *   • Gesture pre-rolls fire 150–250 ms before the target audio keyword
 *   • All delays include Gaussian-like jitter so the avatar never feels mechanical
 *
 * Designed for use in AgentDirector.ts and any component requiring
 * human-like timing behaviour.
 */

import type { EmotionLabel } from '@/types/ai';

// ─── Per-emotion base thinking delays (ms) ────────────────────────────────────
//
// Derived from cognitive-load theory:
//   • High arousal (excited, surprised, angry) → faster reactions
//   • Negative/reflective states (sad, thinking, sleepy) → slower reactions
//   • Neutral/attentive middle-ground states → ~400 ms
//
const EMOTION_BASE_DELAY_MS: Partial<Record<EmotionLabel, number>> = {
  excited:     170,
  surprised:   230,
  angry:       260,
  happy:       310,
  encouraging: 290,
  proud:       340,
  curious:     580,
  attentive:   330,
  calm:        490,
  neutral:     400,
  anxious:     410,
  concerned:   540,
  thinking:    880,
  bored:       790,
  sad:         670,
  relaxed:     600,
  sleepy:      740,
};

// ─── Core primitives ──────────────────────────────────────────────────────────

/**
 * Return a uniformly-distributed random integer delay in milliseconds.
 *
 * @param minMs — minimum delay (inclusive)
 * @param maxMs — maximum delay (inclusive, rounded to nearest int)
 */
export function getRandomDelay(minMs: number, maxMs: number): number {
  if (minMs >= maxMs) return Math.round(minMs);
  return Math.floor(minMs + Math.random() * (maxMs - minMs + 1));
}

/**
 * Schedule `callback` after a random delay drawn from `range`.
 *
 * @param callback — function to invoke
 * @param range    — [minMs, maxMs] window (milliseconds)
 * @returns  the timer handle returned by setTimeout (use clearTimeout to cancel)
 */
export function scheduleAction(
  callback: () => void,
  range: [number, number],
): ReturnType<typeof setTimeout> {
  const delay = getRandomDelay(range[0], range[1]);
  console.log(`[TimingUtils] scheduleAction delay=${delay}ms`);
  return setTimeout(callback, delay);
}

/**
 * Return a human-realist thinking delay for a given emotion label,
 * with ±20 % Gaussian-approximated jitter for naturalness.
 *
 * @param emotionLabel — current avatar emotion state
 */
export function humanDelay(emotionLabel: EmotionLabel): number {
  const base        = EMOTION_BASE_DELAY_MS[emotionLabel] ?? 400;
  const jitterRange = base * 0.20;
  // Two-step uniform sampling approximates a triangular distribution (+jitter feel)
  const sample =
    base
    + (Math.random() - 0.5) * jitterRange
    + (Math.random() - 0.5) * jitterRange;
  const result = Math.max(60, Math.round(sample));
  console.log(`[TimingUtils] humanDelay(${emotionLabel}) = ${result}ms (base=${base})`);
  return result;
}

/**
 * Very short delay (80–180 ms) for micro-expression triggers.
 * Mimics the latency between stimulus perception and the first visible
 * facial-muscle contraction.
 */
export function microReactionDelay(): number {
  return getRandomDelay(80, 180);
}

/**
 * Apply ±variancePct jitter to a base delay.
 *
 * @param baseMs      — centre value (milliseconds)
 * @param variancePct — fraction of baseMs for the ±range (e.g. 0.20 = ±20 %)
 */
export function jitter(baseMs: number, variancePct = 0.15): number {
  const delta = baseMs * variancePct;
  return Math.max(0, Math.round(baseMs + (Math.random() - 0.5) * 2 * delta));
}

/**
 * Estimate how long a text passage will take to be spoken at the given rate.
 *
 * Baseline: ~4 Arabic chars/second at rate=1.0 (conservative, includes natural
 * prosody pauses).  English text uses ~8 chars/second.
 *
 * @param text       — string to be spoken
 * @param speechRate — TTS rate multiplier (1.0 = normal speed)
 */
export function estimateSpeechDurationMs(text: string, speechRate = 1.0): number {
  const trimmed   = text.replace(/\s+/g, ' ').trim();
  const hasArabic = /[\u0600-\u06FF]/.test(trimmed);
  // Arabic: ~210 ms/char (4.8 chars/s); Latin: ~110 ms/char (9 chars/s)
  const msPerChar = hasArabic ? 210 : 110;
  const baseMs    = Math.max(1400, trimmed.length * msPerChar);
  return Math.round(baseMs / Math.max(0.4, speechRate));
}

/**
 * Return the pre-roll offset (ms) to fire a gesture BEFORE the keyword
 * it should accompany appears in the audio stream.
 *
 * Standard value: 150–250 ms, matching the 200 ms pre-roll constant used
 * in the existing director.ts.
 */
export function gesturePrerollMs(): number {
  return getRandomDelay(150, 250);
}
