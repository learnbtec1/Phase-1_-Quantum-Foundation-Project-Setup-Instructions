/**
 * CognitiveEngine — Layer 8 pedagogical intelligence for the EDUVERSE avatar.
 *
 * Responsibilities:
 *   1. Classify student intent from raw text (COGNITIVE INTENT ENGINE)
 *   2. Select the primary teaching goal (MULTI-GOAL DECISION ENGINE)
 *   3. Adapt strategy based on observed student state (PEDAGOGICAL INTELLIGENCE)
 *   4. Track emotional trajectory within the session (EMOTIONAL MEMORY)
 *   5. Avoid repetitive gestures (MOTOR MEMORY)
 *   6. Respond to explicit student performance events (PERFORMANCE ADAPTATION)
 *
 * This is a pure client-side module — no network calls.
 */

// ─── Intent Types ─────────────────────────────────────────────────────────────

export type IntentType =
  | 'btec_question'
  | 'general_question'
  | 'request'
  | 'confusion'
  | 'gratitude'
  | 'greeting'
  | 'farewell'
  | 'idle'
  | 'celebration_student'
  | 'sad_student'
  | 'surprised_student';

// ─── Goal Types ───────────────────────────────────────────────────────────────

export type GoalType =
  | 'teach_btec'
  | 'answer_question'
  | 'assist_request'
  | 'calm_student'
  | 'friendly_reply'
  | 'greet'
  | 'farewell'
  | 'idle_behaviour'
  | 'celebrate_student_achievement'
  | 'empathize_with_student'
  | 'express_surprise';

// ─── Student Emotional State ──────────────────────────────────────────────────

export type EmotionalState =
  | 'neutral'
  | 'confused'
  | 'curious'
  | 'anxious'
  | 'progressing'
  | 'successful'
  | 'frustrated';

// ─── Pedagogical Strategy ─────────────────────────────────────────────────────

export interface PedagogicalStrategy {
  tone: 'slow' | 'normal' | 'energetic';
  gestureIntensity: 'low' | 'medium' | 'high';
  recommendedEmotion: string;
  approachNote: string;
  avoidGesture?: string;
}

// ─── Intent keyword maps with weights ─────────────────────────────────────────

const INTENT_PATTERNS: Array<{ intent: IntentType; patterns: RegExp[]; weight: number }> = [
  {
    intent: 'btec_question',
    patterns: [
      /\b(P1|P2|P3|M1|M2|M3|D1|D2|D3|BTEC|criteria|merit|distinction|LO|learning outcome|assignment|brief|pass)\b/i,
    ],
    weight: 10,
  },
  {
    intent: 'confusion',
    patterns: [
      /مش فاهم|ما فهمت|مو واضح|confused|lost|don'?t (get|understand)|شو يعني|مش واضح|صعب|difficult|impossible/i,
    ],
    weight: 8,
  },
  {
    intent: 'gratitude',
    patterns: [
      /شكر|يسلم|thanks?|thank you|ممتاز|رائع|برافو|احسنت|أحسنت|great|awesome|perfect/i,
    ],
    weight: 7,
  },
  {
    intent: 'greeting',
    patterns: [
      /^(مرحبا|أهلا|هلا|هاي|hi|hello|hey|كيفك|شو اخبارك|السلام|good (morning|afternoon|evening))\b/i,
    ],
    weight: 5,
  },
  {
    intent: 'farewell',
    patterns: [
      /مع السلامة|باي|وداع|bye|goodbye|see you|يلا وداع|تصبح على خير/i,
    ],
    weight: 5,
  },
  {
    intent: 'request',
    patterns: [
      /أريد|بدي|ممكن|please|ساعدني|give me|can you|help me|explain|وضّح|اشرح/i,
    ],
    weight: 9,
  },
  {
    intent: 'celebration_student',
    patterns: [
      /مبروك|ممتاز|رائع|أحسنت|برافو|🎉|excellent|well\s?done|congrat/i,
    ],
    weight: 8,
  },
  {
    intent: 'sad_student',
    patterns: [
      /أسف|للأسف|مؤلم|حزن|صعب|unfortunately|sorry|sad/i,
    ],
    weight: 8,
  },
  {
    intent: 'surprised_student',
    patterns: [
      /واو|مفاجأة|لم أتوقع|wow|surprising|unexpected|amazing/i,
    ],
    weight: 8,
  },
  {
    intent: 'general_question',
    patterns: [
      /لماذا|كيف|ما هو|ما هي|what|why|how|when|explain|describe|لو سمحت/i,
    ],
    weight: 6,
  },
];

