/**
 * Meaning-driven motion while speaking: maps utterance semantic intent → gestures,
 * scaled by speech-drive energy (blend with audio), with per-tick randomness.
 */
'use client';

import { getAvatarOrchestratorState } from '@/lib/avatar/avatarOrchestratorState';
import { getCogniPersonaPerformanceScales } from '@/lib/avatar/cogniPersonaStance';
import type { UtteranceSemanticIntent } from '@/lib/avatar/speechIntentHints';
import { getSpeechDriveSnapshot } from '@/lib/avatar/speechDriveState';
import { isVrmaPlaybackGloballyDisabled } from '@/lib/avatar/vrmaPlaybackPolicy';
import { PRIORITY, type PriorityValue } from '@/constants/gestures';
import { useBrainStore } from '@/store/useBrainStore';

type PlayFn = (
  name: string,
  opts?: {
    priority?: PriorityValue;
    durationMs?: number;
    intensity?: number;
    humanTiming?: boolean;
    behaviorBrain?: boolean;
  },
) => Promise<void>;

function motionBlend01(): number {
  const speaking =
    useBrainStore.getState().talking || getAvatarOrchestratorState().speaking;
  const snap = getSpeechDriveSnapshot(speaking);
  return Math.min(
    1,
    0.26
      + 0.74
        * Math.max(snap.energy, snap.syllablePulse * 0.62, speaking ? 0.18 : 0),
  );
}

function durJitter(): number {
  return 0.88 + Math.random() * 0.34;
}

/**
 * Dispatch one semantic motion beat (scheduler or tooling). `play` is UnifiedGestureEngine.play.
 */
export function dispatchUtteranceSemanticMotion(
  intent: UtteranceSemanticIntent,
  play: PlayFn,
): void {
  if (typeof window === 'undefined') return;
  const persona = getCogniPersonaPerformanceScales();
  const b = motionBlend01();
  const gMul = persona.semanticGestureMul;
  const j = durJitter();

  switch (intent) {
    case 'question': {
      const kind = Math.random() > 0.35 ? 'question_tilt' : 'chin_up';
      const durationMs = Math.round(
        (420 + Math.random() * 260) * j * (0.65 + 0.55 * b) * gMul,
      );
      window.dispatchEvent(
        new CustomEvent('avatar:micro:gesture', {
          detail: { kind, durationMs: Math.max(220, durationMs) },
        }),
      );
      break;
    }
    case 'explain': {
      const useWave = Math.random() > 0.45;
      const gestureName = useWave ? 'wave' : 'explain';
      const durationMs = Math.round(
        (1900 + Math.random() * 900) * j * (0.72 + 0.38 * b),
      );
      const intensity = Math.min(
        0.98,
        (0.52 + Math.random() * 0.28) * (0.55 + 0.45 * b) * gMul,
      );
      if (!isVrmaPlaybackGloballyDisabled()) {
        void play(gestureName, {
          priority: PRIORITY.NORMAL,
          durationMs: Math.max(720, Math.min(3400, durationMs)),
          intensity: Math.max(0.12, intensity),
          humanTiming: false,
          behaviorBrain: false,
        });
      } else {
        window.dispatchEvent(
          new CustomEvent('avatar:gesture', {
            detail: {
              gesture: gestureName,
              type: gestureName,
              durationMs: Math.max(720, Math.min(3200, durationMs)),
              intensity: Math.max(0.12, intensity),
              mood: 'neutral',
            },
          }),
        );
      }
      break;
    }
    case 'emphasize': {
      const nodInt = (0.13 + Math.random() * 0.12) * (0.45 + 0.55 * b) * gMul;
      const durSec = 0.32 + Math.random() * 0.22;
      window.dispatchEvent(
        new CustomEvent('avatar:nod', {
          detail: {
            intensity: Math.max(0.07, nodInt),
            duration: durSec,
          },
        }),
      );
      if (Math.random() > 0.55) {
        window.dispatchEvent(
          new CustomEvent('avatar:micro:gesture', {
            detail: {
              kind: 'eyebrow',
              durationMs: Math.round((280 + Math.random() * 160) * j * gMul),
            },
          }),
        );
      }
      break;
    }
    case 'thinking': {
      const sign = Math.random() > 0.5 ? 1 : -1;
      const yaw = sign * (0.1 + Math.random() * 0.12) * (0.55 + 0.45 * b) * gMul;
      const pitch = (-0.04 - Math.random() * 0.07) * Math.min(1.15, gMul);
      window.dispatchEvent(
        new CustomEvent('avatar:gaze', {
          detail: {
            yaw,
            pitch,
            durationMs: Math.round((820 + Math.random() * 700) * j * Math.min(1.2, 0.85 + 0.15 * gMul)),
          },
        }),
      );
      window.dispatchEvent(
        new CustomEvent('avatar:headpose', {
          detail: {
            yaw: sign * 0.05 * (0.5 + 0.5 * b) * gMul,
            pitch,
            durationMs: Math.round((900 + Math.random() * 600) * j * Math.min(1.15, 0.82 + 0.18 * gMul)),
          },
        }),
      );
      break;
    }
    default:
      break;
  }
}
