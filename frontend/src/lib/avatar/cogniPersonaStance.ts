/**
 * Cogni teaching performance modes — **pedagogical intent + emotion** + dynamic energy.
 *
 * Priority: `error` | `correction` | `success` from frame/heuristics → stance;
 * else `mapEmotionToPersona`; fallback interactive_assistant.
 *
 * Multipliers scale by **smoothed unified energy** (brain + behavior intensity + audio).
 */
'use client';

import type { AgentFrame, PersonaPedagogicalIntent } from '@/types/ai';
import { useBrainStore } from '@/store/useBrainStore';
import { getSmoothedUnifiedEnergy } from '@/lib/avatar/unifiedEnergyModel';
import {
  getAwarenessModulators,
  getAwarenessPersonaBias,
  registerSuccess as awarenessRegisterSuccess,
  registerError   as awarenessRegisterError,
} from '@/lib/avatar/awareness/studentAwarenessEngine';

export type CogniTeachingStance =
  | 'interactive_assistant'
  | 'formal_instructor'
  | 'charismatic_celebrate';

export type { PersonaPedagogicalIntent };

const DEFAULT_DECAY_MS = 11_000;

let stance: CogniTeachingStance = 'interactive_assistant';
let stanceUntilMs = 0;

let lastPedagogical: PersonaPedagogicalIntent = 'neutral';
let lastAvatarEmotion = 'neutral';
let lastAvatarEmotionStrength = 0.55;
let lastInteractionIntent = 'idle';

let listenersAttached = false;

function perfNow(): number {
  return typeof performance !== 'undefined' ? performance.now() : Date.now();
}

function clamp(x: number, a: number, b: number): number {
  return Math.min(b, Math.max(a, x));
}

function decayStanceIfStale(): void {
  if (perfNow() >= stanceUntilMs && stance !== 'interactive_assistant') {
    stance = 'interactive_assistant';
  }
}

export function getCogniTeachingStance(): CogniTeachingStance {
  decayStanceIfStale();
  // Awareness is a MODULATOR, not an override. The stance string is owned by
  // emotion + pedagogy resolution. Awareness only adjusts the resulting scalars
  // in `getCogniPersonaPerformanceScales`. A *soft* bias may steer stance
  // selection only when the normal pipeline is in `interactive_assistant`
  // (i.e. neither emotion nor pedagogy gave a strong signal).
  if (stance === 'interactive_assistant') {
    const bias = getAwarenessPersonaBias();
    if (bias === 'soften')   return 'formal_instructor';
    if (bias === 'amplify')  return 'charismatic_celebrate';
    // 'attention' bias → keep interactive_assistant; awareness intensity mul
    // boosts amplitude on its own (no stance change needed).
  }
  return stance;
}

/** 0.35–1 — smoothed unified energy with safe floor (before first tick matches brain). */
function behaviorEnergy01(): number {
  try {
    const u = getSmoothedUnifiedEnergy();
    if (typeof u === 'number' && Number.isFinite(u) && u > 0.02) {
      return clamp(u, 0.35, 1);
    }
    const s = useBrainStore.getState();
    const e =
      typeof s.intentEnergy === 'number' && Number.isFinite(s.intentEnergy)
        ? s.intentEnergy
        : typeof s.avatarBehavior?.energy === 'number'
          ? s.avatarBehavior.energy
          : 0.55;
    return clamp(e, 0.35, 1);
  } catch {
    return 0.62;
  }
}

type StanceBases = {
  proceduralIntensityMul: number;
  proceduralAudioCoeffMul: number;
  neckSway: boolean;
  semanticGestureMul: number;
  voiceRateMul: number;
};

function basesForStance(s: CogniTeachingStance): StanceBases {
  switch (s) {
    case 'formal_instructor':
      return {
        proceduralIntensityMul: 0.88,
        proceduralAudioCoeffMul: 0.52,
        neckSway: false,
        semanticGestureMul: 0.74,
        voiceRateMul: 0.93,
      };
    case 'charismatic_celebrate':
      return {
        proceduralIntensityMul: 1.38,
        proceduralAudioCoeffMul: 1.08,
        neckSway: true,
        semanticGestureMul: 1.22,
        voiceRateMul: 1.06,
      };
    default:
      return {
        proceduralIntensityMul: 1,
        proceduralAudioCoeffMul: 1,
        neckSway: true,
        semanticGestureMul: 1,
        voiceRateMul: 1,
      };
  }
}