// ─── Intent → Goal mapping ────────────────────────────────────────────────────

const INTENT_TO_GOAL: Record<IntentType, GoalType> = {
  btec_question: 'teach_btec',
  general_question: 'answer_question',
  request: 'assist_request',
  confusion: 'calm_student',
  gratitude: 'friendly_reply',
  greeting: 'greet',
  farewell: 'farewell',
  idle: 'idle_behaviour',
  celebration_student: 'celebrate_student_achievement',
  sad_student: 'empathize_with_student',
  surprised_student: 'express_surprise',
};

// ─── Emotional state cues ─────────────────────────────────────────────────────

const CONFUSED_CUES = /مش فاهم|ما فهمت|confused|lost|don'?t (get|understand)|صعب|difficult|impossible/i;
const CURIOUS_CUES = /why|لماذا|interesting|شيق|tell me more|أكمل|curious|أريد أعرف|want to know/i;
const ANXIOUS_CUES = /stressed|قلقان|خايف|worried|nervous|scared|don'?t know|مو قادر/i;
const SUCCESS_CUES = /فهمت|got it|شكراً|thanks|رائع|great|excellent|ممتاز|يسلمو|perfect/i;
const FRUSTRATED_CUES = /زهقت|مليت|تعبت|frustrated|tired|give up/i;

// ─── CognitiveEngine ──────────────────────────────────────────────────────────

export class CognitiveEngine {
  private emotionalState: EmotionalState = 'neutral';
  private confusedTurns = 0;
  private successfulTurns = 0;
  private turnCount = 0;
  private lastIntent: IntentType | null = null;
  private lastGoal: GoalType | null = null;
  private lastRecommendedEmotion: string | null = null;
  private recentPerformanceScores: number[] = [];
  private readonly PERFORMANCE_HISTORY_SIZE = 5;

  /**
   * Classify a student message into one of the intent types.
   * Returns 'idle' if no pattern matches. Uses weighted matching.
   */
  analyzeIntent(text: string): IntentType {
    const trimmed = text.trim();
    let bestMatch: { intent: IntentType; weight: number } | null = null;

    for (const { intent, patterns, weight } of INTENT_PATTERNS) {
      if (patterns.some((p) => p.test(trimmed))) {
        if (!bestMatch || weight > bestMatch.weight) {
          bestMatch = { intent, weight };
        }
      }
    }
    this.lastIntent = bestMatch?.intent || 'idle';
    return this.lastIntent;
  }

  /**
   * Map an intent directly to the primary teaching goal.
   */
  selectGoal(intent: IntentType): GoalType {
    this.lastGoal = INTENT_TO_GOAL[intent];
    return this.lastGoal;
  }

  /**
   * Observe the student message and update the internal emotional state (Layer 8.1).
   * Returns the updated state.
   */
  updateEmotionalState(text: string): EmotionalState {
    this.turnCount++;

    if (SUCCESS_CUES.test(text)) {
      this.confusedTurns = Math.max(0, this.confusedTurns - 1);
      this.successfulTurns++;
      this.emotionalState = 'successful';
    } else if (FRUSTRATED_CUES.test(text)) {
      this.confusedTurns = 5;
      this.successfulTurns = 0;
      this.emotionalState = 'frustrated';
    } else if (CONFUSED_CUES.test(text)) {
      this.confusedTurns++;
      this.successfulTurns = 0;
      this.emotionalState = this.confusedTurns >= 3 ? 'frustrated' : 'confused';
    } else if (ANXIOUS_CUES.test(text)) {
      this.successfulTurns = 0;
      this.emotionalState = 'anxious';
    } else if (CURIOUS_CUES.test(text)) {
      this.confusedTurns = 0;
      this.successfulTurns++;
      this.emotionalState = 'curious';
    } else {
      if (this.emotionalState === 'confused' || this.emotionalState === 'anxious' || this.emotionalState === 'frustrated') {
        this.confusedTurns = Math.max(0, this.confusedTurns - 1);
      }
      if (this.emotionalState === 'successful' || this.emotionalState === 'curious') {
        this.successfulTurns = Math.max(0, this.successfulTurns - 1);
      }
      if (this.confusedTurns > 0) {
        this.emotionalState = 'confused';
      } else if (this.successfulTurns > 1) {
        this.emotionalState = 'progressing';
      } else if (this.emotionalState !== 'successful') {
        this.emotionalState = 'neutral';
      }
    }

    return this.emotionalState;
  }

