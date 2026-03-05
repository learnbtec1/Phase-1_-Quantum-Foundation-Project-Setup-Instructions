/**
 * Parses AI reply to extract dialogue for speech and emotion for avatar.
 * Strips *action lines* and [EMOTION: X] — avatar performs these, doesn't speak them.
 */

const EMOTION_TAG_RE = /\[EMOTION:\s*(neutral|friendly|thinking|encouraging|strict|strictEvaluation|celebrate|celebration)\s*\]\s*$/im;
const ACTION_LINE_RE = /\s*\*[^*]+\*\s*/g;

export type ParsedEmotion = 'neutral' | 'friendly' | 'thinking' | 'encouraging' | 'strictEvaluation' | 'celebration';

export interface ParsedReply {
  /** Clean dialogue for TTS and display — no action lines, no emotion tag */
  dialogue: string;
  /** Emotion from [EMOTION: X] or null if not present */
  emotion: ParsedEmotion | null;
}

/**
 * Parse reply: extract dialogue for speech, emotion for avatar.
 * Avatar performs actions (smile, tilt head) — does NOT speak them.
 */
export function parseReply(reply: string): ParsedReply {
  const raw = reply?.trim() ?? '';
  const emotionMatch = raw.match(EMOTION_TAG_RE);
  const rawEmotion = emotionMatch ? emotionMatch[1].toLowerCase() : null;
  const mapEmotion = (e: string | null): ParsedReply['emotion'] => {
    if (!e) return null;
    if (e === 'celebrate') return 'celebration';
    if (e === 'strict') return 'strictEvaluation';
    return e as ParsedReply['emotion'];
  };
  const emotion = mapEmotion(rawEmotion);
  let dialogue = raw
    .replace(EMOTION_TAG_RE, '')
    .replace(ACTION_LINE_RE, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return { dialogue, emotion };
}
