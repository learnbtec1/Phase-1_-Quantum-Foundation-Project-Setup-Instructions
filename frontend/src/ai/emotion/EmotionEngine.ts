/**
 * EmotionEngine.ts — P.A.D (Pleasure, Arousal, Dominance) avatar emotion model.
 *
 * Implements partial mirroring of user emotion + contextual nudging + lerp smoothing.
 * Zero mutable global state; caller owns the EmotionEngine instance.
 *
 * Usage:
 *   const engine = new EmotionEngine();
 *   const output = engine.update(userPAD, context, personality);
 *   // output: { avatarPAD, gesture, voiceStyle }
 */

// ── P.A.D types ───────────────────────────────────────────────────────────────

export interface PAD {
  pleasure:   number;  // –1..1  (negative = displeasure)
  arousal:    number;  // –1..1  (negative = calm)
  dominance:  number;  // –1..1  (negative = submissive)
}

export interface PADLabeled extends PAD {
  label: string;
}

export interface PersonalityTraits {
  empathy:       number;  // 0..1
  humor:         number;  // 0..1
  openness:      number;  // 0..1
  agreeableness: number;  // 0..1
  formality:     number;  // 0..1
}

export interface EmotionContext {
  intent:     string;    // 'question' | 'statement' | 'complaint' | 'praise' | 'neutral'
  keywords:   string[];
  topic:      string;
  importance: number;    // 0..1
  silenceMs:  number;
}

export interface EmotionOutput {
  avatarPAD:  PADLabeled;
  gesture:    string;    // e.g. 'nod', 'tilt', 'open_hands', 'lean_back'
  voiceStyle: string;    // e.g. 'warm', 'cheerful', 'calm', 'serious'
}

// ── Named PAD anchors ─────────────────────────────────────────────────────────

const NEUTRAL_PAD: PAD = { pleasure: 0, arousal: 0, dominance: 0 };

/** Named emotion anchors in P.A.D space. */
const PAD_ANCHORS: Readonly<Record<string, PAD>> = {
  happy:        { pleasure:  0.80, arousal:  0.60, dominance:  0.40 },
  excited:      { pleasure:  0.70, arousal:  0.85, dominance:  0.55 },
  calm:         { pleasure:  0.50, arousal: -0.50, dominance:  0.10 },
  friendly:     { pleasure:  0.60, arousal:  0.15, dominance:  0.00 },
  encouraging:  { pleasure:  0.65, arousal:  0.45, dominance:  0.35 },
  thinking:     { pleasure:  0.10, arousal:  0.20, dominance:  0.00 },
  curious:      { pleasure:  0.30, arousal:  0.40, dominance: -0.10 },
  neutral:      { pleasure:  0.00, arousal:  0.00, dominance:  0.00 },
  sad:          { pleasure: -0.60, arousal: -0.35, dominance: -0.40 },
  bored:        { pleasure: -0.20, arousal: -0.60, dominance: -0.20 },
  concerned:    { pleasure: -0.15, arousal:  0.25, dominance:  0.05 },
  strict:       { pleasure:  0.10, arousal:  0.30, dominance:  0.65 },
  anxious:      { pleasure: -0.45, arousal:  0.65, dominance: -0.40 },
};

/** Map P.A.D vector to its nearest named label. */
function padToLabel(p: PAD): string {
  let best = 'neutral';
  let bestDist = Infinity;
  for (const [name, anchor] of Object.entries(PAD_ANCHORS)) {
    const dist = Math.sqrt(
      (p.pleasure  - anchor.pleasure)  ** 2 +
      (p.arousal   - anchor.arousal)   ** 2 +
      (p.dominance - anchor.dominance) ** 2,
    );
    if (dist < bestDist) { bestDist = dist; best = name; }
  }
  return best;
}

// ── Gesture + voice style lookup ──────────────────────────────────────────────

function pickGesture(label: string, context: EmotionContext): string {
  const byLabel: Readonly<Record<string, string>> = {
    happy:       'open_hands',
    excited:     'wave',
    calm:        'hands_down',
    friendly:    'nod',
    encouraging: 'lean_forward',
    thinking:    'chin_touch',
    curious:     'tilt',
    neutral:     'idle',
    sad:         'look_down',
    bored:       'lean_back',
    concerned:   'tilt',
    strict:      'point',
    anxious:     'fidget',
  };
  if (context.intent === 'question') return 'tilt';
  if (context.intent === 'praise')   return 'nod';
  return byLabel[label] ?? 'idle';
}

function pickVoiceStyle(label: string, formality: number): string {
  const base: Readonly<Record<string, string>> = {
    happy:       'cheerful',
    excited:     'excited',
    calm:        'gentle',
    friendly:    'warm',
    encouraging: 'empathetic',
    thinking:    'calm',
    curious:     'friendly',
    neutral:     'calm',
    sad:         'gentle',
    bored:       'calm',
    concerned:   'empathetic',
    strict:      'serious',
    anxious:     'calm',
  };
  const style = base[label] ?? 'calm';
  // High formality overrides casual styles
  if (formality > 0.7 && (style === 'cheerful' || style === 'excited')) return 'friendly';
  return style;
}

