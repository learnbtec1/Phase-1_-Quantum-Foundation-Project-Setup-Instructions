/**
 * Level 6 — Human-realism gate: proposed {@link Intent} → {@link ApprovedIntent} or reject.
 * No motion output.
 */

import type { ApprovedIntent, Intent, IntentEmotion, IntentType } from './intentTypes';

export type ArbitrateInput = {
  proposed: Intent;
  /** Agent / TTS currently outputting speech. */
  agentSpeaking: boolean;
  /** STT / UI “mic on” listening. */
  userListeningPosture: boolean;
};

export type ArbitrateResult =
  | { ok: true; approved: ApprovedIntent }
  | { ok: false; reason: string };

const INTENT_PRIORITY: Record<IntentType, number> = {
  speaking: 5,
  reacting: 4,
  thinking: 3,
  greeting: 3,
  listening: 2,
  idle: 1,
};

function transitionDelayMs(): number {
  return 80 + Math.floor(Math.random() * 170);
}

/**
 * Resolves conflicts, dampens intensity, injects transition delay.
 */
export class BehaviorArbitrator {
  private lastApprovedEmotion: IntentEmotion = 'neutral';
  private lastApprovedType: IntentType = 'idle';

  reset(): void {
    this.lastApprovedEmotion = 'neutral';
    this.lastApprovedType = 'idle';
  }

  arbitrate(input: ArbitrateInput): ArbitrateResult {
    const { proposed, agentSpeaking } = input;
    let p = { ...proposed };

    if (agentSpeaking && p.type === 'idle') {
      return { ok: false, reason: 'reject_idle_while_speaking' };
    }

    if (agentSpeaking && p.type === 'listening' && INTENT_PRIORITY.listening < INTENT_PRIORITY.speaking) {
      return { ok: false, reason: 'reject_listen_while_agent_speaking' };
    }

    let adjusted = clamp01(p.intensity);

    if (this.lastApprovedEmotion === 'focused') {
      adjusted *= 0.7;
    }

    if (p.emotion !== this.lastApprovedEmotion) {
      adjusted *= 0.85;
    }

    if (this.lastApprovedType === 'speaking' && p.type === 'reacting') {
      adjusted = Math.min(adjusted, 0.82);
    }

    const approved: ApprovedIntent = {
      ...p,
      intensity: p.intensity,
      adjustedIntensity: clamp01(adjusted),
      transitionDelay: transitionDelayMs(),
    };

    this.lastApprovedEmotion = approved.emotion;
    this.lastApprovedType = approved.type;

    return { ok: true, approved };
  }
}

function clamp01(n: number): number {
  return Math.max(0, Math.min(1, n));
}