/**
 * Motion + voice scalars — **static stance bases × behavior.energy**, clamped.
 */
export function getCogniPersonaPerformanceScales(): {
  stance: CogniTeachingStance;
  proceduralIntensityMul: number;
  proceduralAudioCoeffMul: number;
  neckSway: boolean;
  semanticGestureMul: number;
  voiceRateMul: number;
} {
  decayStanceIfStale();
  const s = stance;
  const e = behaviorEnergy01();
  const b = basesForStance(s);

  // Awareness MODULATORS layer on top of stance bases.
  // Single-call accessor avoids per-frame function-call overhead.
  const aware = getAwarenessModulators();

  const proceduralIntensityMul  = clamp(b.proceduralIntensityMul  * e * aware.intensityMul, 0.55, 1.65);
  const proceduralAudioCoeffMul = clamp(b.proceduralAudioCoeffMul * e * aware.intensityMul, 0.36, 1.28);
  const semanticGestureMul      = clamp(b.semanticGestureMul      * e * aware.intensityMul, 0.42, 1.52);
  const voiceRateMul            = clamp(
    b.voiceRateMul * (0.97 + 0.06 * (e - 0.5)) * aware.voiceRateMul,
    0.82, 1.14,
  );

  return {
    stance: s,
    proceduralIntensityMul,
    proceduralAudioCoeffMul,
    neckSway: b.neckSway,
    semanticGestureMul,
    voiceRateMul,
  };
}

function mapEmotionToPersona(emotionRaw: string, strength: number): void {
  const em = emotionRaw.trim().toLowerCase();
  const st = Math.min(1, Math.max(0, strength));
  const baseMs = DEFAULT_DECAY_MS + Math.round(st * 4200);

  const formal =
    em === 'concerned'
    || em === 'anxious'
    || em === 'confused'
    || em === 'angry'
    || em === 'strict'
    || em === 'serious'
    || (em === 'surprised' && st >= 0.55)
    || (em === 'attentive' && st >= 0.68)
    || (em === 'thinking' && st >= 0.62)
    || (em === 'sad' && st >= 0.5);

  const celebrate =
    em === 'excited'
    || em === 'happy'
    || em === 'proud'
    || em === 'celebrate'
    || em === 'celebrating'
    || (em === 'encouraging' && st >= 0.48)
    || (em === 'surprised' && st < 0.55 && st >= 0.35);

  if (formal) {
    stance = 'formal_instructor';
    stanceUntilMs = perfNow() + Math.round(baseMs * 0.95);
    return;
  }
  if (celebrate) {
    stance = 'charismatic_celebrate';
    stanceUntilMs = perfNow() + Math.round(baseMs * 1.05);
    return;
  }

  if (
    em === 'neutral'
    || em === 'calm'
    || em === 'curious'
    || em === 'empathetic'
    || em === 'relaxed'
    || em === 'friendly'
    || em === 'encouraging'
    || em === 'bored'
    || em === 'sleepy'
  ) {
    stance = 'interactive_assistant';
    stanceUntilMs = perfNow() + Math.round(5000 + st * 2000);
    return;
  }

  stance = 'interactive_assistant';
  stanceUntilMs = perfNow() + Math.round(4200 + st * 1800);
}

function applyPersonaResolution(): void {
  const p = lastPedagogical;
  const st = lastAvatarEmotionStrength;
  const baseMs = DEFAULT_DECAY_MS + Math.round(st * 4000);

  if (p === 'error' || p === 'correction') {
    stance = 'formal_instructor';
    stanceUntilMs = perfNow() + Math.round(baseMs * 0.92);
    return;
  }
  if (p === 'success') {
    stance = 'charismatic_celebrate';
    stanceUntilMs = perfNow() + Math.round(baseMs * 1.08);
    return;
  }

  mapEmotionToPersona(lastAvatarEmotion, lastAvatarEmotionStrength);
}

