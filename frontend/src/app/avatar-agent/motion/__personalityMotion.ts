'use client';

/**
 * __personalityMotion.ts — Personality engine.
 *
 * Pipeline position: AFTER `applySpeechFusion`, BEFORE the `_VIS_AMP` clamp.
 *
 * Five-field personality fingerprint per profile:
 *   • gestureAmp    — gain on the gesture-amplitude injection (× energy * 0.1)
 *   • gestureFreq   — base burst frequency multiplier (used by emphasizing)
 *   • nodGain       — gain on the head-nod injection (× energy * 0.03)
 *   • tiltBias      — constant head-tilt offset (radians, signature pose)
 *   • expressivity  — energy-scaled multiplier on `headNod` and `openGesture`
 *
 * Strict invariants:
 *   • Cannot zero motion (expressivity scale ≥ 0.7 at energy=1, ≥ 1.0 at energy=0).
 *   • All upstream merge guards remain valid (this layer never reduces magnitude
 *     during silence; multiplicative `*= scale` is energy-gated so silence = ×1).
 *   • Window-overridable runtime profile (`window.__personalityProfile = '...'`).
 */

export type PersonalityProfile = 'teacher' | 'friend' | 'coach' | 'neutral';
export type PersonalityType = PersonalityProfile;

export type PersonalityMotionOpts = {
  /** True while the avatar is uttering speech. */
  speaking: boolean;
  /** 0..1 smoothed speech energy (e.g. `peekSpeechEnergy()`). */
  energy: number;
  /** Monotonic clock seconds (`t` in `useFrame`). */
  timeSec: number;
  /** Active intent label (e.g. `'emphasizing'`). */
  intent: string;
};

type PersonalityParams = {
  gestureAmp:   number;
  gestureFreq:  number;
  nodGain:      number;
  tiltBias:     number;
  expressivity: number;
};

// Profile fingerprints — exact values from the spec.
const PERSONALITIES: Record<PersonalityProfile, PersonalityParams> = {
  teacher: { gestureAmp: 0.6, gestureFreq: 0.6, nodGain: 0.6, tiltBias: 0.02, expressivity: 0.7 },
  friend:  { gestureAmp: 1.0, gestureFreq: 1.0, nodGain: 1.0, tiltBias: 0.05, expressivity: 1.0 },
  coach:   { gestureAmp: 1.4, gestureFreq: 1.4, nodGain: 1.3, tiltBias: 0.03, expressivity: 1.3 },
  neutral: { gestureAmp: 1.0, gestureFreq: 1.0, nodGain: 1.0, tiltBias: 0.0,  expressivity: 1.0 },
};

// ── Module state ────────────────────────────────────────────────────────────

let _activeProfile: PersonalityProfile = 'neutral';
let _lastPersonalityLogMs = -Infinity;
const PERSONALITY_LOG_MS = 850;

// ── Selection API ──────────────────────────────────────────────────────────

/** Programmatic profile setter (e.g. from a UI dropdown / brain state). */
export function setPersonalityProfile(p: PersonalityProfile): void {
  if (p in PERSONALITIES) _activeProfile = p;
}

/** Read active profile, honouring `window.__personalityProfile` runtime override. */
export function getPersonalityProfile(): PersonalityProfile {
  if (typeof window !== 'undefined') {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const w = window as any;
    const o = w.__personalityProfile;
    if (typeof o === 'string' && o in PERSONALITIES) return o as PersonalityProfile;
  }
  return _activeProfile;
}

/** Read full fingerprint of the active profile (for HUD / inspection). */
export function getPersonalityConfig(): Readonly<PersonalityParams> & { profile: PersonalityProfile } {
  const profile = getPersonalityProfile();
  return { ...(PERSONALITIES[profile] ?? PERSONALITIES.neutral), profile };
}

function _normIntent(s: string): string {
  return (s ?? '').trim().toLowerCase();
}

// ── Core modulator ─────────────────────────────────────────────────────────

