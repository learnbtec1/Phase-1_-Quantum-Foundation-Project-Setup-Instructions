/**
 * Phase 6 — Perception & adaptation (DOM ↔ R3F bridge). Deterministic; no RNG.
 */
'use client';

import { create } from 'zustand';
import * as THREE from 'three';

export type PerceptionSnapshot = {
  lastAvatarSpeechEndMs: number;
  userTypingStartMs: number;
  userSubmitMs: number;
  familiarityLevel: number;
  perceivedConfidence: number;
  userEngagement: number;
  lastLatencyMs: number;
  lastTypingSpeed: number;
  lastModHesitationMs: number;
  silenceAccumMs: number;
};

type PerceptionState = PerceptionSnapshot & {
  noteAvatarSpeechEnd: (tMs: number) => void;
  noteUserTypingStart: (tMs: number) => void;
  recordUserSubmit: (messageLength: number, tMs: number) => void;
  tickSilence: (deltaMs: number) => void;
  logPerception: (modHesitationMs: number) => void;
};

const clamp01 = (v: number): number => THREE.MathUtils.clamp(v, 0, 1);

export const usePerceptionStore = create<PerceptionState>((set, get) => ({
  lastAvatarSpeechEndMs: 0,
  userTypingStartMs: 0,
  userSubmitMs: 0,
  familiarityLevel: 0,
  perceivedConfidence: 0.5,
  userEngagement: 0.5,
  lastLatencyMs: 0,
  lastTypingSpeed: 0,
  lastModHesitationMs: 0,
  silenceAccumMs: 0,

  noteAvatarSpeechEnd: (tMs: number) => {
    set({ lastAvatarSpeechEndMs: tMs });
  },

  noteUserTypingStart: (tMs: number) => {
    const s = get();
    if (s.userTypingStartMs <= 0) {
      set({ userTypingStartMs: tMs });
    }
  },

  recordUserSubmit: (messageLength: number, tMs: number) => {
    const s = get();
    const len = Math.max(0, messageLength | 0);
    const submitMs = tMs;
    let typingStart = s.userTypingStartMs;
    if (typingStart <= 0) typingStart = submitMs;
    const typingDur = Math.max(1, submitMs - typingStart);
    const latencyRaw = submitMs - (s.lastAvatarSpeechEndMs || 0);
    const latencyMs = THREE.MathUtils.clamp(latencyRaw, 0, 30000);
    const typingSpeed = len / typingDur;
    const conf = THREE.MathUtils.clamp(
      1 - latencyMs / 10000 + typingSpeed * 0.1,
      0.1,
      1,
    );
    const interactionScore = clamp01(conf);
    const newEng = interactionScore * 0.3 + s.userEngagement * 0.7;
    const fam = clamp01(s.familiarityLevel + 0.05);

    set({
      userSubmitMs: submitMs,
      userTypingStartMs: 0,
      lastLatencyMs: latencyMs,
      lastTypingSpeed: typingSpeed,
      perceivedConfidence: conf,
      userEngagement: clamp01(newEng),
      familiarityLevel: fam,
      silenceAccumMs: 0,
    });
  },

  tickSilence: (deltaMs: number) => {
    if (deltaMs <= 0) return;
    const s = get();
    let acc = s.silenceAccumMs + deltaMs;
    let eng = s.userEngagement;
    while (acc >= 5000) {
      acc -= 5000;
      eng = Math.max(0, eng - 0.01);
    }
    set({ silenceAccumMs: acc, userEngagement: eng });
  },

  logPerception: (modHesitationMs: number) => {
    const st = get();
    set({ lastModHesitationMs: modHesitationMs });
    // eslint-disable-next-line no-console
    console.log(
      `[Perception] Familiarity: ${st.familiarityLevel.toFixed(2)} | Engagement: ${st.userEngagement.toFixed(2)} | Confidence: ${st.perceivedConfidence.toFixed(2)} | Mod_Hesitation: ${Math.round(modHesitationMs)}ms`,
    );
  },
}));

export function getGazeLockStrength(): number {
  const { userEngagement, familiarityLevel } = usePerceptionStore.getState();
  const p = clamp01(userEngagement * familiarityLevel);
  return THREE.MathUtils.lerp(0.3, 1.0, p);
}

export function getPerceptionReactionDelayMul(): number {
  const e = clamp01(usePerceptionStore.getState().userEngagement);
  return THREE.MathUtils.clamp(1.2 - e, 0.25, 1.35);
}

export function getPerceptionStrangerGestureMul(): number {
  return usePerceptionStore.getState().familiarityLevel < 0.3 ? 0.85 : 1;
}

export function getPerceptionBlinkIntervalMul(): number {
  return usePerceptionStore.getState().familiarityLevel < 0.3 ? 1 / 1.2 : 1;
}

export function getPerceptionAttentionSeekingStrength(): number {
  const e = usePerceptionStore.getState().userEngagement;
  if (e >= 0.4) return 0;
  return ((0.4 - e) / 0.4) * THREE.MathUtils.clamp(1 - e, 0, 1);
}
