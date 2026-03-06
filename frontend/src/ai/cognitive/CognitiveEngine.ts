/**
 * CognitiveEngine — Layer 8 pedagogical intelligence for the NEXUS avatar.
 *
 * Responsibilities:
 *   1. Classify student intent from raw text (COGNITIVE INTENT ENGINE)
 *   2. Select the primary teaching goal (MULTI-GOAL DECISION ENGINE)
 *   3. Adapt strategy based on observed student state (PEDAGOGICAL INTELLIGENCE)
 *   4. Track emotional trajectory within the session (EMOTIONAL MEMORY)
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
  | 'idle';

// ─── Goal Types ───────────────────────────────────────────────────────────────

export type GoalType =
  | 'teach_btec'
  | 'answer_question'
  | 'assist_request'
  | 'calm_student'
  | 'friendly_reply'
  | 'greet'
  | 'farewell'
  | 'idle_behaviour';

// ─── Student Emotional State ──────────────────────────────────────────────────

export type EmotionalState =
  | 'neutral'
  | 'confused'
  | 'curious'
  | 'anxious'
  | 'progressing'
  | 'successful';

// ─── Pedagogical Strategy ─────────────────────────────────────────────────────

export interface PedagogicalStrategy {
  tone: 'slow' | 'normal' | 'energetic';
  gestureIntensity: 'low' | 'medium' | 'high';
  recommendedEmotion: string;
  approachNote: string;
}

// ─── Intent keyword maps ──────────────────────────────────────────────────────

const INTENT_PATTERNS: Array<{ intent: IntentType; patterns: RegExp[] }> = [
  {
    intent: 'btec_question',
    patterns: [
      /\b(P1|P2|P3|M1|M2|M3|D1|D2|D3|BTEC|criteria|merit|distinction|LO|learning outcome|assignment|brief|pass)\b/i,
    ],
  },
  {
    intent: 'confusion',
    patterns: [
      /مش فاهم|ما فهمت|مو واضح|confused|lost|don'?t (get|understand)|شو يعني|مش واضح/i,
    ],
  },
  {
    intent: 'gratitude',
    patterns: [
      /شكر|يسلم|thanks?|thank you|ممتاز|رائع|برافو|احسنت|أحسنت|great|awesome|perfect/i,
    ],
  },
  {
    intent: 'greeting',
    patterns: [
      /^(مرحبا|أهلا|هلا|هاي|hi|hello|hey|كيفك|شو اخبارك|السلام|good (morning|afternoon|evening))\b/i,
    ],
  },
  {
    intent: 'farewell',
    patterns: [
      /مع السلامة|باي|وداع|bye|goodbye|see you|يلا وداع|تصبح على خير/i,
    ],
  },
  {
    intent: 'request',
    patterns: [
      /أريد|بدي|ممكن|please|ساعدني|give me|can you|help me|explain|وضّح|اشرح/i,
    ],
  },
  {
    intent: 'general_question',
    patterns: [
      /لماذا|كيف|ما هو|ما هي|what|why|how|when|explain|describe|لو سمحت/i,
    ],
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
};

// ─── Emotional state cues ─────────────────────────────────────────────────────

const CONFUSED_CUES = /مش فاهم|ما فهمت|confused|lost|don'?t (get|understand)|صعب|difficult|impossible/i;
const CURIOUS_CUES = /why|لماذا|interesting|شيق|tell me more|أكمل|curious|أريد أعرف|want to know/i;
const ANXIOUS_CUES = /stressed|قلقان|خايف|worried|nervous|scared|don'?t know|مو قادر/i;
const SUCCESS_CUES = /فهمت|got it|شكراً|thanks|رائع|great|excellent|ممتاز|يسلمو|perfect/i;

// ─── CognitiveEngine ──────────────────────────────────────────────────────────

export class CognitiveEngine {
  private emotionalState: EmotionalState = 'neutral';
  private confusedTurns = 0;
  private turnCount = 0;

  /**
   * Classify a student message into one of the 8 intent types.
   * Returns 'idle' if no pattern matches strongly.
   */
  analyzeIntent(text: string): IntentType {
    const trimmed = text.trim();
    for (const { intent, patterns } of INTENT_PATTERNS) {
      if (patterns.some((p) => p.test(trimmed))) {
        return intent;
      }
    }
    return 'idle';
  }

  /**
   * Map an intent directly to the primary teaching goal.
   */
  selectGoal(intent: IntentType): GoalType {
    return INTENT_TO_GOAL[intent];
  }

  /**
   * Observe the student message and update the internal emotional state (Layer 8.1).
   * Returns the updated state.
   */
  updateEmotionalState(text: string): EmotionalState {
    this.turnCount++;

    if (SUCCESS_CUES.test(text)) {
      this.confusedTurns = 0;
      this.emotionalState = 'successful';
    } else if (CONFUSED_CUES.test(text)) {
      this.confusedTurns++;
      this.emotionalState = this.confusedTurns >= 3 ? 'confused' : 'confused';
    } else if (ANXIOUS_CUES.test(text)) {
      this.emotionalState = 'anxious';
    } else if (CURIOUS_CUES.test(text)) {
      this.confusedTurns = 0;
      this.emotionalState = 'curious';
    } else {
      // Gradual recovery toward neutral
      if (this.emotionalState === 'confused' || this.emotionalState === 'anxious') {
        this.confusedTurns = Math.max(0, this.confusedTurns - 1);
      }
      if (this.emotionalState !== 'successful') {
        this.emotionalState = this.confusedTurns > 0 ? 'confused' : 'neutral';
      }
    }

    return this.emotionalState;
  }

  /**
   * Returns a pedagogical strategy tailored to the current emotional state (Layer 8.2).
   */
  adaptPedagogically(state?: EmotionalState): PedagogicalStrategy {
    const s = state ?? this.emotionalState;
    switch (s) {
      case 'confused':
        return {
          tone: 'slow',
          gestureIntensity: 'low',
          recommendedEmotion: 'friendly',
          approachNote:
            this.confusedTurns >= 3
              ? 'يلا نرجع للأساس مع بعض — break concept into numbered micro-steps.'
              : 'Shrink concept, use real-world analogy, ask "هسا وضحت الفكرة؟"',
        };
      case 'anxious':
        return {
          tone: 'slow',
          gestureIntensity: 'low',
          recommendedEmotion: 'encouraging',
          approachNote: 'Validate feelings first. Use "ولا يهمك، هاي طبيعي." Slow pace. No jargon.',
        };
      case 'curious':
        return {
          tone: 'energetic',
          gestureIntensity: 'medium',
          recommendedEmotion: 'encouraging',
          approachNote: 'Reward curiosity. Expand with real-world example. Add a "what-if" challenge.',
        };
      case 'successful':
        return {
          tone: 'energetic',
          gestureIntensity: 'high',
          recommendedEmotion: 'celebrate',
          approachNote: 'Celebrate explicitly. Reference the specific achievement. Push toward Distinction.',
        };
      case 'progressing':
        return {
          tone: 'normal',
          gestureIntensity: 'medium',
          recommendedEmotion: 'encouraging',
          approachNote: 'Increase depth. Introduce Merit/Distinction nuances. Invite critical thinking.',
        };
      default: // neutral
        return {
          tone: 'normal',
          gestureIntensity: 'medium',
          recommendedEmotion: 'friendly',
          approachNote: 'Teach step-by-step. Map to P/M/D. Invite student to try.',
        };
    }
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
    this.turnCount = 0;
  }

  getEmotionalState(): EmotionalState {
    return this.emotionalState;
  }
}

