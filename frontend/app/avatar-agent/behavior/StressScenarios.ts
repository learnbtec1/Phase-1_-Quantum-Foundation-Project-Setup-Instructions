/**
 * Behavioral stress scenarios — synthetic inputs only (no production behavior change).
 * Steps drive {@link BehaviorBrain#ingest} the same way UI events would.
 */

export type StressScenarioStep =
  | { type: 'behavior_text'; text: string; context?: 'conversation' | 'system' }
  | { type: 'tick'; deltaMs: number };

export type StressScenario = {
  id: string;
  name: string;
  steps: StressScenarioStep[];
};

/** A) Opening stability — low cognitive churn. */
const GREETING_STABILITY: StressScenario = {
  id: 'greeting_stability',
  name: 'GREETING STABILITY TEST',
  steps: [
    { type: 'tick', deltaMs: 16 },
    { type: 'behavior_text', text: 'Hello', context: 'conversation' },
    { type: 'tick', deltaMs: 32 },
    { type: 'behavior_text', text: 'Hi there', context: 'conversation' },
    { type: 'tick', deltaMs: 48 },
    { type: 'behavior_text', text: 'Good morning', context: 'conversation' },
    { type: 'tick', deltaMs: 64 },
  ],
};

/** B) Thinking then abrupt correction — interrupt pressure. */
const THINKING_INTERRUPT: StressScenario = {
  id: 'thinking_interrupt',
  name: 'THINKING INTERRUPT TEST',
  steps: [
    { type: 'tick', deltaMs: 16 },
    {
      type: 'behavior_text',
      text: 'Why do you think this system is complex?',
      context: 'conversation',
    },
    { type: 'tick', deltaMs: 120 },
    { type: 'behavior_text', text: 'wait no', context: 'conversation' },
    { type: 'tick', deltaMs: 40 },
    { type: 'behavior_text', text: 'actually ignore that', context: 'conversation' },
    { type: 'tick', deltaMs: 80 },
  ],
};

/** C) Rapid user turns — stress merge + continuity. */
const RAPID_FIRE: StressScenario = {
  id: 'rapid_fire',
  name: 'RAPID FIRE INTENT SWITCH',
  steps: [
    { type: 'behavior_text', text: 'hi', context: 'conversation' },
    { type: 'tick', deltaMs: 8 },
    { type: 'behavior_text', text: 'explain', context: 'conversation' },
    { type: 'tick', deltaMs: 8 },
    { type: 'behavior_text', text: 'no wait', context: 'conversation' },
    { type: 'tick', deltaMs: 8 },
    { type: 'behavior_text', text: 'go back', context: 'conversation' },
    { type: 'tick', deltaMs: 8 },
    { type: 'behavior_text', text: 'hi again', context: 'conversation' },
    { type: 'tick', deltaMs: 16 },
  ],
};

/** D) Positive then contradiction — emotional tension. */
const EMOTIONAL_CONFLICT: StressScenario = {
  id: 'emotional_conflict',
  name: 'EMOTIONAL CONFLICT SEQUENCE',
  steps: [
    { type: 'tick', deltaMs: 20 },
    { type: 'behavior_text', text: 'Great work!', context: 'conversation' },
    { type: 'tick', deltaMs: 60 },
    { type: 'behavior_text', text: "That's actually wrong", context: 'conversation' },
    { type: 'tick', deltaMs: 50 },
    { type: 'behavior_text', text: 'Really?', context: 'conversation' },
    { type: 'tick', deltaMs: 40 },
    { type: 'behavior_text', text: 'Could you explain why?', context: 'conversation' },
    { type: 'tick', deltaMs: 100 },
  ],
};

/** E) Long session — drift + memory + many merges. */
function buildLongConversationSteps(): StressScenarioStep[] {
  const lines = [
    'Hello',
    'How are you?',
    'What is quantum?',
    'Explain in simple terms',
    'Why is that?',
    'Interesting',
    'Tell me more',
    'What about errors?',
    'Sounds complex',
    'Is it stable?',
    'What about timing?',
    'And gestures?',
    'Ok thanks',
    'One more question',
    'Why do you think this system is complex?',
    'Hmm',
    'Actually never mind',
    'Wait',
    'Go back',
    'Explain again',
    'Thanks',
    'Bye',
  ];
  const steps: StressScenarioStep[] = [{ type: 'tick', deltaMs: 16 }];
  for (let i = 0; i < lines.length; i++) {
    steps.push({ type: 'behavior_text', text: lines[i], context: 'conversation' });
    steps.push({ type: 'tick', deltaMs: 20 + (i % 5) * 4 });
  }
  return steps;
}

const LONG_CONVERSATION_DRIFT: StressScenario = {
  id: 'long_conversation_drift',
  name: 'LONG CONVERSATION DRIFT TEST (20+ steps)',
  steps: buildLongConversationSteps(),
};

export const STRESS_SCENARIOS: StressScenario[] = [
  GREETING_STABILITY,
  THINKING_INTERRUPT,
  RAPID_FIRE,
  EMOTIONAL_CONFLICT,
  LONG_CONVERSATION_DRIFT,
];
