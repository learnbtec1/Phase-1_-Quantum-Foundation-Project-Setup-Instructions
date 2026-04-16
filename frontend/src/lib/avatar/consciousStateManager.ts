/**
 * Phase 5 — deterministic cognitive illusion (between BrainState intent and humanization execution).
 */
'use client';

import * as THREE from 'three';
import { nowMs } from '@/lib/avatar/masterClock';
import { deterministicNoiseVector3 } from '@/lib/avatar/deterministicNoiseController';
import type { BrainStatePayload } from '@/lib/avatar/brainStatePayload';
import { usePerceptionStore } from '@/store/usePerceptionStore';

export type ConsciousState = {
  cognitiveLoad: number;
  hesitationMs: number;
  engagement: number;
  attentionDrift: THREE.Vector3;
  lastIntentTimeMs: number;
};

const _state: ConsciousState = {
  cognitiveLoad: 0,
  hesitationMs: 0,
  engagement: 1,
  attentionDrift: new THREE.Vector3(),
  lastIntentTimeMs: 0,
};

export function getConsciousState(): Readonly<ConsciousState> {
  return _state;
}

export function computeCognitiveLoad(urgency: number, visemeCount: number): number {
  const u = THREE.MathUtils.clamp(urgency, 0, 1);
  const n = Math.max(0, visemeCount);
  return THREE.MathUtils.clamp(1 - u + n * 0.01, 0, 1);
}

export function computeHesitationMs(cognitiveLoad: number): number {
  const c = THREE.MathUtils.clamp(cognitiveLoad, 0, 1);
  return (80 + c * 220) | 0;
}

function applyPerceptionToLoad(baseLoad: number): number {
  const conf = THREE.MathUtils.clamp(usePerceptionStore.getState().perceivedConfidence, 0, 1);
  return THREE.MathUtils.clamp(baseLoad * (1 - conf * 0.2), 0, 1);
}

function applyPerceptionToHesitation(baseHesitationMs: number): number {
  const fam = THREE.MathUtils.clamp(usePerceptionStore.getState().familiarityLevel, 0, 1);
  return baseHesitationMs * (1 - fam);
}

export function logCognitive(
  intent: string,
  load: number,
  hesitation: number,
  engagement: number,
): void {
  // eslint-disable-next-line no-console
  console.log(
    `[Cognitive] Intent: ${intent} | Load: ${load.toFixed(2)} | Hesitation: ${hesitation}ms | Engagement: ${engagement.toFixed(2)}`,
  );
}

export function applyBrainPayloadConscious(
  payload: BrainStatePayload,
  visemeCueCount: number,
): { cognitiveLoad: number; hesitationMs: number } {
  const rawLoad = computeCognitiveLoad(payload.urgency, visemeCueCount);
  const load = applyPerceptionToLoad(rawLoad);
  const baseHes = computeHesitationMs(load);
  const hes = applyPerceptionToHesitation(baseHes);
  _state.cognitiveLoad = load;
  _state.hesitationMs = hes;
  _state.lastIntentTimeMs = nowMs();
  logCognitive(payload.intent, load, hes, _state.engagement);
  usePerceptionStore.getState().logPerception(hes);
  return { cognitiveLoad: load, hesitationMs: hes };
}

export function updateConsciousFromTts(urgency: number, visemeCount: number): void {
  const rawLoad = computeCognitiveLoad(urgency, visemeCount);
  const load = applyPerceptionToLoad(rawLoad);
  const baseHes = computeHesitationMs(load);
  const hes = applyPerceptionToHesitation(baseHes);
  _state.cognitiveLoad = load;
  _state.hesitationMs = hes;
  _state.lastIntentTimeMs = nowMs();
  logCognitive('tts', load, hes, _state.engagement);
  usePerceptionStore.getState().logPerception(hes);
}

export function getConsciousHesitationMs(): number {
  return _state.hesitationMs;
}

export function getTotalPreSpeechDelayMs(baseLeadMs: number): number {
  return baseLeadMs + _state.hesitationMs;
}

export function getCognitiveGestureAmplitudeScale(): number {
  return THREE.MathUtils.clamp(1 - _state.cognitiveLoad * 0.35, 0.35, 1);
}

export function setEngagementFull(): void {
  _state.engagement = 1;
  _state.attentionDrift.set(0, 0, 0);
}

export function tickEngagement(args: {
  delta: number;
  speaking: boolean;
  listening: boolean;
  thinking: boolean;
}): void {
  if (args.speaking || args.listening) {
    setEngagementFull();
    return;
  }
  _state.engagement = THREE.MathUtils.clamp(_state.engagement - args.delta * 0.05, 0.2, 1);
  const t = nowMs() / 1000;
  const n = deterministicNoiseVector3(t, 0.012);
  _state.attentionDrift.set(n.x, n.y, n.z);
}

export function getAttentionDriftEulerAdd(tSec: number): { yaw: number; pitch: number } {
  const eng = _state.engagement;
  const s = 1 - eng;
  const n = deterministicNoiseVector3(tSec, 0.012);
  return {
    yaw: n.x * s * 0.15,
    pitch: n.y * s * 0.12,
  };
}

export function getCognitiveCrossfadeScale(): number {
  return 1 + _state.cognitiveLoad * 0.6;
}
