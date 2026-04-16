/**
 * Phase 3 — strict behavior execution contract (Brain → gesture → motion → audio).
 */
'use client';

import { nowMs, sessionElapsedSec } from '@/lib/avatar/masterClock';
import { useBrainStore } from '@/store/useBrainStore';
import { sanitizeVrmaStem, vrmaUrl, sanitizeVrmaAssetUrl } from '@/constants/gestures';
import { computeGazeOffsetEulerWithAttention } from '@/lib/avatar/gazeExecutionContract';
import { getConsciousState } from '@/lib/avatar/consciousStateManager';
import { blendMotionLayers } from '@/lib/avatar/motionBlendContract';
import type { BrainStatePayload } from '@/lib/avatar/brainStatePayload';
import {
  CONTRACT_LOGICAL_ID_TO_VRMA_STEM,
  GestureMap,
  type AvatarFsmState,
} from '@/lib/avatar/brainStatePayload';
import {
  beginAnticipationPhase,
  cancelAnticipationPhase,
  preActionDelayMs,
} from '@/lib/avatar/humanizationController';
import { getPerceptionReactionDelayMul } from '@/store/usePerceptionStore';
import {
  applyBrainPayloadConscious,
} from '@/lib/avatar/consciousStateManager';

export type { BrainStatePayload, AvatarFsmState };
export { GestureMap, CONTRACT_LOGICAL_ID_TO_VRMA_STEM };

const roundRobin: Record<string, number> = {};

function nextVariantIndex(key: string, len: number): number {
  const i = roundRobin[key] ?? 0;
  roundRobin[key] = (i + 1) % Math.max(1, len);
  return i;
}

export function selectGestureClipId(intent: BrainStatePayload['intent']): string {
  const arr = GestureMap[intent];
  const idx = nextVariantIndex(intent, arr.length);
  return arr[idx];
}

export function resolveVrmaStemFromClipId(clipId: string): string {
  return sanitizeVrmaStem(CONTRACT_LOGICAL_ID_TO_VRMA_STEM[clipId] ?? 'Idle1');
}

export function transitionDurationSec(urgency: number): number {
  const u = Math.max(0, Math.min(1, urgency));
  return 0.4 - u * 0.2;
}

let fsm: AvatarFsmState = 'IDLE';
let _anticipationGen = 0;
let _anticipationTimer: ReturnType<typeof setTimeout> | null = null;
let _speakingGenTimer: ReturnType<typeof setTimeout> | null = null;
let _microGazeTimer: ReturnType<typeof setTimeout> | null = null;

export function getAvatarFsmState(): AvatarFsmState {
  return fsm;
}

function dispatchVrmaPlay(args: {
  stem: string;
  durationMs: number;
  loop: boolean;
  urgency: number;
  clipId: string;
  cognitiveLoad: number;
}): void {
  if (typeof window === 'undefined') return;
  const stem = sanitizeVrmaStem(args.stem);
  const url = sanitizeVrmaAssetUrl(vrmaUrl(stem));
  window.dispatchEvent(
    new CustomEvent('avatar:vrma:play', {
      detail: {
        url,
        durationMs: Math.max(0, args.durationMs),
        loop: args.loop,
        vrmaStem: stem,
        urgency: args.urgency,
        cognitiveLoad: args.cognitiveLoad,
      },
    }),
  );
}