export function derivePedagogicalFromFrame(frame: AgentFrame): PersonaPedagogicalIntent {
  const explicit = frame.pedagogical_intent;
  if (
    explicit === 'error'
    || explicit === 'correction'
    || explicit === 'success'
    || explicit === 'neutral'
  ) {
    return explicit;
  }

  const t = (frame.text ?? '').replace(/\s+/g, ' ').trim();
  const low = t.toLowerCase();
  const student = (frame.awareness_cues?.student_state ?? '').toLowerCase();

  const successText =
    /أحسنت|أحسنتَ|أحسنتِ|ممتاز|رائع|عظيم|مبروك|إجابة صحيحة|\bصح\b|مظبوط|برافو|استمر|ممتازة/i.test(t)
    || /\b(well done|great job|excellent|correct|that's right|that's correct|perfect|congrats|congratulations|nice work)\b/i.test(
      low,
    );

  const errorText =
    /خطأ|غلط|ليس صحيح|ليس صحيحا|غير صحيح|حاول مجددا|جرّب مرة|انتبه|لاحظ أن/i.test(t)
    || /\b(wrong|incorrect|not quite|try again|that's not|mistake|unfortunately|not correct)\b/i.test(
      low,
    );

  const correctionText =
    /صحح|تصحيح|بالضبط|الصياغة|بالشكل الصحيح|الأفضل أن/i.test(t)
    || /\b(correction|let me clarify|the right answer|actually)\b/i.test(low);

  const successCue =
    /engaged|correct|success|excellent|praise|mastered|distinction|on.?track/i.test(student);
  const errorCue =
    /confused|struggling|wrong|incorrect|lost|frustrated|error|failing|stuck/i.test(student);

  if (successText || successCue) return 'success';
  if (correctionText || /correction|hint/i.test(student)) return 'correction';
  if (errorText || errorCue) return 'error';
  return 'neutral';
}

/** Call from `useBrainStore.processFrame` when a new agent line arrives. */
export function ingestPedagogicalFromAgentFrame(frame: AgentFrame): void {
  const next = derivePedagogicalFromFrame(frame);
  const prev = lastPedagogical;
  lastPedagogical = next;
  // Forward to Awareness Layer ONCE per pedagogical transition (no double counting).
  if (next !== prev) {
    if (next === 'success') {
      awarenessRegisterSuccess();
    } else if (next === 'error' || next === 'correction') {
      awarenessRegisterError();
    }
    stanceUntilMs = perfNow();
    applyPersonaResolution();
    return;
  }
  if (next !== 'neutral') {
    applyPersonaResolution();
  }
}

/** Call when smoothed interaction intent changes — clears persona lag. */
export function notifyBrainInteractionIntentChanged(intent: string): void {
  if (intent === lastInteractionIntent) return;
  lastInteractionIntent = intent;
  stanceUntilMs = perfNow();
  applyPersonaResolution();
}

/** End of TTS utterance — drop stale hold so the next line / emotion applies immediately. */
export function unlockPersonaAfterSpeechEnd(): void {
  stanceUntilMs = perfNow();
  applyPersonaResolution();
}

export function initCogniPersonaStanceListeners(): void {
  if (typeof window === 'undefined' || listenersAttached) return;
  listenersAttached = true;

  window.addEventListener('avatar:emotion', ((ev: Event) => {
    if (!(ev instanceof CustomEvent)) return;
    const d = ev.detail as { emotion?: string; strength?: number } | undefined;
    if (!d || typeof d.emotion !== 'string') return;
    const str =
      typeof d.strength === 'number' && Number.isFinite(d.strength) ? d.strength : 0.58;
    lastAvatarEmotion = d.emotion;
    lastAvatarEmotionStrength = str;
    stanceUntilMs = perfNow();
    applyPersonaResolution();
  }) as EventListener);

  window.addEventListener('avatar:speak:end', () => {
    unlockPersonaAfterSpeechEnd();
  });
}
