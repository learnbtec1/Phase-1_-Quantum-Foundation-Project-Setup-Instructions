'use client';

/**
 * DevLogFilter — suppress known-noisy AudioContext browser warnings in development.
 *
 * This ONLY filters messages that match the exact known-noisy patterns from
 * the WebAudio / MediaDevices subsystem. It does NOT suppress React errors,
 * Next.js build errors, or any application-level error.logs.
 */
if (process.env.NODE_ENV === 'development' && typeof window !== 'undefined') {
  const NOISY = /(The AudioContext encountered an error from the audio device|decodeAudioData failed|AudioContext was not allowed to start|No microphone hardware found|لم أسمع شيئاً)/i;
  const origError = console.error.bind(console);
  console.error = (...args: unknown[]): void => {
    const first = (args[0] ?? '') + '';
    if (NOISY.test(first)) return; // Known WebAudio noise — suppress only in dev
    origError(...args);
  };
}

export default function DevLogFilter(): null { return null; }
