'use client';

/**
 * Bridges Ultra Tutor (assessment `/api/v1/ultra/session`) to the avatar stack:
 * THINKING while the request is pending, TTS + lip-sync on the explanation, optional
 * Socratic wave/point after speech. Respects {@link isVrmaPlaybackGloballyDisabled} for procedural body motion.
 */

import { speakWithTTS } from '@/ai/io/tts';
import {
  initGestureNormalizer,
  unifiedGestureEngine,
} from '@/ai/cognitive/UnifiedGestureEngine';
import { PRIORITY } from '@/constants/gestures';
import { setCognitiveOrchestratorLLMOutput } from '@/lib/ai/cognitiveOrchestrator';
import { isVrmaPlaybackGloballyDisabled } from '@/lib/avatar/vrmaPlaybackPolicy';
import { INTERNAL_THOUGHT_MOTOR_EVENT } from '@/lib/behavior/internalThoughtLayer';
import { useBrainStore } from '@/store/useBrainStore';
import { stripAvatarPerformanceMarkup } from '@/lib/cleanAssistantDialogue';

let pipelineReady = false;

function ensureGestureNormalizer(): void {
  if (typeof window === 'undefined' || pipelineReady) return;
  initGestureNormalizer();
  pipelineReady = true;
}

function dispatchWindow(name: string, detail: Record<string, unknown>): void {
  if (typeof window === 'undefined') return;
  try {
    window.dispatchEvent(new CustomEvent(name, { detail }));
  } catch {
    /* ignore */
  }
}

/** Encouraging / praise-like Arabic → wave; otherwise point (Socratic nudge). */
export function pickSocraticGestureForExplanation(text: string): 'wave' | 'point' {
  const t = (text || '').trim();
  if (!t) return 'point';
  const waveHints =
    /ممتاز|أحسنت|رائع|يا سلام|منيح|ماشي|تمام|على الطريق|يلّا|تقدر|برافو|ممتازة|حلو|زين|تابع|واصل|شطار|عبقر/i;
  return waveHints.test(t) ? 'wave' : 'point';
}

/**
 * Procedural THINKING: drives `useBrainStore.thinking` → AvatarCanvas `isThinkingRef` (head tilt + breath bump)
 * and behavior speech phase for layers that listen.
 */
export function beginUltraTutorThinkingPhase(): void {
  ensureGestureNormalizer();
  useBrainStore.getState().setThinking(true);
  dispatchWindow('avatar:behavior:speech', { phase: 'pre_speech' });
  dispatchWindow('cogni:ultra:tutor:thinking-start', { at: Date.now() });
  dispatchWindow(INTERNAL_THOUGHT_MOTOR_EVENT, {
    mul: 1.07,
    durationMs: 120_000,
  });
}

export function endUltraTutorThinkingPhase(): void {
  useBrainStore.getState().setThinking(false);
  dispatchWindow('avatar:behavior:speech', { phase: 'agent_end' });
  dispatchWindow('cogni:ultra:tutor:thinking-end', { at: Date.now() });
}

/**
 * Speaks the tutor explanation (TTS → `avatar:speak:*` → LipSyncManager when mounted),
 * logs the turn, and optionally plays a post-utterance Socratic gesture.
 */
export async function deliverUltraTutorExplanationToAvatar(explanation: string): Promise<void> {
  const raw = (explanation || '').trim();
  const text = stripAvatarPerformanceMarkup(raw) || raw;
  if (!text || typeof window === 'undefined') return;

  ensureGestureNormalizer();

  setCognitiveOrchestratorLLMOutput({
    intent: 'explaining',
    tone: 'encouraging',
    intensity: 0.72,
  });

  useBrainStore.getState().pushTurn({
    role: 'assistant',
    text: text.length > 12_000 ? `${text.slice(0, 12_000)}…` : text,
    emotion: 'encouraging',
  });

  dispatchWindow('cogni:ultra:tutor:assistant-text', { text });

  await speakWithTTS(text, {
    emotion: 'encouraging',
    emotionIntensity: 0.85,
    onEnd: () => {
      setCognitiveOrchestratorLLMOutput(null);
      const gesture = pickSocraticGestureForExplanation(text);
      if (isVrmaPlaybackGloballyDisabled()) {
        window.dispatchEvent(
          new CustomEvent('avatar:gesture', {
            detail: {
              gesture,
              type: gesture,
              duration: gesture === 'wave' ? 2.5 : 2.0,
              intensity: 0.78,
              source: 'ultra_tutor_socratic',
            },
          }),
        );
      } else {
        void unifiedGestureEngine.play(gesture, {
          priority: PRIORITY.HIGH,
          behaviorBrain: false,
          humanTiming: false,
        });
      }
    },
  });
}
