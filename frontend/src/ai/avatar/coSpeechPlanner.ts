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

/** Extra delay for longer / heavier gestures so they sit better after playback starts. */
export function coSpeechLeadBoostMs(gesture: string): number {
  const m: Record<string, number> = {
    think: 120,
    clap: 90,
    cheer: 85,
    point: 55,
    openHand: 45,
    beat: 35,
    relax: 30,
    wave: 25,
  };
  return m[gesture] ?? 0;
}

/** Fallback when browser/audio duration is unavailable. */
export function estimateDialogueDurationMs(text: string): number {
  const n = (text || '').length;
  return Math.min(120_000, Math.max(6_000, n * 72));
}

/**
 * Infer audio duration in **milliseconds** from viseme cue timeline.
 * `cues[n].t` is always in **seconds** (Azure convention; `useTTSWithVisemes` uses
 * TICKS_TO_SEC = 1/10_000_000 and `useAgentAgent` normalizes to seconds too).
 * Returns 0 when cues is empty so callers can fall back to audio.duration.
 */
export function durationMsFromVisemeCues(cues: Array<{ t: number }> | null | undefined): number {
  if (!cues?.length) return 0;
  const lastSec = cues.reduce((m, c) => Math.max(m, c.t), 0);
  // Auto-detect if someone accidentally stored ms: values > 300 are almost certainly ms
  // (a 300-second utterance would be extremely unusual).
  const isMs = lastSec > 300;
  return isMs ? lastSec + 500 : lastSec * 1000 + 500;
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
    const atMs =
      Math.round(Math.min(0.92, Math.max(0.06, ratio)) * dur) +
      200 +
      Math.random() * 120 +
      coSpeechLeadBoostMs(gesture);
    plans.push({ atMs, gesture, emphasis });
  };

  const L = Math.max(raw.length, 1);

  // helper: first occurrence of any keyword in normalised text
  const firstOf = (keywords: string[]) =>
    keywords.map(w => n.indexOf(norm(w))).filter(i => i >= 0).sort((a, b) => a - b)[0] ?? -1;

  // ── Pointing / example / demonstration ───────────────────────────────────
  const exIdx = firstOf(['مثلا', 'مثلاً', 'على سبيل المثال', 'لنفترض', 'example',
    'تلاحظ', 'لاحظ', 'هذا', 'هنا', 'انظر', 'شوف', 'look', 'notice', 'see']);
  if (exIdx >= 0) pushAtRatio(exIdx / L, 'point');

  // ── Open-hand: big / open / congratulations ───────────────────────────────
  const bigIdx = firstOf(['كبير', 'كبيرة', 'ضخم', 'واسع', 'عظيم', 'رائع', 'ممتاز',
    'احسنت', 'مبروك', 'congrats', 'great', 'huge', 'amazing']);
  if (bigIdx >= 0) pushAtRatio(bigIdx / L, 'openHand');

  // ── Beat / rhythm / listing ───────────────────────────────────────────────
  const listIdx = firstOf(['أولاً', 'ثانياً', 'ثالثاً', 'أول', 'ثاني', 'ثالث',
    'نقطة', 'first', 'second', 'third', 'point', 'also', 'وأيضا', 'علاوة على']);
  if (listIdx >= 0) pushAtRatio(listIdx / L, 'beat');

  const ackIdx = firstOf(['صحيح', 'بالضبط', 'تمام', 'مظبوط', 'صح', 'نعم', 'أكيد',
    'بالتأكيد', 'طبعا', 'طبعاً', 'right', 'exactly', 'yes', 'correct']);
  if (ackIdx >= 0) pushAtRatio(ackIdx / L, 'agree');

  // ── Agreement / nod gesture ───────────────────────────────────────────────
  const agreeIdx = firstOf(['أتفق', 'وافقت', 'صواب', 'معك حق', 'هذا صح', 'agree', 'i agree', 'true']);
  if (agreeIdx >= 0 && agreeIdx !== ackIdx) pushAtRatio(agreeIdx / L, 'agree');

  // ── Question / think ─────────────────────────────────────────────────────
  const qIdx = (() => {
    const byWord = firstOf(['سؤال', 'ليش', 'كيف', 'لماذا', 'شو رأيك', 'ماذا',
      'متى', 'أين', 'هل', 'ما هو', 'ما هي', 'why', 'how', 'what', 'when', 'where']);
    const qm = Math.max(raw.indexOf('?'), raw.indexOf('؟'));
    if (byWord < 0) return qm;
    if (qm < 0) return byWord;
    return Math.min(byWord, qm);
  })();
  if (qIdx >= 0) pushAtRatio(qIdx / L, 'think', 'question_tilt');

  // ── Importance / emphasis / warning ──────────────────────────────────────
  const impIdx = firstOf(['مهم', 'مهمة', 'أهمية', 'بالغ الأهمية', 'ركز', 'انتبه',
    'لازم', 'ضروري', 'خطير', 'important', 'remember', 'تذكر', 'note', 'warning']);
  if (impIdx >= 0) pushAtRatio(impIdx / L, 'openHand', 'eyebrow');

  // ── Celebration / praise ──────────────────────────────────────────────────
  const encourageIdx = firstOf(['شاطر', 'برافو', 'احسنت', 'أحسنت',
    'ولد نشامي', 'هيلا', 'well done', 'excellent', 'fantastic', 'perfect']);
  if (encourageIdx >= 0) pushAtRatio(encourageIdx / L, 'clap');

  // ── Farewell / welcome / greeting ─────────────────────────────────────────
  const greetIdx = firstOf(['مرحبا', 'أهلا', 'السلام', 'وداعا', 'مع السلامة',
    'hello', 'hi', 'goodbye', 'bye', 'welcome']);
  if (greetIdx >= 0) pushAtRatio(greetIdx / L, 'wave');

  // ── Negation / contrast ───────────────────────────────────────────────────
  const negIdx = firstOf(['لا', 'لكن', 'بالعكس', 'غلط', 'خطأ', 'ليس', 'لم',
    'no', 'not', 'however', 'but', 'wrong', 'incorrect']);
  if (negIdx >= 0) pushAtRatio(negIdx / L, 'point', 'eyebrow');

  plans.sort((a, b) => a.atMs - b.atMs);
  const merged: CoSpeechPlan[] = [];
  let prevT = -99999;
  for (const p of plans) {
    let at = p.atMs;
    // Min spacing 750ms between any two gestures
    if (merged.length && at - prevT < 750) at = prevT + 750;
    // Dedupe near-identical gesture at same time
    if (merged.some(m => m.gesture === p.gesture && Math.abs(m.atMs - at) < 350)) continue;
    merged.push({ ...p, atMs: at });
    prevT = at;
  }

  // Cap at 6 gestures (was 5 — one extra slot for richer dialogue)
  return merged.slice(0, 6);
}
