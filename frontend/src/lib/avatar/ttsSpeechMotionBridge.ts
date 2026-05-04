/**
 * Bridges **client TTS audio start** → **body motion** when WS / provider metadata
 * does not drive gestures (e.g. local Piper BFF). Listens to `avatar:speak:start`
 * (emitted from `speakWithTTS` for all providers — not EL/Edge-specific).
 *
 * Disable entirely: `NEXT_PUBLIC_TTS_SPEECH_VRMA_BRIDGE=0`
 */
'use client';

import {
  isAvatarMotionTraceOn,
  motionTraceLog,
  motionTraceStopAtGuard,
} from '@/lib/avatar/avatarMotionTrace';
import { isDebugMotion, logDebug } from '@/lib/logging/runtimeLog';
import { getUtteranceSemanticIntent } from '@/lib/avatar/speechIntentHints';
import { isVrmaPlaybackGloballyDisabled } from '@/lib/avatar/vrmaPlaybackPolicy';
import { PRIORITY } from '@/constants/gestures';

const ACCENT_VRMA = [
  { path: '/models/animations/Agreeing.vrma', durationMs: 3600 },
  { path: '/models/animations/Acknowledging.vrma', durationMs: 3200 },
] as const;

/** Procedural / micro motions during TTS — avoids looping the same accent clip. */
const SPEECH_MOTION_WEIGHTS = [
  { tag: 'proc:idle_shift', weight: 2 },
  { tag: 'micro:question_tilt', weight: 2 },
  { tag: 'micro:lean_in', weight: 2 },
  { tag: 'micro:chin_up', weight: 2 },
  { tag: 'micro:nod', weight: 2 },
  { tag: 'micro:shrug', weight: 1 },
  { tag: 'vrma:accent', weight: 2 },
] as const;

/** ~32% reduction on TTS-picked micro gestures (see VRMSkeletonManager `amplitudeMul`). */
const TTS_BRIDGE_MICRO_AMPLITUDE_MUL = 0.68;

function pickWeightedSpeechMotionTag(): (typeof SPEECH_MOTION_WEIGHTS)[number]['tag'] {
  const vrmaDisabled = isVrmaPlaybackGloballyDisabled();
  let total = 0;
  for (const row of SPEECH_MOTION_WEIGHTS) {
    if (vrmaDisabled && row.tag === 'vrma:accent') continue;
    total += row.weight;
  }
  let r = Math.random() * total;
  for (const row of SPEECH_MOTION_WEIGHTS) {
    if (vrmaDisabled && row.tag === 'vrma:accent') continue;
    r -= row.weight;
    if (r <= 0) return row.tag;
  }
  return 'proc:idle_shift';
}

function runSpeechMotionPick(tag: (typeof SPEECH_MOTION_WEIGHTS)[number]['tag']): void {
  if (tag === 'vrma:accent' && !isVrmaPlaybackGloballyDisabled()) {
    const pick = ACCENT_VRMA[Math.floor(Math.random() * ACCENT_VRMA.length)]!;
    motionTraceLog('ttsSpeechMotionBridge: dispatch avatar:vrma:play', {
      path: pick.path,
      durationMs: pick.durationMs,
    });
    window.dispatchEvent(
      new CustomEvent('avatar:vrma:play', {
        detail: {
          path: pick.path,
          loop: false,
          durationMs: pick.durationMs,
          vrmaStem: 'tts_speech_accent',
        },
      }),
    );
    return;
  }

  const effective: (typeof SPEECH_MOTION_WEIGHTS)[number]['tag'] =
    tag === 'vrma:accent' ? 'proc:idle_shift' : tag;

  if (effective === 'proc:idle_shift') {
    void import('@/ai/cognitive/UnifiedGestureEngine').then(({ unifiedGestureEngine }) => {
      void unifiedGestureEngine.play('idle_shift', {
        priority: PRIORITY.NORMAL,
        humanTiming: false,
        behaviorBrain: false,
        intensity: 0.68,
      });
    });
    return;
  }

  const kind =
    effective === 'micro:question_tilt'
      ? 'question_tilt'
      : effective === 'micro:lean_in'
        ? 'lean_in'
        : effective === 'micro:chin_up'
          ? 'chin_up'
          : effective === 'micro:shrug'
            ? 'shrug'
            : 'nod';
  const durationMs = 260 + Math.floor(Math.random() * 160);
  window.dispatchEvent(
    new CustomEvent('avatar:micro:gesture', {
      detail: { kind, durationMs, amplitudeMul: TTS_BRIDGE_MICRO_AMPLITUDE_MUL },
    }),
  );
}

