'use client';

/**
 * __humanBehaviorEngine.ts — perceptual realism layer.
 *
 * Owns NO bones / scene / React. Produces per-frame multipliers and offsets that
 * `mergeBehaviorEngineMotionScalars` in `__behaviorSync.ts` applies *between*
 * the timing envelope and the safety floors / final motion guard.
 *
 * Goals (non-destructive, additive):
 *   • Replace single-sinusoid jitter with low-frequency 3-octave pseudo-noise.
 *   • Long-horizon drift memory (random walk, clamped, light damping).
 *   • Rare micro-interruptions (~3 %/s while speaking) for "hesitation" feel.
 *   • Asymmetric channels — head and arm never share a multiplier.
 *   • Micro bursts on intent change / intensity spike (×1.2 for ~120 ms).
 *   • Coarse phase reporting (anticipation / sustain / decay / idle) for HUD;
 *     does NOT add amplitude scaling — that stays in `__behaviorTiming.ts`.
 *   • Gaze FSM (camera / away / focus) and blink scheduler exposed for downstream.
 */

export type HumanInput = {
  speaking: boolean;
  intent: string;
  emotion: string;
  intensity: number;
  speechEnergy: number;
  timestamp: number;
};

export type GazeTarget = 'camera' | 'away' | 'focus';
export type HumanPhase = 'idle' | 'anticipation' | 'sustain' | 'decay';

export type HumanState = {
  /** Multiplicative gain for `openGesture` (arm channel). */
  gestureAmplitude: number;
  /** Multiplicative gain for `headNod` (head channel). Always different from gestureAmplitude. */
  headMovement: number;
  /** Additive head-tilt offset in radians (small). */
  headTilt: number;
  /** Eye micro-movement (radians, small). */
  eyeMovement: number;
  /** Combined eye yaw offset including gaze-target bias. */
  eyeOffset: number;
  gazeTarget: GazeTarget;
  /** Approximate blink rate (Hz, informational). */
  blinkRate: number;
  /** True for a single frame when scheduler wants a blink to fire. */
  blinkIntent: boolean;
  /** Head channel's micro-variance multiplier component (≈ 0.93..1.07). */
  microVariance: number;
  /** Arm channel's micro-variance multiplier component (≈ 0.93..1.07). */
  microVarianceArm: number;
  /** Remaining ms in current phase (informational). */
  anticipationOffsetMs: number;
  phase: HumanPhase;
  /** Active micro burst multiplier (1.0 baseline, up to 1.2 transient). */
  microBurst: number;
  /** Active micro interruption multiplier (1.0 baseline, 0.5..1.0 transient). */
  microInterruption: number;
  /** Drift memory at this frame (head channel). */
  driftHead: number;
  /** Drift memory at this frame (arm channel). */
  driftArm: number;
};

// ── Internal state ─────────────────────────────────────────────────────────

let _lastNow = -1;

let _driftHead = 0;
let _driftArm = 0;

let _prevSpeaking = false;
let _phase: HumanPhase = 'idle';
let _phaseStart = 0;
let _phaseDur = 0;

let _microInterruptionEnd = 0;
let _microInterruptionStrength = 1;

let _microBurstEnd = 0;
let _microBurstStrength = 1;

let _prevIntent = '';
let _prevIntensity = 0;

let _gaze: GazeTarget = 'camera';
let _gazeEnd = 0;

let _nextBlink = 0;

// ── Helpers ────────────────────────────────────────────────────────────────

function _norm(s: string): string {
  return (s ?? '').trim().toLowerCase();
}

/** 3-octave low-frequency pseudo-noise.  Output range ≈ [-3, 3]. */
function pseudoNoise(t: number, seed = 0): number {
  return (
    Math.sin(t * 0.0023 + seed) +
    Math.sin(t * 0.0037 + seed * 1.7) +
    Math.sin(t * 0.0011 + seed * 0.9)
  );
}

function _dt(now: number): number {
  if (_lastNow < 0) {
    _lastNow = now;
    return 16;
  }
  const dt = Math.max(0, Math.min(100, now - _lastNow));
  _lastNow = now;
  return dt;
}

/** Random-walk drift accumulator with light decay and hard clamp. */
function _updateDrift(dtMs: number): { head: number; arm: number } {
  _driftHead += (Math.random() - 0.5) * 0.0008 * dtMs;
  _driftArm += (Math.random() - 0.5) * 0.0008 * dtMs;
  _driftHead *= 0.9995;
  _driftArm *= 0.9995;
  if (_driftHead > 0.15) _driftHead = 0.15;
  else if (_driftHead < -0.15) _driftHead = -0.15;
  if (_driftArm > 0.15) _driftArm = 0.15;
  else if (_driftArm < -0.15) _driftArm = -0.15;
  return { head: _driftHead, arm: _driftArm };
}

function _updatePhase(now: number, speaking: boolean): void {
  if (speaking && !_prevSpeaking) {
    _phase = 'anticipation';
    _phaseStart = now;
    _phaseDur = 100 + Math.random() * 150;
  } else if (!speaking && _prevSpeaking) {
    _phase = 'decay';
    _phaseStart = now;
    _phaseDur = 300 + Math.random() * 400;
  } else if (_phase === 'anticipation' && speaking) {
    if (now - _phaseStart >= _phaseDur) {
      _phase = 'sustain';
      _phaseStart = now;
      _phaseDur = 0;
    }
  } else if (_phase === 'decay' && !speaking) {
    if (now - _phaseStart >= _phaseDur) {
      _phase = 'idle';
      _phaseStart = now;
      _phaseDur = 0;
    }
  }
  _prevSpeaking = speaking;
}

