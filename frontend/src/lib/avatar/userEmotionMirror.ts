/**
 * User → avatar emotional mirroring (subtle, non-mimic).
 * Deterministic rules from transcript + optional mood + utterance pacing.
 */
'use client';

export type UserMirrorEmotion = 'calm' | 'confused' | 'excited' | 'frustrated';

export type UserSpeechRhythm = 'fast' | 'slow' | 'neutral';

export type InferUserMirrorEmotionInput = {
  text: string;
  /** Backend / last transcript mood hint */
  userMood?: string;
  stressSignals?: string[];
};

/**
 * Map user text + light mood hints to a single discrete mirror label.
 * Defaults to calm when no strong cue (relaxed baseline, not theatrical).
 */
export function inferUserMirrorEmotion(inp: InferUserMirrorEmotionInput): UserMirrorEmotion {
  const t = (inp.text ?? '').trim().toLowerCase();
  if (!t) return 'calm';

  const score: Record<UserMirrorEmotion, number> = {
    calm: 0,
    confused: 0,
    excited: 0,
    frustrated: 0,
  };

  if (
    /frustrat|annoyed|عصب|زهق|تعبت|wrong|stupid|ugh|غلط|خطأ|لا يعمل|doesn'?t work|hate this|مزعج/.test(
      t,
    )
  ) {
    score.frustrated += 3;
  }
  if (
    /ما فهمت|مش فاهم|مش واضح|confused|don't understand|dont get|huh\?|how come|not sure|unsure|غامض/.test(
      t,
    )
  ) {
    score.confused += 3;
  }
  if ((/\?|؟/.test(t) && /what|why|how|شو|ماذا|كيف|ليش|explain|mean/.test(t)) || /confus|lost/.test(t)) {
    score.confused += 1.5;
  }
  if (
    /wow|amazing|رائع|yay|yes!|!!|great|love it|حمس|ممتاز|let'?s go|excit|fantastic|perfect/.test(t)
  ) {
    score.excited += 2.5;
  }
  if (/تمام|تماماً|^ok$|okay|thanks|شكرا|fine|alright|هدأ|calm|relaxed|chill|no rush/.test(t)) {
    score.calm += 2;
  }

  const m = (inp.userMood ?? '').toLowerCase().trim();
  if (m === 'anxious' || m === 'angry' || m === 'sad') score.frustrated += 1.5;
  if (m === 'excited' || m === 'happy' || m === 'celebrate') score.excited += 2;
  if (m === 'bored' || m === 'calm' || m === 'relaxed' || m === 'sleepy') score.calm += 1.2;
  if (m === 'curious' || m === 'surprised') score.confused += 0.8;

  if (inp.stressSignals && inp.stressSignals.length > 0) score.frustrated += 1.2;

  let best: UserMirrorEmotion = 'calm';
  let bestS = -1;
  (Object.keys(score) as UserMirrorEmotion[]).forEach((k) => {
    if (score[k] > bestS) {
      bestS = score[k];
      best = k;
    }
  });
  if (bestS < 1.1) return 'calm';
  return best;
}

export type InferUserSpeechRhythmInput = {
  utteranceDurationMs: number;
  charCount: number;
  wordCount: number;
};

/**
 * Pace from last VAD segment length + text size (no audio DSP).
 */
export function inferUserSpeechRhythm(inp: InferUserSpeechRhythmInput): UserSpeechRhythm {
  const dur = Math.max(380, inp.utteranceDurationMs);
  const cps = inp.charCount / (dur / 1000);
  const wps = inp.wordCount / (dur / 1000);
  if (cps > 6.8 || wps > 2.6 || (inp.charCount <= 18 && inp.wordCount >= 4)) return 'fast';
  if (cps < 3.4 && inp.charCount > 40) return 'slow';
  return 'neutral';
}

export type UserMirrorMicroAdds = {
  happyAdd: number;
  surprisedAdd: number;
  lookUpAdd: number;
  blinkIntervalScaleMul: number;
  /** Subtle mouth tension (VRM ih) */
  ihTension: number;
  /** Subtle rounding (VRM ou) */
  ouTension: number;
};

/**
 * Small additive facial offsets while mirroring — kept sub-expressive caps.
 */
export function getUserMirrorMicroAdds(
  emotion: UserMirrorEmotion,
  engaged: boolean,
): UserMirrorMicroAdds {
  const z: UserMirrorMicroAdds = {
    happyAdd: 0,
    surprisedAdd: 0,
    lookUpAdd: 0,
    blinkIntervalScaleMul: 1,
    ihTension: 0,
    ouTension: 0,
  };
  if (!engaged) return z;

  switch (emotion) {
    case 'calm':
      z.blinkIntervalScaleMul = 1.08;
      z.lookUpAdd = -0.012;
      return z;
    case 'confused':
      z.surprisedAdd = 0.038;
      z.lookUpAdd = 0.022;
      z.blinkIntervalScaleMul = 1.06;
      return z;
    case 'excited':
      z.happyAdd = 0.028;
      z.surprisedAdd = 0.022;
      z.blinkIntervalScaleMul = 0.96;
      return z;
    case 'frustrated':
      z.surprisedAdd = 0.018;
      z.happyAdd = 0.014;
      z.ihTension = 0.04;
      z.ouTension = 0.022;
      z.blinkIntervalScaleMul = 1.04;
      return z;
    default:
      return z;
  }
}