// ── Clamp helper ──────────────────────────────────────────────────────────────

function clamp(v: number, lo = -1, hi = 1): number {
  return Math.max(lo, Math.min(hi, v));
}

function lerpPAD(a: PAD, b: PAD, t: number): PAD {
  return {
    pleasure:  a.pleasure  + (b.pleasure  - a.pleasure)  * t,
    arousal:   a.arousal   + (b.arousal   - a.arousal)   * t,
    dominance: a.dominance + (b.dominance - a.dominance) * t,
  };
}

// ── EmotionEngine ─────────────────────────────────────────────────────────────

export class EmotionEngine {
  /** Current smoothed avatar P.A.D (mutable — updated on each call to update()). */
  private _current: PAD = { ...NEUTRAL_PAD };

  /** Smoothing factor per update() call (higher = faster response). */
  private readonly _alpha: number;

  constructor(opts: { smoothingAlpha?: number } = {}) {
    this._alpha = opts.smoothingAlpha ?? 0.18;
  }

  /** Return current PAD snapshot (read-only). */
  get current(): PADLabeled {
    return { ...this._current, label: padToLabel(this._current) };
  }

  /**
   * Compute new avatar emotion given:
   *  - `userPAD`   : detected user emotion (or null → treated as neutral)
   *  - `context`   : conversation context (intent, topic, importance)
   *  - `personality`: avatar personality traits
   *
   * Updates internal smoothed state and returns outputs.
   */
  update(
    userPAD:     PAD | null,
    context:     EmotionContext,
    personality: PersonalityTraits,
  ): EmotionOutput {
    const uPAD = userPAD ?? NEUTRAL_PAD;

    // 1. Partial mirroring — mirror a fraction of user P.A.D weighted by empathy
    const mirrorFactor = personality.empathy * 0.45;
    let target: PAD = {
      pleasure:  uPAD.pleasure  * mirrorFactor,
      arousal:   uPAD.arousal   * mirrorFactor * 0.7,  // dampen arousal mirroring
      dominance: NEUTRAL_PAD.dominance,
    };

    // 2. Contextual nudges
    switch (context.intent) {
      case 'question':
        // Nudge toward curious: slightly positive pleasure, raised arousal
        target.pleasure  += 0.15 * context.importance;
        target.arousal   += 0.20 * context.importance;
        target.dominance += 0.10;
        break;
      case 'praise':
        target.pleasure  += 0.30 * context.importance;
        target.arousal   += 0.15;
        target.dominance += 0.20;
        break;
      case 'complaint':
        // User sad/negative → avatar becomes more caring (lower dominance, slight pleasure drop)
        target.pleasure  -= 0.10 * context.importance;
        target.dominance -= 0.15;
        break;
      case 'statement':
        target.pleasure  += 0.05 * personality.agreeableness;
        break;
    }

    // 3. User sadness → lower dominance (not competitively high-energy)
    if (uPAD.pleasure < -0.3) {
      target.dominance = clamp(target.dominance - 0.20 * (1 - personality.agreeableness));
    }

    // 4. Humour nudge: if avatar is humorous and user is positive, raise arousal a bit
    if (personality.humor > 0.5 && uPAD.pleasure > 0.2) {
      target.arousal = clamp(target.arousal + 0.10 * personality.humor);
      target.pleasure = clamp(target.pleasure + 0.08 * personality.humor);
    }

    // 5. Formality dampens arousal extremes
    if (personality.formality > 0.6) {
      target.arousal = target.arousal * (1 - personality.formality * 0.4);
    }

    // 6. Clamp target to valid range
    target = {
      pleasure:  clamp(target.pleasure),
      arousal:   clamp(target.arousal),
      dominance: clamp(target.dominance),
    };

    // 7. Smooth toward target (lerp by alpha)
    this._current = lerpPAD(this._current, target, this._alpha);

    // 8. Clamp final (guard against floating-point drift)
    this._current = {
      pleasure:  clamp(this._current.pleasure),
      arousal:   clamp(this._current.arousal),
      dominance: clamp(this._current.dominance),
    };

    const label = padToLabel(this._current);
    return {
      avatarPAD:  { ...this._current, label },
      gesture:    pickGesture(label, context),
      voiceStyle: pickVoiceStyle(label, personality.formality),
    };
  }

  /** Force-reset to neutral (e.g. on session clear). */
  reset(): void {
    this._current = { ...NEUTRAL_PAD };
  }

  /** Serialize current state for persistence. */
  toJSON(): PAD {
    return { ...this._current };
  }

  /** Restore from serialized state. */
  fromJSON(data: PAD): void {
    this._current = {
      pleasure:  clamp(data.pleasure  ?? 0),
      arousal:   clamp(data.arousal   ?? 0),
      dominance: clamp(data.dominance ?? 0),
    };
  }
}

export { padToLabel, NEUTRAL_PAD, PAD_ANCHORS };
