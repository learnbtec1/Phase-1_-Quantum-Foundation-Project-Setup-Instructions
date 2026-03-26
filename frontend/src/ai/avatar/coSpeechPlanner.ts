/**
 * Co-speech gesture planner — keyword hits → timed avatar:gesture dispatches.
 * Does not touch 3D scene; only schedules window events aligned with dialogue.
 *
 * Timing uses **actual audio duration (ms)** when provided; falls back to a
 * text-length heuristic only when audio length is unknown.
 */

export interface CoSpeechPlan {
  /** Delay from speech start (ms) */
  atMs: number;
  /** Gesture token consumed by AvatarCanvas (VRMA mapping inside onGesture) */
  gesture: string;
  /** Optional window event for face micro-expression */
  emphasis?: 'eyebrow' | 'question_tilt';
}

const DIACRITICS = /[\u064B-\u065F\u0670]/g;

function norm(s: string): string {
  return s.replace(DIACRITICS, '').toLowerCase();
}

/** Fallback when browser/audio duration is unavailable. */
export function estimateDialogueDurationMs(text: string): number {
  const n = (text || '').length;
  return Math.min(120_000, Math.max(6_000, n * 72));
}

/**
 * Infer duration from viseme cue timeline end (ms) + small tail.
 */
export function durationMsFromVisemeCues(cues: Array<{ t: number }> | null | undefined): number {
  if (!cues?.length) return 0;
  const last = cues.reduce((m, c) => Math.max(m, c.t), 0);
  return last + 500;
}

/**
 * Build 1–5 timed plans from dialogue text.
 * @param text — dialogue (Arabic / mixed)
 * @param audioDurationMs — measured or inferred utterance length in milliseconds
 */
export function planCoSpeechGestures(
  text: string,
  audioDurationMs: number,
): CoSpeechPlan[] {
  const raw = text || '';
  const n = norm(raw);
  const estFallback = estimateDialogueDurationMs(raw);
  const dur = Math.max(
    4_000,
    Math.min(120_000, audioDurationMs > 0 ? audioDurationMs : estFallback),
  );
  const plans: CoSpeechPlan[] = [];

  const pushAtRatio = (ratio: number, gesture: string, emphasis?: CoSpeechPlan['emphasis']) => {
    const atMs = Math.round(Math.min(0.92, Math.max(0.06, ratio)) * dur) + 200 + Math.random() * 120;
    plans.push({ atMs, gesture, emphasis });
  };

  const exIdx = (() => {
    const needles = ['مثلا', 'على سبيل المثال', 'لنفترض', 'example'];
    let best = -1;
    for (const w of needles) {
      const i = n.indexOf(norm(w));
      if (i >= 0 && (best < 0 || i < best)) best = i;
    }
    return best;
  })();
  if (exIdx >= 0) pushAtRatio(exIdx / Math.max(raw.length, 1), 'point');

  const bigIdx = ['كبير', 'كبيرة', 'حجم كبير'].map(k => n.indexOf(norm(k))).filter(i => i >= 0).sort((a, b) => a - b)[0] ?? -1;
  const smallIdx = ['صغير', 'صغيرة', 'حجم صغير'].map(k => n.indexOf(norm(k))).filter(i => i >= 0).sort((a, b) => a - b)[0] ?? -1;
  if (bigIdx >= 0) pushAtRatio(bigIdx / Math.max(raw.length, 1), 'openHand');
  if (smallIdx >= 0) pushAtRatio(smallIdx / Math.max(raw.length, 1), 'openHand');

  const ackIdx = (() => {
    const needles = ['صحيح', 'بالضبط', 'تمام', 'مظبوط', 'صح'];
    let best = -1;
    for (const w of needles) {
      const i = n.indexOf(norm(w));
      if (i >= 0 && (best < 0 || i < best)) best = i;
    }
    return best;
  })();
  if (ackIdx >= 0) pushAtRatio(ackIdx / Math.max(raw.length, 1), 'beat');

  const qIdx = (() => {
    const needles = ['سؤال', 'ليش', 'كيف', 'لماذا', 'شو رأيك'];
    let best = -1;
    for (const w of needles) {
      const i = n.indexOf(norm(w));
      if (i >= 0 && (best < 0 || i < best)) best = i;
    }
    const qm = Math.max(raw.indexOf('?'), raw.indexOf('؟'));
    if (qm >= 0 && (best < 0 || qm < best)) best = qm;
    return best;
  })();
  if (qIdx >= 0) {
    const r = qIdx / Math.max(raw.length, 1);
    pushAtRatio(r, 'think', 'question_tilt');
  }

  const impIdx = ['مهم', 'مهمة', 'أهمية', 'بالغ الأهمية'].map(k => n.indexOf(norm(k))).filter(i => i >= 0).sort((a, b) => a - b)[0] ?? -1;
  if (impIdx >= 0) pushAtRatio(impIdx / Math.max(raw.length, 1), 'openHand', 'eyebrow');

  plans.sort((a, b) => a.atMs - b.atMs);
  const merged: CoSpeechPlan[] = [];
  let prevT = -99999;
  for (const p of plans) {
    let at = p.atMs;
    if (merged.length && at - prevT < 850) at = prevT + 850;
    if (merged.some(m => m.gesture === p.gesture && Math.abs(m.atMs - at) < 400)) continue;
    merged.push({ ...p, atMs: at });
    prevT = at;
  }

  return merged.slice(0, 5);
}