export function applyBrainStatePayload(
  payload: BrainStatePayload,
  opts?: { onFsmSpeakingScheduled?: () => void },
): void {
  const t0 = nowMs();
  console.log('[Pipeline] Brain → Gesture → Motion → Audio');

  const prev = fsm;
  if (prev === 'IDLE' || prev === 'LISTENING') {
    fsm = 'THINKING';
    console.log(`[BrainState] ${prev} → THINKING (delay: 0 ms)`);
  } else {
    fsm = 'THINKING';
  }

  cancelAnticipationPhase();
  if (_anticipationTimer !== null) {
    clearTimeout(_anticipationTimer);
    _anticipationTimer = null;
  }
  if (_microGazeTimer !== null) {
    clearTimeout(_microGazeTimer);
    _microGazeTimer = null;
  }
  if (_speakingGenTimer !== null) {
    clearTimeout(_speakingGenTimer);
    _speakingGenTimer = null;
  }
  _anticipationGen += 1;
  const gen = _anticipationGen;

  useBrainStore.getState().setBehaviorContractPayload(payload);

  const clipId = selectGestureClipId(payload.intent);
  const stem = resolveVrmaStemFromClipId(clipId);
  const fadeMs = Math.round(transitionDurationSec(payload.urgency) * 1000);
  console.log(`[Animation] Crossfade to "${clipId}" (${fadeMs} ms)`);

  const visCount =
    payload.visemeCueCount ?? Math.max(1, Math.floor(payload.durationMs / 60));
  const { cognitiveLoad, hesitationMs } = applyBrainPayloadConscious(payload, visCount);

  const preMs =
    preActionDelayMs(payload.urgency) * getPerceptionReactionDelayMul();
  const totalPreGestureMs = preMs + hesitationMs;
  const gaze = computeGazeOffsetEulerWithAttention(
    payload,
    getConsciousState().engagement,
    sessionElapsedSec(),
  );
  if (typeof window !== 'undefined') {
    window.dispatchEvent(
      new CustomEvent('avatar:gaze', {
        detail: {
          yaw: gaze.yaw,
          pitch: gaze.pitch,
          durationMs: 200 + Math.round(payload.personality.calmness * 200),
        },
      }),
    );
    beginAnticipationPhase(totalPreGestureMs, 0.018);
    _microGazeTimer = setTimeout(() => {
      if (gen !== _anticipationGen) return;
      window.dispatchEvent(
        new CustomEvent('avatar:gaze', {
          detail: {
            yaw: 0.014,
            pitch: -0.052,
            durationMs: Math.min(180, hesitationMs),
          },
        }),
      );
      window.dispatchEvent(
        new CustomEvent('cogni:conscious:micro', { detail: { phase: 'hesitation' } }),
      );
      _microGazeTimer = null;
    }, preMs);
    _anticipationTimer = setTimeout(() => {
      if (gen !== _anticipationGen) return;
      dispatchVrmaPlay({
        stem,
        durationMs: payload.durationMs,
        loop: payload.intent === 'listening',
        urgency: payload.urgency,
        clipId,
        cognitiveLoad,
      });
      _anticipationTimer = null;
    }, totalPreGestureMs);
  }

  const motion = blendMotionLayers({
    intent: payload.intent,
    urgency: payload.urgency,
    personality: payload.personality,
    sessionPhase: sessionElapsedSec(),
  });
  const ampScale = 1 - cognitiveLoad * 0.35;
  useBrainStore.getState().setBehaviorMotionBlend({
    ...motion,
    amplitude: motion.amplitude * ampScale,
  });

  const delayThinkingToSpeaking = 150;
  void t0;
  if (typeof window !== 'undefined') {
    _speakingGenTimer = setTimeout(() => {
      if (gen !== _anticipationGen) return;
      fsm = 'SPEAKING';
      console.log(
        `[BrainState] THINKING → SPEAKING (delay: ${totalPreGestureMs + delayThinkingToSpeaking} ms)`,
      );
      opts?.onFsmSpeakingScheduled?.();
      _speakingGenTimer = null;
    }, totalPreGestureMs + delayThinkingToSpeaking);
  }
}

export function transitionFsmToListening(): void {
  const prev = fsm;
  fsm = 'LISTENING';
  console.log(`[BrainState] ${prev} → LISTENING (delay: 0 ms)`);
  console.log('[Pipeline] Brain → Motion → Audio');
}

export function resetFsmIdle(): void {
  const prev = fsm;
  fsm = 'IDLE';
  console.log(`[BrainState] ${prev} → IDLE (delay: 0 ms)`);
}

export function logTimingTriple(audioTime: number): void {
  console.log(JSON.stringify({
    brainTime: nowMs(),
    motionTime: sessionElapsedSec(),
    audioTime,
  }));
}
