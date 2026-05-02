/**
 * Strict BrainState payload + gesture dictionary (Phase 3).
 */
'use client';

export type BrainStatePayload = {
  intent: 'explaining' | 'listening' | 'thinking' | 'emphasizing';
  emotion: 'neutral' | 'happy' | 'serious' | 'concerned';
  gazeTarget: [number, number, number];
  gazeMode: 'direct' | 'thinking' | 'scanning';
  urgency: number;
  timestampMs: number;
  durationMs: number;
  personality: {
    calmness: number;
    expressiveness: number;
  };
  /** Optional: viseme cue count for Phase 5 cognitive load (else derived from duration). */
  visemeCueCount?: number;
};

export type AvatarFsmState = 'IDLE' | 'THINKING' | 'SPEAKING' | 'LISTENING';

export const GestureMap = {
  explaining: ['anim_explain_01', 'anim_explain_02'],
  emphasizing: ['anim_emphasis_01'],
  listening: ['anim_listen_idle'],
  thinking: ['anim_think_01'],
} as const;

/** Logical clip id → existing VRMA stem (repo assets only). */
export const CONTRACT_LOGICAL_ID_TO_VRMA_STEM: Record<string, string> = {
  anim_explain_01: 'VRMA_01',
  anim_explain_02: 'VRMA_02',
  anim_emphasis_01: 'VRMA_03',
  anim_listen_idle: 'Idle1',
  anim_think_01: 'Thinking',
};