function bridgeEnabled(): boolean {
  const v = (process.env.NEXT_PUBLIC_TTS_SPEECH_VRMA_BRIDGE ?? '').trim().toLowerCase();
  return v !== '0' && v !== 'false' && v !== 'off';
}

let attached = false;
let lastFireMs = 0;

export function initTtsSpeechMotionBridge(): void {
  if (typeof window === 'undefined') {
    motionTraceStopAtGuard('bridge-init', 'no window (SSR)', {});
    return;
  }
  if (attached) {
    if (isAvatarMotionTraceOn()) {
      motionTraceLog('ttsSpeechMotionBridge.init: skip (already attached)');
    }
    return;
  }
  attached = true;
  motionTraceLog('ttsSpeechMotionBridge.init: listener attached');

  const onSpeakStart = (ev: Event): void => {
    const detail = (ev as CustomEvent<Record<string, unknown>>).detail;
    motionTraceLog('ttsSpeechMotionBridge: received avatar:speak:start', detail ?? {});

    if (getUtteranceSemanticIntent()) {
      motionTraceLog(
        'ttsSpeechMotionBridge: skip — semantic intent (scheduler drives meaning-motion)',
        {},
      );
      if (isDebugMotion()) {
        logDebug('MOTION', '[MOTION_BLOCKED]', 'tts_bridge_semantic_intent_owned_by_scheduler', {});
      }
      return;
    }

    if (!bridgeEnabled()) {
      motionTraceStopAtGuard(
        'bridge-1',
        'bridge disabled via NEXT_PUBLIC_TTS_SPEECH_VRMA_BRIDGE',
        {
          NEXT_PUBLIC_TTS_SPEECH_VRMA_BRIDGE:
            process.env.NEXT_PUBLIC_TTS_SPEECH_VRMA_BRIDGE ?? '(unset)',
        },
      );
      if (isDebugMotion()) {
        logDebug('MOTION', '[MOTION_BLOCKED]', 'tts_bridge_disabled', {
          NEXT_PUBLIC_TTS_SPEECH_VRMA_BRIDGE:
            process.env.NEXT_PUBLIC_TTS_SPEECH_VRMA_BRIDGE ?? '(unset)',
        });
      }
      return;
    }
    const now = typeof performance !== 'undefined' ? performance.now() : Date.now();
    if (now - lastFireMs < 450) {
      motionTraceStopAtGuard('bridge-2', 'debounce (last fire <450ms ago)', {
        msSinceLast: now - lastFireMs,
      });
      if (isDebugMotion()) {
        logDebug('MOTION', '[MOTION_BLOCKED]', 'tts_bridge_debounce', {
          msSinceLast: now - lastFireMs,
        });
      }
      return;
    }
    lastFireMs = now;

    const tag = pickWeightedSpeechMotionTag();
    if (isDebugMotion()) {
      logDebug('MOTION', '[MOTION_SELECTED]', { primitive: `ttsBridge:${tag}`, tag });
    }
    motionTraceLog('ttsSpeechMotionBridge: motion variety', { tag });
    runSpeechMotionPick(tag);
  };

  window.addEventListener('avatar:speak:start', onSpeakStart);
}