export const cognitiveEngine = new CognitiveEngine();

// ─── Reply-type classifier ────────────────────────────────────────────────────
// Classifies the *AI reply text* (not the student message) to drive avatar
// reactions. Distinct from analyzeIntent() which classifies student input.

export type ReplyType = 'celebration' | 'question' | 'sad' | 'surprised' | 'neutral';

/**
 * Detect what kind of reply the AI gave and return an avatar reaction type.
 * Used by director.ts to override neutral emotion when text has strong cues.
 */
export function classifyReplyType(reply: string): ReplyType {
  if (/أحسنت|ممتاز|رائع|جيد جداً|جيد جدا|شاطر|bravo|excellent|perfect|great|تهانينا|مبروك|إبداع|عظيم/i.test(reply))
    return 'celebration';
  if (/للأسف|خطأ|سيء|خاطئ|wrong|error|fail|unfortunately|محزن/i.test(reply))
    return 'sad';
  if (/يا إلهي|حقاً|حقا|لا أصدق|أحقاً|أحقا|wow|oh my god|really\?|omg|مدهش|لا يُصدَّق/i.test(reply))
    return 'surprised';
  if (/[؟?]|هل |لماذا |كيف |ماذا |\bwhat\b|\bwhy\b|\bhow\b|\bwhen\b/i.test(reply))
    return 'question';
  return 'neutral';
}