/**
 * Apply personality-driven modulation to motion in-place.
 *
 *   1. Gesture amplitude  — `motion.openGesture += energy * 0.1 * gestureAmp`
 *   2. Head nod           — `motion.headNod     += energy * 0.03 * nodGain`
 *   3. Tilt bias          — `motion.headTilt    += tiltBias`        (constant signature)
 *   4. Expressivity scale — `headNod / openGesture *= 1 + (expressivity - 1) * energy`
 *   5. Intent modulation  — emphasizing → 6 Hz·gestureFreq head-nod burst
 *
 * Energy-gated multiplicative scaling means at energy=0 the scale is 1.0 — the
 * upstream merge-layer guards continue to dominate during silence.
 */
export function applyPersonalityMotion(
  motion: { headNod: number; headTilt: number; openGesture: number },
  opts: PersonalityMotionOpts,
): void {
  const profile = getPersonalityProfile();
  const p = PERSONALITIES[profile] ?? PERSONALITIES.neutral;
  const energy01 = Math.max(0, Math.min(1, opts.energy));
  const intent = _normIntent(opts.intent);

  // Capture pre-state for delta logging.
  const _preHN = motion.headNod;
  const _preHT = motion.headTilt;
  const _preOG = motion.openGesture;

  // 1. Gesture amplitude.
  motion.openGesture += energy01 * 0.1 * p.gestureAmp;

  // 2. Head nod.
  motion.headNod += energy01 * 0.03 * p.nodGain;

  // 3. Constant tilt bias — always present (signature pose, also when silent).
  motion.headTilt += p.tiltBias;

  // 4. Expressivity scaling — energy-gated; ×1 at silence, ×expressivity at full energy.
  const scale = 1 + (p.expressivity - 1) * energy01;
  if (scale !== 1) {
    motion.headNod      *= scale;
    motion.openGesture  *= scale;
  }

  // 5. Intent modulation — emphasizing produces periodic nod bursts.
  if (intent === 'emphasizing' && opts.speaking) {
    const burst = Math.abs(Math.sin(opts.timeSec * 6 * p.gestureFreq));
    motion.headNod += burst * 0.15 * p.gestureAmp;
  }

  // ── Debug surface ────────────────────────────────────────────────────────
  const deltaHN = motion.headNod - _preHN;
  const deltaHT = motion.headTilt - _preHT;
  const deltaOG = motion.openGesture - _preOG;

  if (typeof window !== 'undefined') {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const w = window as any;
    w.__personality = {
      profile,
      effectOnMotion: {
        deltaHeadNod:     +deltaHN.toFixed(4),
        deltaHeadTilt:    +deltaHT.toFixed(4),
        deltaOpenGesture: +deltaOG.toFixed(4),
      },
    };
    w.__personalityMotionState = {
      profile,
      gestureAmp:   p.gestureAmp,
      gestureFreq:  p.gestureFreq,
      nodGain:      p.nodGain,
      tiltBias:     p.tiltBias,
      expressivity: p.expressivity,
      scale:        +scale.toFixed(3),
    };
  }

  // Throttled effect log.
  const now = typeof performance !== 'undefined' ? performance.now() : Date.now();
  if (now - _lastPersonalityLogMs > PERSONALITY_LOG_MS) {
    _lastPersonalityLogMs = now;
    // eslint-disable-next-line no-console
    console.log('[PERSONALITY_EFFECT]', {
      profile,
      energy:   +energy01.toFixed(3),
      intent:   intent || '(none)',
      speaking: opts.speaking,
      params: {
        gestureAmp:   p.gestureAmp,
        gestureFreq:  p.gestureFreq,
        nodGain:      p.nodGain,
        tiltBias:     p.tiltBias,
        expressivity: p.expressivity,
      },
      delta: {
        headNod:     +deltaHN.toFixed(3),
        headTilt:    +deltaHT.toFixed(3),
        openGesture: +deltaOG.toFixed(3),
      },
      motion: {
        headNod:     +motion.headNod.toFixed(3),
        headTilt:    +motion.headTilt.toFixed(3),
        openGesture: +motion.openGesture.toFixed(3),
      },
    });
  }
}