  /**
   * Handle explicit student performance events (quiz scores).
   * Directly influences emotional state and strategy.
   */
  handlePerformanceEvent(score: number, maxScore: number, errorType?: 'minor' | 'major'): EmotionalState {
    const percentage = (score / maxScore) * 100;
    this.recentPerformanceScores.push(percentage);
    if (this.recentPerformanceScores.length > this.PERFORMANCE_HISTORY_SIZE) {
      this.recentPerformanceScores.shift();
    }
    const avgPerf = this.recentPerformanceScores.reduce((a, b) => a + b, 0) / this.recentPerformanceScores.length;

    if (percentage >= 90) {
      this.emotionalState = 'successful';
      this.successfulTurns += 2;
      this.confusedTurns = 0;
    } else if (percentage >= 70) {
      this.emotionalState = 'progressing';
      this.successfulTurns++;
      this.confusedTurns = Math.max(0, this.confusedTurns - 1);
    } else if (percentage < 50 || errorType === 'major') {
      this.emotionalState = 'frustrated';
      this.confusedTurns += 2;
      this.successfulTurns = 0;
    } else {
      this.emotionalState = 'confused';
      this.confusedTurns++;
      this.successfulTurns = 0;
    }
    if (avgPerf < 60 && this.turnCount > this.PERFORMANCE_HISTORY_SIZE) {
      this.emotionalState = 'anxious';
    }
    return this.emotionalState;
  }

  /**
   * Returns a pedagogical strategy tailored to the current emotional state (Layer 8.2).
   * Avoids repeating the last recommended emotion/gesture.
   */
  adaptPedagogically(state?: EmotionalState): PedagogicalStrategy {
    const s = state ?? this.emotionalState;
    let strategy: PedagogicalStrategy;

    switch (s) {
      case 'confused':
        strategy = {
          tone: 'slow',
          gestureIntensity: 'low',
          recommendedEmotion: 'friendly',
          approachNote:
            this.confusedTurns >= 3
              ? 'يلا نرجع للأساس مع بعض — break concept into numbered micro-steps.'
              : 'Shrink concept, use real-world analogy, ask "هسا وضحت الفكرة؟"',
        };
        break;
      case 'frustrated':
        strategy = {
          tone: 'slow',
          gestureIntensity: 'low',
          recommendedEmotion: 'empathetic',
          approachNote: 'Acknowledge frustration. Offer a break or a different approach. "أنا هنا لمساعدتك، لنجرب طريقة أخرى."',
        };
        break;
      case 'anxious':
        strategy = {
          tone: 'slow',
          gestureIntensity: 'low',
          recommendedEmotion: 'encouraging',
          approachNote: 'Validate feelings first. Use "ولا يهمك، هاي طبيعي." Slow pace. No jargon.',
        };
        break;
      case 'curious':
        strategy = {
          tone: 'energetic',
          gestureIntensity: 'medium',
          recommendedEmotion: 'encouraging',
          approachNote: 'Reward curiosity. Expand with real-world example. Add a "what-if" challenge.',
        };
        break;
      case 'successful':
        strategy = {
          tone: 'energetic',
          gestureIntensity: 'high',
          recommendedEmotion: 'celebration',
          approachNote: 'Celebrate explicitly. Reference the specific achievement. Push toward Distinction.',
        };
        break;
      case 'progressing':
        strategy = {
          tone: 'normal',
          gestureIntensity: 'medium',
          recommendedEmotion: 'encouraging',
          approachNote: 'Increase depth. Introduce Merit/Distinction nuances. Invite critical thinking.',
        };
        break;
      default: // neutral
        strategy = {
          tone: 'normal',
          gestureIntensity: 'medium',
          recommendedEmotion: 'friendly',
          approachNote: 'Teach step-by-step. Map to P/M/D. Invite student to try.',
        };
        break;
    }

    // Avoid repeating the same emotion back-to-back (motor memory)
    if (strategy.recommendedEmotion === this.lastRecommendedEmotion) {
      strategy.avoidGesture = strategy.recommendedEmotion;
    }
    this.lastRecommendedEmotion = strategy.recommendedEmotion;
    return strategy;
  }

