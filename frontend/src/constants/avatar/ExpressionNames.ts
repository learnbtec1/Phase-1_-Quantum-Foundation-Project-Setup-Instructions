/**
 * Canonical English expression names (VRM presets, visemes, look directions).
 * Use these keys in code; resolution to model-actual keys is done via ExpressionCandidates.
 */
export const ExpressionNames = {
  // ── Core emotions ─────────────────────────────────────────────────────────
  NEUTRAL:   'neutral',
  JOY:       'joy',
  ANGRY:     'angry',
  SORROW:    'sorrow',
  FUN:       'fun',
  SURPRISED: 'surprised',
  RELAXED:   'relaxed',

  // ── Blink / eyes ──────────────────────────────────────────────────────────
  BLINK:       'blink',
  BLINK_LEFT:  'blinkLeft',
  BLINK_RIGHT: 'blinkRight',

  // ── Gaze / look ─────────────────────────────────────────────────────────
  LOOK_LEFT:  'lookLeft',
  LOOK_RIGHT: 'lookRight',
  LOOK_UP:    'lookUp',
  LOOK_DOWN:  'lookDown',

  // ── VRM 0.x mouth presets ────────────────────────────────────────────────
  A: 'A',
  I: 'I',
  U: 'U',
  E: 'E',
  O: 'O',

  // ── Visemes (TTS / Whisper phoneme output) ────────────────────────────────
  AA: 'aa',
  IH: 'ih',
  OU: 'ou',
  EE: 'ee',
  OH: 'oh',
} as const;

export type ExpressionName = typeof ExpressionNames[keyof typeof ExpressionNames];
