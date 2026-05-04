/**
 * Expression → allowed head primitives, timing, and persona overrides.
 *
 * **Authority model:** only primitives listed in {@link EXPRESSION_ALLOWED} run for
 * that expression; others are fully off (no modifier-only stacking).
 */
'use client';

import type { MotionIntentKind } from '@/lib/avatar/motionIntentContinuity';
import type { BehaviorMotionMode } from '@/lib/behavior/behaviorMotionBrain';
import type { CogniTeachingStance } from '@/lib/avatar/cogniPersonaStance';

// ─── Expression state ─────────────────────────────────────────────────────────

export type ExpressionState =
  | 'explaining'
  | 'thinking'
  | 'confirming'
  | 'listening'
  | 'emphasizing'
  | 'neutral';

export type ExpressionPrimitiveName = 'headNod' | 'headTilt' | 'headTurn';

const ALL_HEAD: ExpressionPrimitiveName[] = ['headNod', 'headTilt', 'headTurn'];

/** Primitives that may run for each expression (others are hard-off). */
export const EXPRESSION_ALLOWED: Record<ExpressionState, ExpressionPrimitiveName[]> = {
  explaining:  ['headNod', 'headTurn'],
  /**
   * Thinking is tilt-led but no longer a single-axis state:
   *   - headTilt 1.0 (signature)
   *   - headTurn 0.45 (gaze drift while contemplating)
   *   - headNod  0.30 (subtle agreement / understanding cue)
   * Per-primitive scale comes from {@link EXPRESSION_PRIMITIVE_BIAS}.
   */
  thinking:    ['headTilt', 'headTurn', 'headNod'],
  confirming:  ['headNod'],
  listening:   ['headNod', 'headTurn'],
  emphasizing: ['headNod', 'headTilt'],
  /** Subtle 3-axis idle life — overall amplitude stays low via EXPRESSION_GAIN_MUL.neutral=0.55. */
  neutral:     ['headNod', 'headTilt', 'headTurn'],
};

/**
 * Per-(expression × primitive) gain scale applied **on top of** {@link EXPRESSION_GAIN_MUL}.
 * Used to keep an expression's signature primitive dominant while letting secondary
 * primitives contribute subtly. Default 1 when omitted.
 */
export const EXPRESSION_PRIMITIVE_BIAS: Record<ExpressionState, Record<ExpressionPrimitiveName, number>> = {
  explaining:  { headNod: 1.0,  headTilt: 0,    headTurn: 0.85 },
  /**
   * Bumped secondary biases so the product (bias × pause_floor × exprMul × energyScale)
   * stays above GAIN_DEAD_ZONE = 0.02 even in silence (energy ≈ 0.20):
   *   headNod:  0.45 × 0.12 × 1.0 × (0.46 + 0.2) ≈ 0.036  > 0.02 ✓
   *   headTurn: 0.55 × 0.12 × 1.0 × (0.46 + 0.2) ≈ 0.043  > 0.02 ✓
   */
  thinking:    { headNod: 0.45, headTilt: 1.0,  headTurn: 0.55 },
  confirming:  { headNod: 1.0,  headTilt: 0,    headTurn: 0    },
  listening:   { headNod: 0.7,  headTilt: 0,    headTurn: 1.0  },
  emphasizing: { headNod: 1.0,  headTilt: 0.85, headTurn: 0    },
  neutral:     { headNod: 0.6,  headTilt: 0.7,  headTurn: 1.0  },
};

/** Explicit block list (inverse of allow — used for docs / persona extensions). */
export function expressionBlockedPrimitives(expr: ExpressionState): ExpressionPrimitiveName[] {
  const allow = new Set(EXPRESSION_ALLOWED[expr]);
  return ALL_HEAD.filter((n) => !allow.has(n));
}

/** Global time-scale for head-layer sin phases (1 = default; &lt;1 slower; &gt;1 faster). */
export const EXPRESSION_HEAD_TIME_SCALE: Record<ExpressionState, number> = {
  thinking:    0.7,
  explaining:  1.2,
  confirming:  1.5,
  listening:   1.0,
  emphasizing: 1.35,
  neutral:     0.85,
};

/** Per-expression gain multiplier on top of energy-scaled primitive gain. */
export const EXPRESSION_GAIN_MUL: Record<ExpressionState, number> = {
  explaining:  1.15,
  thinking:    1.0,
  confirming:  1.2,
  listening:   0.9,
  emphasizing: 1.3,
  neutral:     0.72,  // was 0.55 — lifts nod/tilt above adaptive dead-zone during silence
};

/**
 * Priority table: higher number = higher authority.
 * A new expression can only override the committed one if its priority ≥ committed.
 * Prevents `neutral` from sneaking in during a brief intent gap.
 */
export const EXPRESSION_PRIORITY: Record<ExpressionState, number> = {
  neutral:     0,
  listening:   1,
  thinking:    2,
  confirming:  3,
  explaining:  4,
  emphasizing: 5,
};

