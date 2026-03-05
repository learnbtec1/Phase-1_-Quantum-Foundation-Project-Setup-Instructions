/**
 * Emotion state machine for avatar expression.
 * States: neutral ↔ thinking ↔ friendly ↔ encouraging ↔ strictEvaluation ↔ celebration
 * Extended with AIMascotKit 11-emotion system
 */
export type EmotionState =
  | 'neutral'
  | 'normal'
  | 'thinking'
  | 'friendly'
  | 'encouraging'
  | 'strictEvaluation'
  | 'celebration'
  | 'curious'
  | 'approving'
  | 'doubtful'
  | 'surprised'
  // AIMascotKit 11-emotion extensions
  | 'happy'
  | 'excited'
  | 'angry'
  | 'sad'
  | 'blush'
  | 'sleepy'
  | 'relax'
  | 'goodbye';

const DECAY_MS = 5000;

export function createEmotionState() {
  let state: EmotionState = 'neutral';
  let decayTimer: ReturnType<typeof setTimeout> | null = null;

  const decayToNeutral = () => {
    if (decayTimer) clearTimeout(decayTimer);
    decayTimer = setTimeout(() => {
      state = 'neutral';
      decayTimer = null;
    }, DECAY_MS);
  };

  return {
    get: () => state,
    set: (s: EmotionState) => {
      state = s;
      decayToNeutral();
    },
    decayToNeutral,
  };
}

export const EMOTION_BLENDSHAPES: Record<EmotionState, { joy?: number; angry?: number; sorrow?: number; fun?: number; surprised?: number }> = {
  // قيم مُعايَرة لتعبيرات وجه مرئية وطبيعية بشكل كافٍ
  neutral:          {},
  normal:           {},
  thinking:         { sorrow: 0.55 },                          // قطبة خفيفة في الحاجب
  friendly:         { joy: 0.78 },                             // ابتسامة دافئة
  encouraging:      { joy: 0.82, fun: 0.55 },                  // فرحة تشجيعية
  strictEvaluation: { angry: 0.50 },                           // جدية واضحة
  celebration:      { joy: 1.0,  fun: 0.70 },                  // فرحة كاملة
  curious:          { joy: 0.30, sorrow: 0.25, surprised: 0.40 }, // فضول + دهشة خفيفة
  approving:        { joy: 0.75, fun: 0.45 },                  // رضا + إطراء
  doubtful:         { sorrow: 0.45, angry: 0.20 },             // تشكيك واضح
  surprised:        { surprised: 0.90, joy: 0.35 },            // دهشة حقيقية
  // ── AIMascotKit 11-emotion extensions ─────────────────────────────────────
  happy:            { joy: 0.90 },
  excited:          { joy: 1.0,  fun: 0.70 },
  angry:            { angry: 0.90 },
  sad:              { sorrow: 0.80 },
  blush:            { joy: 0.60, fun: 0.30 },
  sleepy:           { sorrow: 0.30, fun: 0.40 },
  relax:            { fun: 0.60 },
  goodbye:          { joy: 0.50 },
};
