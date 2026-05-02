/**
 * Strips persona/embodiment markup from assistant dialogue for **display and TTS**.
 * Inline `[wave]`, `[EMOTION: …]`, and `*stage directions*` stay in the raw stream
 * long enough for `_parseClientInlineGestures` / scheduling; call this **after** that parse.
 */

const INLINE_GESTURE_KEYS_RE =
  'wave|waving|think|thinking|point|pointing|beckon|beckoning|' +
  'agree|agreeing|nod|clap|clapping|cheer|celebrate|' +
  'relax|look|goodbye|bye|explain|encourage|question|' +
  'greet|salute|shrug|peace|sad|angry|surprise|surprised|' +
  'blush|sleepy';

let _inlineGestureRe: RegExp | null = null;
function inlineGestureTokenRe(): RegExp {
  if (!_inlineGestureRe) {
    _inlineGestureRe = new RegExp(`\\[(${INLINE_GESTURE_KEYS_RE})\\]`, 'gi');
  }
  return _inlineGestureRe;
}

export function stripAvatarPerformanceMarkup(raw: string): string {
  if (!raw) return '';
  let s = raw;
  // [EMOTION: friendly] …
  s = s.replace(/\s*\[EMOTION:\s*[^\]]+\]\s*/gi, ' ');
  // [POSE: thinking] — motion script tags (handled by TTS prep + cognitive orchestrator)
  s = s.replace(/\s*\[POSE:\s*[^\]]+\]\s*/gi, ' ');
  // [wave] [think] …
  s = s.replace(inlineGestureTokenRe(), ' ');
  // Optional backend-style tags
  s = s.replace(/\s*\[GESTURE_[A-Z0-9_]+\]\s*/g, ' ');
  s = s.replace(/\s*\[GESTURE:\s*[^\]]+\]\s*/gi, ' ');
  // *English / rubric-style stage directions*: only remove *...* if block contains ASCII letters.
  s = s.replace(/\*(?=[^*\r\n]*[a-zA-Z])[^*\r\n]+\*/g, ' ');
  // Remaining *...* (e.g. Arabic performance text): unwrap — keep spoken words, lose stars.
  s = s.replace(/\*([^*\r\n]+)\*/g, (_, inner: string) => inner.trim());
  s = s.replace(/\s+/g, ' ').trim();
  return s;
}
