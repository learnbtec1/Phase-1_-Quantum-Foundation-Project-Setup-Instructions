/**
 * Normalizes assistant lines before Edge TTS + embodiment: strips performance markup,
 * extracts optional [POSE:…] for cognitive motion intent, and [GESTURE:…] for co-speech cues.
 */
import { stripAvatarPerformanceMarkup } from '@/lib/cleanAssistantDialogue';
import type { CognitiveIntentHint } from '@/lib/ai/cognitiveOrchestrator';
import type { PerformanceCue } from '@/ai/avatar/performanceTags';

const _GESTURE_TOKEN_MAP: Record<string, string> = {
  wave: 'wave',
  waving: 'wave',
  think: 'think',
  thinking: 'think',
  point: 'point',
  pointing: 'point',
  beckon: 'beckon',
  beckoning: 'beckon',
  agree: 'agree',
  agreeing: 'agree',
  nod: 'ack',
  clap: 'clap',
  clapping: 'clap',
  cheer: 'cheer',
  celebrate: 'cheer',
  relax: 'relax',
  look: 'look',
  goodbye: 'goodbye',
  bye: 'goodbye',
  explain: 'think',
  encourage: 'ack',
  question: 'think',
  greet: 'wave',
  salute: 'wave',
  shrug: 'relax',
  peace: 'peace',
  sad: 'sad',
  angry: 'angry',
  surprise: 'surprise',
  surprised: 'surprise',
  blush: 'blush',
  sleepy: 'sleepy',
};

function mapPoseToken(raw: string): CognitiveIntentHint | null {
  const k = raw.trim().toLowerCase();
  if (!k) return null;
  if (/^(think|thinking|ponder)$/.test(k)) return 'thinking';
  if (/^(explain|explaining|teach)$/.test(k)) return 'explaining';
  if (/^(listen|listening|attend)$/.test(k)) return 'listening';
  return null;
}

export type PreparedAssistantSpeechText = {
  /** Safe for `/api/tts-with-timing` and viseme alignment — no [wave] / [POSE:] leakage. */
  ttsText: string;
  /** First explicit [POSE:…] in the string wins for the utterance (while agent speaks). */
  utterancePoseIntent: CognitiveIntentHint | null;
  /** Colon-form gestures only; bracket [wave] cues stay on the raw line for useAgentAgent. */
  colonGestureCues: PerformanceCue[];
};

/**
 * Single choke point before HTTP TTS: removes markup and captures director hints.
 */
export function prepareAssistantSpeechText(raw: string): PreparedAssistantSpeechText {
  if (!raw?.trim()) {
    return { ttsText: '', utterancePoseIntent: null, colonGestureCues: [] };
  }

  let s = raw;
  let utterancePoseIntent: CognitiveIntentHint | null = null;

  s = s.replace(/\[POSE:\s*([^\]]+?)\s*\]/gi, (_full, inner: string) => {
    const next = mapPoseToken(String(inner));
    if (next) utterancePoseIntent = next;
    return ' ';
  });

  const colonGestureCues: PerformanceCue[] = [];
  s = s.replace(/\[GESTURE:\s*([a-z0-9_]+)\s*\]/gi, (_, token: string) => {
    const k = token.toLowerCase();
    const anim = _GESTURE_TOKEN_MAP[k] ?? 'ack';
    colonGestureCues.push({
      tag: `[GESTURE_${k.toUpperCase()}]`,
      start_word: 0,
      start_ms: 0,
      animation: anim,
      intensity: 0.65,
    });
    return ' ';
  });

  const ttsText = stripAvatarPerformanceMarkup(s);

  return {
    ttsText,
    utterancePoseIntent,
    colonGestureCues,
  };
}
