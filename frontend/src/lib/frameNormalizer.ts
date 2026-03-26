/**
 * FrameNormalizer — V20 embodiment-first WS frame parsing.
 * Strict guards: never throws; malformed frames → safe defaults.
 */

import type { EmotionLabel, PADVector, AgentFrame } from '@/types/ai';

export interface NormalizedSpeechFrame {
  emotionRaw: string;
  actionRaw: string;
  dialogue: string;
  emotionLabel: EmotionLabel;
  userPad?: PADVector;
}

const EMOTION_TO_LABEL: Record<string, EmotionLabel> = {
  neutral: 'neutral',
  friendly: 'calm',
  thinking: 'thinking',
  encouraging: 'encouraging',
  celebrate: 'excited',
  celebration: 'excited',
  happy: 'happy',
  excited: 'excited',
  sad: 'sad',
  angry: 'angry',
  surprised: 'surprised',
  relax: 'relaxed',
  relaxed: 'relaxed',
  calm: 'calm',
  strict: 'attentive',
  strictEvaluation: 'attentive',
  proud: 'proud',
  curious: 'curious',
  attentive: 'attentive',
  concerned: 'concerned',
  sleepy: 'sleepy',
  bored: 'bored',
  anxious: 'anxious',
  empathetic: 'empathetic',
};

function parseUserPad(raw: unknown): PADVector | undefined {
  if (!raw || typeof raw !== 'object') return undefined;
  const o = raw as Record<string, unknown>;
  const pleasure = Number(o.pleasure);
  const arousal = Number(o.arousal);
  const dominance = Number(o.dominance);
  if (![pleasure, arousal, dominance].every((n) => Number.isFinite(n))) return undefined;
  const clamp = (x: number) => Math.max(-1, Math.min(1, x));
  return { pleasure: clamp(pleasure), arousal: clamp(arousal), dominance: clamp(dominance) };
}

/**
 * Normalize a `speech` / `tts_unavailable` WS payload for immediate embodiment updates.
 * Returns null if there is no speakable dialogue (caller should skip).
 */
export function normalizeSpeechFrame(raw: unknown): NormalizedSpeechFrame | null {
  if (!raw || typeof raw !== 'object') return null;
  const frame = raw as Record<string, unknown>;
  const dialogueRaw = frame.dialogue ?? frame.text;
  const dialogue = typeof dialogueRaw === 'string' ? dialogueRaw.trim() : '';
  if (!dialogue) return null;

  const em = frame.emotion ?? frame.Emotion;
  const emotionRaw = typeof em === 'string' && em.trim() ? em.trim() : 'neutral';
  const ac = frame.action ?? frame.gesture;
  const actionRaw = typeof ac === 'string' ? ac.trim() : '';

  const emotionLabel = EMOTION_TO_LABEL[emotionRaw] ?? 'neutral';
  const userPad = parseUserPad(frame.user_pad ?? frame.userPad);

  return {
    emotionRaw,
    actionRaw,
    dialogue,
    emotionLabel,
    ...(userPad ? { userPad } : {}),
  };
}

/** Build AgentFrame from normalized + raw WS extras (optional viseme / audio meta). */
export function toAgentFrame(
  n: NormalizedSpeechFrame,
  raw: Record<string, unknown>,
): AgentFrame {
  const thinkingMs = raw.thinking_ms;
  const speechRate = raw.speech_rate;
  return {
    text: n.dialogue,
    emotion: n.emotionRaw,
    gesture: n.actionRaw,
    gesture_duration_ms: 4000,
    expression: n.emotionRaw,
    voice: {
      pitch: 0,
      rate: typeof speechRate === 'number' ? speechRate : 1.0,
    },
    thinking_time_ms: typeof thinkingMs === 'number' ? thinkingMs : 400,
    ...(n.userPad ? { user_pad: n.userPad } : {}),
  };
}
