/**
 * micManager.ts — Singleton microphone stream manager.
 *
 * Guarantees:
 *   • Only one getUserMedia request in-flight at a time (deduplicates concurrent callers).
 *   • Keeps the live stream; avoids re-requesting while tracks are still alive.
 *   • Exposes `__MIC_ACTIVE__` on window for debug / guard checks.
 *   • Auto-reopens on device-change (call onDeviceChangeReopen() once at mount).
 */

let micStream: MediaStream | null = null;
let startPromise: Promise<MediaStream> | null = null;
let lastError: unknown = null;

type StartOpts = {
  sampleRate?: number;
  echoCancellation?: boolean;
  noiseSuppression?: boolean;
  autoGainControl?: boolean;
  deviceId?: string;
};

function setFlag(on: boolean): void {
  try { (window as unknown as Record<string, unknown>).__MIC_ACTIVE__ = on; } catch { /* SSR */ }
}

export async function ensureMicOpen(opts: StartOpts = {}): Promise<MediaStream> {
  // Already have a live stream — reuse it.
  if (micStream && micStream.getTracks().some(t => t.readyState === 'live')) {
    setFlag(true);
    return micStream;
  }

  // Another caller is already requesting — piggy-back on that promise.
  if (startPromise) return startPromise;

  const {
    sampleRate      = 48000,
    echoCancellation = true,
    noiseSuppression = true,
    autoGainControl  = false,
    deviceId,
  } = opts;

  const constraints: MediaStreamConstraints = {
    audio: {
      channelCount:     1,
      sampleRate,
      sampleSize:       16,
      echoCancellation,
      noiseSuppression,
      autoGainControl,
      ...(deviceId ? { deviceId: { exact: deviceId } } : {}),
    },
    video: false,
  };

  startPromise = navigator.mediaDevices
    .getUserMedia(constraints)
    .then((s) => {
      micStream = s;
      lastError = null;
      setFlag(true);
      s.getAudioTracks().forEach(t =>
        t.addEventListener('ended', () => { micStream = null; setFlag(false); }),
      );
      return s;
    })
    .catch((err: unknown) => {
      lastError  = err;
      micStream  = null;
      setFlag(false);
      throw err;
    })
    .finally(() => { startPromise = null; });

  return startPromise;
}

export function getMic(): MediaStream | null { return micStream; }
export function getMicLastError(): unknown   { return lastError; }

export function closeMic(): void {
  try { micStream?.getTracks().forEach(t => t.stop()); } catch { /* ignore */ }
  micStream = null;
  setFlag(false);
}

/** Pick the best available audio-input device. Falls back to the first device. */
export async function pickPreferredInputId(): Promise<string | undefined> {
  const devs   = await navigator.mediaDevices.enumerateDevices();
  const inputs = devs.filter(d => d.kind === 'audioinput');
  const prefer =
    inputs.find(d => d.label?.toLowerCase().startsWith('default -')) ??
    inputs.find(d => d.label?.toLowerCase().startsWith('communications -')) ??
    inputs[0];
  return prefer?.deviceId;
}

/**
 * Register a one-time devicechange listener that auto-reopens the mic
 * when a new audio device is connected.
 */
export function onDeviceChangeReopen(delayMs = 800): void {
  navigator.mediaDevices?.addEventListener?.('devicechange', () => {
    setTimeout(() => {
      if (!micStream) ensureMicOpen().catch(() => {/* handled by caller */});
    }, delayMs);
  });
}