  /**
   * Full pipeline: intent → goal → strategy (mutates internal state).
   */
  process(text: string): {
    intent: IntentType;
    goal: GoalType;
    emotionalState: EmotionalState;
    strategy: PedagogicalStrategy;
  } {
    const intent = this.analyzeIntent(text);
    const goal = this.selectGoal(intent);
    const emotionalState = this.updateEmotionalState(text);
    const strategy = this.adaptPedagogically(emotionalState);
    return { intent, goal, emotionalState, strategy };
  }

  /** Reset the session state (call on new conversation). */
  reset(): void {
    this.emotionalState = 'neutral';
    this.confusedTurns = 0;
    this.successfulTurns = 0;
    this.turnCount = 0;
    this.lastIntent = null;
    this.lastGoal = null;
    this.lastRecommendedEmotion = null;
    this.recentPerformanceScores = [];
  }

  getEmotionalState(): EmotionalState {
    return this.emotionalState;
  }
}

export const cognitiveEngine = new CognitiveEngine();

// ─────────────────────────────────────────────────────────────────────────────
// Standalone helpers used by director.ts
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Classify the emotional sub-type of a reply text (Arabic + English).
 * Returns a fine-grained override for neutral/friendly/relax emotions.
 */
export function classifyReplyType(
  text: string,
): 'celebration' | 'sad' | 'surprised' | 'question' | undefined {
  if (/مبروك|ممتاز|رائع|أحسنت|برافو|🎉|excellent|well\s?done|congrat/i.test(text))
    return 'celebration';
  if (/أسف|للأسف|مؤلم|حزن|صعب|unfortunately|sorry|sad/i.test(text))
    return 'sad';
  if (/واو|مفاجأة|لم أتوقع|wow|surprising|unexpected|amazing/i.test(text))
    return 'surprised';
  if (/[؟?]/.test(text) || /هل |لماذا |كيف |ما هو|what |how |why /i.test(text))
    return 'question';
  return undefined;
}

/** Map an emotion name to TTS prosody values (rate / pitch multipliers). */
export function emotionToProsody(emotion: string): { rate: number; pitch: number } {
  const map: Record<string, { rate: number; pitch: number }> = {
    celebration: { rate: 1.15, pitch: 1.20 },
    excited:     { rate: 1.10, pitch: 1.15 },
    happy:       { rate: 1.05, pitch: 1.10 },
    encouraging: { rate: 1.00, pitch: 1.05 },
    friendly:    { rate: 0.95, pitch: 1.00 },
    neutral:     { rate: 0.92, pitch: 1.00 },
    relax:       { rate: 0.90, pitch: 0.98 },
    thinking:    { rate: 0.85, pitch: 0.95 },
    sad:         { rate: 0.80, pitch: 0.90 },
    angry:       { rate: 1.05, pitch: 0.88 },
    strict:      { rate: 0.90, pitch: 0.95 },
    empathetic:  { rate: 0.88, pitch: 0.97 },
    calm:        { rate: 0.85, pitch: 0.95 },
  };
  return map[emotion] ?? { rate: 0.92, pitch: 1.0 };
}

/**
 * Dev-only telemetry logger — a no-op in production.
 * Outputs a coloured console entry with the supplied data.
 */
export function humanizeTelemetry(
  tag: string,
  data: Record<string, unknown>,
): void {
  if (process.env.NODE_ENV !== 'development') return;
  console.log(`%c[HUMANIZE][${tag}]`, 'color:#a78bfa;font-weight:bold', data);
}

/**
 * Avatar self-check telemetry — records a structured performance diagnostic
 * snapshot per response (intent, emotion, gesture, voice, error count).
 * No-op in production.
 */
export function selfCheckTelemetry(payload: {
  intent:   string;
  emotion:  string;
  gesture?: string;
  preroll?: string;
  voice?:   { rate: number; pitch: number | string };
  memory?:  { lastGestures?: string[] };
  errors?:  number;
}): void {
  if (process.env.NODE_ENV !== 'development') return;
  console.log(
    '%c[SELF-CHECK][AVATAR]',
    'color:#34d399;font-weight:bold',
    payload,
  );
}
