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
  // [wave] [think] …
  s = s.replace(inlineGestureTokenRe(), ' ');
  // Optional backend-style tags
  s = s.replace(/\s*\[GESTURE_[A-Z0-9_]+\]\s*/g, ' ');
  // *نص مسرحي / وصفي* بين نجمتين
  s = s.replace(/\*[^*\r\n]+\*/g, ' ');
  s = s.replace(/\s+/g, ' ').trim();
  return s;
}