function _updateMicroInterruption(now: number, dtMs: number, speaking: boolean): number {
  if (now > _microInterruptionEnd) {
    _microInterruptionStrength = 1;
    if (speaking) {
      // ≈ 3 % per second probability of starting a new interruption.
      const probPerMs = 0.00003;
      if (Math.random() < probPerMs * dtMs) {
        _microInterruptionEnd = now + 100 + Math.random() * 200;
        _microInterruptionStrength = 0.55 + Math.random() * 0.3;
      }
    }
  }
  return _microInterruptionStrength;
}

function _updateMicroBurst(now: number, intent: string, intensity: number): number {
  const intentChanged = !!intent && intent !== _prevIntent;
  const intensitySpike = intensity - _prevIntensity > 0.25;
  _prevIntent = intent;
  _prevIntensity = intensity;
  if (intentChanged || intensitySpike) {
    _microBurstEnd = now + 120;
    _microBurstStrength = 1.2;
  }
  if (now > _microBurstEnd) {
    _microBurstStrength = 1.0;
  }
  return _microBurstStrength;
}

function _updateGaze(now: number, speaking: boolean, intensity: number): GazeTarget {
  if (now < _gazeEnd) return _gaze;

  if (_gaze === 'camera') {
    const awayProb = speaking ? 0.18 : 0.08;
    const focusProb = speaking ? 0.12 + 0.2 * intensity : 0.05;
    const r = Math.random();
    if (r < awayProb) {
      _gaze = 'away';
      _gazeEnd = now + 600 + Math.random() * 900;
    } else if (r < awayProb + focusProb) {
      _gaze = 'focus';
      _gazeEnd = now + 800 + Math.random() * 1500;
    } else {
      _gazeEnd = now + 1200 + Math.random() * 2200;
    }
  } else {
    _gaze = 'camera';
    _gazeEnd = now + 1500 + Math.random() * 2500;
  }
  return _gaze;
}

function _updateBlink(now: number): boolean {
  if (_nextBlink === 0) {
    _nextBlink = now + 2000 + Math.random() * 3000;
  }
  if (now >= _nextBlink) {
    _nextBlink = now + 2000 + Math.random() * 3000;
    return true;
  }
  return false;
}

// ── Main entry ─────────────────────────────────────────────────────────────

export function computeHumanBehavior(input: HumanInput): HumanState {
  const now = input.timestamp;
  const dtMs = _dt(now);
  const intent = _norm(input.intent);
  const emotion = _norm(input.emotion);
  const intensity01 = Math.max(0, Math.min(1, input.intensity));
  const energy01 = Math.max(0, Math.min(1, input.speechEnergy));

  _updatePhase(now, input.speaking);
  const burst = _updateMicroBurst(now, intent, intensity01);
  const interruption = _updateMicroInterruption(now, dtMs, input.speaking);
  const drift = _updateDrift(dtMs);
  const gazeTarget = _updateGaze(now, input.speaking, intensity01);
  const blinkIntent = _updateBlink(now);

  let baseAmp = input.speaking ? 1.0 : 0.55;
  if (intent.includes('emphas')) baseAmp *= 1.18;
  else if (intent.includes('explain')) baseAmp *= 1.0;

  if (emotion === 'excited' || emotion === 'surprised' || emotion === 'angry') {
    baseAmp *= 1.18;
  } else if (
    emotion === 'serious' ||
    emotion === 'thinking' ||
    emotion === 'focused' ||
    emotion === 'sad'
  ) {
    baseAmp *= 0.78;
  } else if (emotion === 'happy' || emotion === 'joy' || emotion === 'friendly') {
    baseAmp *= 1.06;
  }

  baseAmp *= 0.85 + 0.4 * energy01;
  baseAmp *= burst * interruption;

  // Asymmetric noise — different seeds guarantee head and arm never share a multiplier.
  const microHead = 1 + 0.07 * (pseudoNoise(now, 0) / 3);
  const microArm = 1 + 0.07 * (pseudoNoise(now, 13.7) / 3);

  const headMovement = baseAmp * microHead * (1 + drift.head);
  const gestureAmplitude = baseAmp * microArm * (1 + drift.arm);

  const tiltAmp =
    emotion === 'thinking' || emotion === 'focused' || emotion === 'sad' ? 0.08 : 0.03;
  const headTilt = Math.sin(now * 0.0009) * tiltAmp;

  const eyeNoise = pseudoNoise(now, 7.3) / 3;
  const eyeMovement = 0.04 * eyeNoise;
  let eyeOffset = eyeMovement;
  if (gazeTarget === 'away') eyeOffset += 0.18;
  else if (gazeTarget === 'focus') eyeOffset -= 0.05;

  const blinkRate = input.speaking ? 0.4 : 0.25;

  const phaseRemainingMs =
    _phase === 'anticipation' || _phase === 'decay'
      ? Math.max(0, _phaseDur - (now - _phaseStart))
      : 0;

  return {
    gestureAmplitude,
    headMovement,
    headTilt,
    eyeMovement,
    eyeOffset,
    gazeTarget,
    blinkRate,
    blinkIntent,
    microVariance: microHead,
    microVarianceArm: microArm,
    anticipationOffsetMs: phaseRemainingMs,
    phase: _phase,
    microBurst: burst,
    microInterruption: interruption,
    driftHead: drift.head,
    driftArm: drift.arm,
  };
}
