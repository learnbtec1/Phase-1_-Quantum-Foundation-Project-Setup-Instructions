/**
 * Level 6.2 — Align subtle head / gaze / micro-motion with speech lifecycle.
 */

export type SpeechCouplingPhase =
  | 'pre_speech'
  | 'speech_start'
  | 'speech_mid'
  | 'speech_end';

export function applySpeechCouplingPhase(phase: SpeechCouplingPhase): void {
  if (typeof window === 'undefined') return;

  switch (phase) {
    case 'pre_speech':
      window.dispatchEvent(
        new CustomEvent('avatar:headpose', {
          detail: { pitch: 0.08, yaw: 0, durationMs: 900 },
        }),
      );
      window.dispatchEvent(
        new CustomEvent('avatar:gaze', {
          detail: { yaw: 0.05, pitch: -0.03, durationMs: 1100 },
        }),
      );
      break;

    case 'speech_start':
      window.dispatchEvent(
        new CustomEvent('avatar:gaze', {
          detail: { yaw: 0.03, pitch: -0.02, durationMs: 1400 },
        }),
      );
      break;

    case 'speech_mid':
      window.dispatchEvent(
        new CustomEvent('avatar:micro:gesture', {
          detail: { kind: 'lean_in', durationMs: 420 },
        }),
      );
      window.dispatchEvent(
        new CustomEvent('avatar:speech:emphasis', { detail: { kind: 'eyebrow' } }),
      );
      break;

    case 'speech_end':
      window.dispatchEvent(
        new CustomEvent('avatar:headpose', {
          detail: { pitch: -0.05, yaw: 0.03, durationMs: 750 },
        }),
      );
      window.dispatchEvent(
        new CustomEvent('avatar:gaze', {
          detail: { yaw: -0.02, pitch: 0.04, durationMs: 900 },
        }),
      );
      break;

    default:
      break;
  }
}
