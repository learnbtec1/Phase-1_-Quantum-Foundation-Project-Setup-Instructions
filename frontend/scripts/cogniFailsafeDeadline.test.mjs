/**
 * Smoke test for TTS failsafe deadline math (duplicate of speakWithTTS inline — keep in sync).
 * Run: npm run test:cogni-failsafe --prefix frontend
 */
import test from 'node:test';
import assert from 'node:assert/strict';

/** Mirrors `failsafeDeadlineMs` in frontend/ai/io/tts.ts speakWithTTS */
function computeFailsafeDeadlineMs(textLen, durationSec, maxEndMsFromWords) {
  let sec =
    typeof durationSec === 'number' &&
    Number.isFinite(durationSec) &&
    durationSec > 0.08
      ? durationSec
      : NaN;
  if (!Number.isFinite(sec)) {
    const maxEndMs = typeof maxEndMsFromWords === 'number' ? maxEndMsFromWords : 0;
    if (maxEndMs > 320) sec = maxEndMs / 1000;
  }
  if (!Number.isFinite(sec)) sec = Math.max(4.8, Math.min(120, textLen * 0.075));
  const cap = Math.min(300_000, sec * 1000 + 6200);
  return Math.max(14_500, cap);
}

test('short unknown duration uses minimum 14.5s window', () => {
  assert.equal(computeFailsafeDeadlineMs(80, NaN, 0), 14_500);
});

test('duration-based deadline includes tail slack', () => {
  const ms = computeFailsafeDeadlineMs(10, 12.5, 0);
  assert.ok(ms >= 12_500 + 6200);
  assert.ok(ms <= 300_000);
});

test('word-timing fallback when duration missing', () => {
  assert.equal(computeFailsafeDeadlineMs(5, NaN, 5000), Math.max(14_500, Math.min(300_000, 5000 + 6200)));
});