/**
 * Per-expression energy responsiveness (0–1).
 * Controls how much `smoothedEnergy` modulates `headTimeScale`.
 *   0 = timing fully style-locked (thinking: intrinsic rhythm regardless of energy)
 *   1 = timing fully energy-driven
 */
export const EXPRESSION_ENERGY_INFLUENCE: Record<ExpressionState, number> = {
  thinking:    0.12,
  listening:   0.22,
  neutral:     0.18,
  explaining:  0.32,
  confirming:  0.38,
  emphasizing: 0.44,
};

// ─── Intent → Expression ──────────────────────────────────────────────────────

/**
 * Optional semantic hints extracted from the spoken text.
 * Channel ranges 0..1 unless boolean.
 *
 * - emphasis     → "very", "must", "!", Arabic intensifiers     → emphasizing (nod + tilt)
 * - question     → "?" / "؟" / interrogative starts             → thinking    (tilt)  ← spec
 * - explanation  → "because", "therefore", enumeration markers  → explaining  (slow nod + turn)
 * - attention    → "look", "notice", "pay attention", imperatives → listening (turn)  ← spec
 * - thinkingCue  → "let me think", "hmm"                         → thinking    (tilt)
 */
export type ExpressionSpeechHints = {
  emphasis:    number;
  question:    number;
  explanation: number;
  attention?:  number;
  thinkingCue?: number;
};

/**
 * Priority of text-driven cues (highest wins):
 *   emphasis(0.6+) > [explanation tied with question, explanation wins on tie]
 *   > question > explanation > thinkingCue > attention
 *
 * This priority is intentional:
 *   - emphasis is loud + brief → must always cut through
 *   - explanation is structural → slow nod / turn
 *   - question is the dominant interrogative shape → tilt
 *     (but a *single* trailing `?` in narration must NOT flip the avatar into
 *      `thinking`; it now scores below 0.5 on its own — see speechSemanticHints).
 *   - attention is a soft cue → turn only if nothing more salient is happening
 */
export function mapIntentToExpression(
  intent: MotionIntentKind,
  mode: BehaviorMotionMode,
  speechHints?: ExpressionSpeechHints,
): ExpressionState {
  // Text-driven path takes priority over intent / mode when signals are strong.
  if (speechHints) {
    if (speechHints.emphasis > 0.6) return 'emphasizing';
    /** Explanation outranks question on tie/draw — narration must not lose to a rhetorical mark. */
    if (speechHints.explanation > 0.5 && speechHints.explanation >= speechHints.question) {
      return 'explaining';
    }
    if (speechHints.question > 0.5) return 'thinking';
    if (speechHints.explanation > 0.5) return 'explaining';
    if ((speechHints.thinkingCue ?? 0) > 0.5) return 'thinking';
    if ((speechHints.attention ?? 0) > 0.5) return 'listening';
  }

  switch (intent) {
    case 'explaining':
      return 'explaining';
    case 'thinking':
      return 'thinking';
    case 'listening':
      return 'listening';
    default:
      break;
  }

  switch (mode) {
    case 'RESPONDING':
      return speechHints && speechHints.explanation > 0.5 ? 'explaining' : 'confirming';
    case 'LISTENING':
      return 'listening';
    case 'THINKING':
      return 'thinking';
    default:
      return 'neutral';
  }
}

// ─── Persona overrides (stance → motion authority) ────────────────────────────

export type PersonaExpressionHeadOverride = {
  /** Multiply every allowed primitive gain. */
  gainMul: number;
  /** Multiply {@link EXPRESSION_HEAD_TIME_SCALE} (formal → slower nod). */
  freqMul: number;
  /** Force-remove tilt from allowed set. */
  blockHeadTilt: boolean;
  /** Strong reduction on nod (formal instructor). */
  nodGainMul: number;
  /** Boost nod + tilt for celebrate stance. */
  celebrateNodMul: number;
  celebrateTiltMul: number;
  /** Upper bound for head-layer expression gains (before composition). */
  gainMaxCap: number;
};

export function personaHeadOverride(stance: CogniTeachingStance): PersonaExpressionHeadOverride {
  switch (stance) {
    case 'formal_instructor':
      return {
        gainMul: 0.72,
        freqMul: 0.72,
        blockHeadTilt: true,
        nodGainMul: 0.65,
        celebrateNodMul: 1,
        celebrateTiltMul: 1,
        gainMaxCap: 1.6,
      };
    case 'charismatic_celebrate':
      return {
        gainMul: 1.12,
        freqMul: 1.05,
        blockHeadTilt: false,
        nodGainMul: 1,
        celebrateNodMul: 1.18,
        celebrateTiltMul: 1.14,
        gainMaxCap: 2.0,
      };
    default:
      return {
        gainMul: 1,
        freqMul: 1,
        blockHeadTilt: false,
        nodGainMul: 1,
        celebrateNodMul: 1,
        celebrateTiltMul: 1,
        gainMaxCap: 1.6,
      };
  }
}

/** @deprecated use {@link EXPRESSION_ALLOWED} */
export const EXPRESSION_TO_PRIMITIVES = EXPRESSION_ALLOWED;
