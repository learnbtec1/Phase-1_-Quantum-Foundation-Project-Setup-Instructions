/**
 * Candidate lists for resolving canonical expression names to model-resident keys at runtime.
 * The resolver picks the FIRST available key from each list using ExpressionManager or morph targets.
 *
 * See: src/ai/avatar/resolveExpressions.ts for the resolution helper.
 */
import { ExpressionNames } from './ExpressionNames';

/**
 * For each canonical expression name, the ordered list of candidate keys to try.
 * Ordered from most-standard to most-obscure so the first hit is the best match.
 */
export const ExpressionCandidates: Record<string, string[]> = {
  // ── Blink ────────────────────────────────────────────────────────────────
  [ExpressionNames.BLINK]: [
    'blink', 'Blink', 'BlinkBoth',
    'blinkLeft', 'BlinkLeft', 'Blink_L',
    'blinkRight', 'BlinkRight', 'Blink_R',
    'Eye_Blink', 'Eye_Blink_L', 'Eye_Blink_R',
    'eyeBlink', 'eyeBlinkLeft', 'eyeBlinkRight',
    'EyeBlink', 'EyeBlinkLeft', 'EyeBlinkRight',
    'eyesClosed', 'EyesClosed', 'Eyes_Closed',
    'eyeClosed', 'EyeClosed', 'eye_close', 'EyeClose',
    'CloseEye_L', 'CloseEye_R', 'closeEye', 'CloseEyes',
    'wink', 'Wink',
  ],
  [ExpressionNames.BLINK_LEFT]: [
    'blinkLeft', 'BlinkLeft', 'Blink_L',
    'Eye_Blink_L', 'eyeBlinkLeft', 'EyeBlinkLeft',
    'EyeClosed_L', 'CloseEye_L', 'WinkLeft', 'Wink_L',
  ],
  [ExpressionNames.BLINK_RIGHT]: [
    'blinkRight', 'BlinkRight', 'Blink_R',
    'Eye_Blink_R', 'eyeBlinkRight', 'EyeBlinkRight',
    'EyeClosed_R', 'CloseEye_R', 'WinkRight', 'Wink_R',
  ],

  // ── Emotions ─────────────────────────────────────────────────────────────
  [ExpressionNames.JOY]: [
    'Joy', 'joy', 'Happy', 'happy', 'Smile', 'smile',
    'Fun', 'fun', 'Cheer', 'Smile_Open',
  ],
  [ExpressionNames.ANGRY]: [
    'Angry', 'angry', 'Mad', 'mad', 'Anger', 'anger',
    'Serious', 'Frown', 'Annoyed',
  ],
  [ExpressionNames.SORROW]: [
    'Sorrow', 'sorrow', 'Sad', 'sad', 'Sadness', 'Cry', 'Down',
  ],
  [ExpressionNames.FUN]: [
    'Fun', 'fun', 'Smile', 'smile', 'Joy', 'joy',
  ],
  [ExpressionNames.SURPRISED]: [
    'Surprised', 'surprised', 'Surprise', 'surprise', 'Wow',
  ],
  [ExpressionNames.RELAXED]: [
    'Relaxed', 'relaxed', 'Calm', 'calm', 'Fun', 'fun',
  ],
  [ExpressionNames.NEUTRAL]: [
    'neutral', 'Neutral', 'Default', 'default',
  ],

  // ── Gaze / look ──────────────────────────────────────────────────────────
  [ExpressionNames.LOOK_LEFT]: [
    'lookLeft', 'LookLeft', 'Eyes_Left', 'Eye_L', 'GazeLookLeft',
  ],
  [ExpressionNames.LOOK_RIGHT]: [
    'lookRight', 'LookRight', 'Eyes_Right', 'Eye_R', 'GazeLookRight',
  ],
  [ExpressionNames.LOOK_UP]: [
    'lookUp', 'LookUp', 'Eyes_Up', 'Eye_Up', 'GazeLookUp',
  ],
  [ExpressionNames.LOOK_DOWN]: [
    'lookDown', 'LookDown', 'Eyes_Down', 'Eye_Down', 'GazeLookDown',
  ],

  // ── VRM 0.x mouth presets ────────────────────────────────────────────────
  [ExpressionNames.A]: ['A', 'a', 'AA', 'aa', 'MouthOpen', 'Ah'],
  [ExpressionNames.I]: ['I', 'i', 'EE', 'ee', 'MouthSmile', 'MouthWide', 'Ii'],
  [ExpressionNames.U]: ['U', 'u', 'OU', 'ou', 'MouthNarrow', 'Uu'],
  [ExpressionNames.E]: ['E', 'e', 'ih', 'IH', 'MouthWide', 'Eh'],
  [ExpressionNames.O]: ['O', 'o', 'oh', 'OH', 'MouthRound', 'Oh'],

  // ── Visemes (TTS/Whisper output) ─────────────────────────────────────────
  [ExpressionNames.AA]: ['aa', 'AA', 'A', 'a', 'MouthOpen'],
  [ExpressionNames.IH]: ['ih', 'IH', 'I', 'i', 'MouthSmile', 'MouthWide'],
  [ExpressionNames.OU]: ['ou', 'OU', 'U', 'u', 'MouthNarrow'],
  [ExpressionNames.EE]: ['ee', 'EE', 'E', 'e', 'MouthWide'],
  [ExpressionNames.OH]: ['oh', 'OH', 'O', 'o', 'MouthRound'],
};
