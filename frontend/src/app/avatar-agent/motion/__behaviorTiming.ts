'use client';

/**
 * Natural timing layer — phase envelope around speech edges (anticipation → speaking → settling).
 * Pure scalars; consumers multiply into existing motion — does not replace upstream kinematics.
 */

export type TimingState = {
  phase: 'idle' | 'anticipation' | 'speaking' | 'settling';
  phaseStart: number;
  duration: number;
};

export type TimingInput = {
  speaking: boolean;
  /** Monotonic ms — prefer `performance.now()`. */
  now: number;
};

function _pickAnticipationMs(): number {
  return 200 + Math.random() * 200;
}

function _pickSettlingMs(): number {
  return 300 + Math.random() * 300;
}

function _smoothstep(t: number): number {
  const x = Math.max(0, Math.min(1, t));
  return x * x * (3 - 2 * x);
}

let _prevSpeaking = false;
let _phase: TimingState['phase'] = 'idle';
let _phaseStart = 0;
let _duration = 0;

/**
 * Drives phase machine from speech edges. Call once per motion frame with the same `now` clock
 * used for blending.
 */
export function computeTimingState(input: TimingInput): TimingState {
  const { speaking, now } = input;

  if (speaking && !_prevSpeaking) {
    _phase = 'anticipation';
    _phaseStart = now;
    _duration = _pickAnticipationMs();
  } else if (!speaking && _prevSpeaking) {
    _phase = 'settling';
    _phaseStart = now;
    _duration = _pickSettlingMs();
  } else if (_phase === 'anticipation' && speaking) {
    if (now - _phaseStart >= _duration) {
      _phase = 'speaking';
      _phaseStart = now;
      _duration = 0;
    }
  } else if (_phase === 'settling' && !speaking) {
    if (now - _phaseStart >= _duration) {
      _phase = 'idle';
      _phaseStart = now;
      _duration = 0;
    }
  }

  _prevSpeaking = speaking;

  return {
    phase: _phase,
    phaseStart: _phaseStart,
    duration: _duration,
  };
}

/**
 * Multiplicative timing envelope on motion scalars only (after behavior engine).
 */
export function applyTimingToMotion(
  motion: { headNod: number; headTilt: number; openGesture: number },
  timing: TimingState,
  now: number,
): void {
  switch (timing.phase) {
    case 'idle':
      break;
    case 'anticipation':
      motion.headNod *= 1.12;
      motion.headTilt *= 1.06;
      motion.openGesture *= 1.06;
      break;
    case 'speaking':
      break;
    case 'settling': {
      const dur = timing.duration > 0 ? timing.duration : 1;
      const t = Math.min(1, Math.max(0, (now - timing.phaseStart) / dur));
      const falloff = 1 - 0.62 * _smoothstep(t);
      motion.headNod *= falloff;
      motion.headTilt *= falloff;
      motion.openGesture *= falloff;
      break;
    }
    default:
      break;
  }
}
