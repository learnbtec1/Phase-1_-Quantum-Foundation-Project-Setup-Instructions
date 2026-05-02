/**
 * Eye intelligence tuning — emotion → blink / gaze / micro-look multipliers.
 * Used by AnimationController; keeps magic numbers in one place.
 */
'use client';

export type EyeEmotionMods = {
  /** Multiplies base blink interval (higher = slower blinks) */
  blinkIntervalMul: number;
  /** Additive lookUp morph bias 0..~0.08 */
  lookUpBias: number;
  /** Scales saccade offset visibility */
  saccadeMul: number;
  /** Pulls fused eye target toward camera (0..1) */
  gazeDirectMul: number;
};

const DEFAULT: EyeEmotionMods = {
  blinkIntervalMul: 1,
  lookUpBias: 0,
  saccadeMul: 1,
  gazeDirectMul: 0.5,
};

/** Map brain / agent emotion label → subtle eye behavior */
export function getEyeEmotionMods(emotion: string | undefined): EyeEmotionMods {
  const e = (emotion ?? 'neutral').toLowerCase().trim();
  switch (e) {
    case 'calm':
    case 'relaxed':
      return { blinkIntervalMul: 1.25, lookUpBias: 0.01, saccadeMul: 0.85, gazeDirectMul: 0.42 };
    case 'strict':
    case 'focused':
    case 'serious':
      return { blinkIntervalMul: 1.45, lookUpBias: 0.02, saccadeMul: 0.72, gazeDirectMul: 0.62 };
    case 'thinking':
      return { blinkIntervalMul: 1.15, lookUpBias: 0.045, saccadeMul: 0.78, gazeDirectMul: 0.38 };
    case 'excited':
    case 'encouraging':
    case 'happy':
    case 'friendly':
      return { blinkIntervalMul: 0.92, lookUpBias: 0.015, saccadeMul: 1.05, gazeDirectMul: 0.58 };
    case 'concerned':
    case 'sad':
    case 'empathetic':
      return { blinkIntervalMul: 1.08, lookUpBias: 0.008, saccadeMul: 0.88, gazeDirectMul: 0.48 };
    default:
      return { ...DEFAULT };
  }
}

/** Pre-speech window length (seconds) — matches ~150–300 ms feel */
export const PRE_SPEECH_DECAY_SEC = 0.32;
