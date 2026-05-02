/**
 * Production/runtime lip-sync + TTS health checks.
 * Console: `await window.__cogniLipSyncValidateBurst()` after `await window.__cogniSpeakWithTTS('…')`
 */
import type { CogniLipSyncProbe } from '@/app/avatar-agent/LipSyncManager';
import { readLipSyncProbeFromWindow } from '@/app/avatar-agent/motion/motionPipelineDebug';
import { peekSharedAudioContext } from '@/lib/audio/avatarAudioContext';
import { cogniMetricsMergeBurstResult } from '@/lib/observability/cogniMetrics';

export type CogniLipSyncAssertResult = {
  ok: boolean;
  failures: string[];
  probe: CogniLipSyncProbe | null;
  audioContextState: string | null;
};

/** Single-frame strict check (STEP 3 probe contract). */
export function cogniLipSyncAssertOnce(): CogniLipSyncAssertResult {
  const failures: string[] = [];
  const probe = readLipSyncProbeFromWindow();
  let ctx: AudioContext | null = null;
  try {
    ctx = peekSharedAudioContext();
  } catch {
    ctx = null;
  }
  const audioContextState = ctx?.state ?? null;

  if (!probe) {
    failures.push('probe_null — LipSyncManager not mounted or no frame yet');
    return { ok: false, failures, probe: null, audioContextState };
  }
  if (probe.phase !== 'active') failures.push(`phase=${probe.phase} (expected active during speech)`);
  if (!probe.talking) failures.push('talking!==true — avatar:speak:start / isTalkingRef');
  if (probe.visemeCount <= 0) failures.push('visemeCount<=0 — timeline or API cues');
  if (!probe.playbackDominant)
    failures.push('playbackDominant!==true — audio paused, missing cues, or not audioReady');
  if (probe.visemePowerApplied < 0.99)
    failures.push(`visemePowerApplied=${probe.visemePowerApplied} expected ~1`);

  const t = probe.audioCurrentTime;
  if (t == null || !Number.isFinite(t)) failures.push('audioCurrentTime not finite');

  return { ok: failures.length === 0, failures, probe, audioContextState };
}

export type CogniLipSyncBurstResult = {
  ok: boolean;
  failures: string[];
  sampleCount: number;
  activeSampleCount: number;
  audioTimeDelta: number | null;
  morphPositiveFrames: number;
  strictFramePassCount: number;
  audioContextState: string | null;
  /** Last probe seen (any phase) */
  lastProbe: CogniLipSyncProbe | null;
};

/**
 * Samples `readLipSyncProbeFromWindow` over a window — proves playhead motion + morph activity.
 */
export async function cogniLipSyncValidateBurst(options?: {
  durationMs?: number;
  intervalMs?: number;
}): Promise<CogniLipSyncBurstResult> {
  const durationMs =
    typeof options?.durationMs === 'number' && options.durationMs > 100
      ? options.durationMs
      : 2400;
  const intervalMs =
    typeof options?.intervalMs === 'number' && options.intervalMs >= 50
      ? options.intervalMs
      : 120;

  let ctx: AudioContext | null = null;
  try {
    ctx = peekSharedAudioContext();
  } catch {
    ctx = null;
  }

  const samples: CogniLipSyncProbe[] = [];
  const t0 =
    typeof performance !== 'undefined' && typeof performance.now === 'function'
      ? performance.now()
      : Date.now();

  while (
    (typeof performance !== 'undefined' ? performance.now() : Date.now()) - t0 <
    durationMs
  ) {
    const p = readLipSyncProbeFromWindow();
    if (p) samples.push(p);
    await new Promise<void>((r) => setTimeout(r, intervalMs));
  }

  const failures: string[] = [];
  const active = samples.filter((s) => s.phase === 'active' && s.talking);
  if (active.length === 0) {
    failures.push(
      'no active+talking samples — start TTS first (e.g. await __cogniSpeakWithTTS("…")) and ensure avatar scene mounted',
    );
  }

  const firstT = active.find((s) => s.audioCurrentTime != null && Number.isFinite(s.audioCurrentTime))
    ?.audioCurrentTime;
  const lastT = [...active]
    .reverse()
    .find((s) => s.audioCurrentTime != null && Number.isFinite(s.audioCurrentTime))?.audioCurrentTime;
  let audioTimeDelta: number | null = null;
  if (firstT != null && lastT != null) {
    audioTimeDelta = lastT - firstT;
    if (audioTimeDelta < 0.03 && active.length >= 4)
      failures.push(
        `audioCurrentTime barely moved Δ=${audioTimeDelta.toFixed(4)} — autoplay/pause/AudioContext`,
      );
  } else if (active.length >= 2) {
    failures.push('audioCurrentTime missing on active samples');
  }

  const morphPositiveFrames = active.filter((s) => s.morphFingerprintDelta > 0).length;
  const fingerprints = active.map((s) => s.morphFingerprint);
  const fpRange =
    fingerprints.length > 0 ? Math.max(...fingerprints) - Math.min(...fingerprints) : 0;
  if (active.length >= 5 && morphPositiveFrames === 0 && fpRange < 3) {
    failures.push(
      'no morph activity: morphFingerprintDelta never >0 and fingerprint range negligible — cue/morph pipeline static',
    );
  }

  const strictFramePassCount = active.filter((s) => {
    if (s.visemeCount <= 0) return false;
    if (!s.playbackDominant) return false;
    if (s.visemePowerApplied < 0.99) return false;
    return true;
  }).length;

  const needStrict = Math.max(3, Math.floor(active.length * 0.45));
  if (active.length > 0 && strictFramePassCount < needStrict) {
    failures.push(
      `strict STEP3 frames low: ${strictFramePassCount}/${active.length} (need ~${needStrict}) — visemes, pause, or damping path`,
    );
  }

  if (ctx?.state === 'suspended' && active.length >= 3) {
    failures.push(
      'AudioContext suspended during active speech — gesture unlock/resumeSharedAudioContext',
    );
  }

  const lastProbe = samples.length > 0 ? samples[samples.length - 1]! : null;

  const ok = failures.length === 0 && active.length > 0;
  const burst = {
    ok,
    failures,
    sampleCount: samples.length,
    activeSampleCount: active.length,
    audioTimeDelta,
    morphPositiveFrames,
    strictFramePassCount,
    audioContextState: ctx?.state ?? null,
    lastProbe,
  };
  cogniMetricsMergeBurstResult({
    ok: burst.ok,
    activeSampleCount: burst.activeSampleCount,
    strictFramePassCount: burst.strictFramePassCount,
  });
  return burst;
}

export type CogniStabilitySmokeResult = {
  ok: boolean;
  failures: string[];
  turns: CogniLipSyncBurstResult[];
};

/** Two TTS invocations + burst after each — JWT + backend required. */
export async function cogniLipSyncValidateFullPipeline(options?: {
  line1?: string;
  line2?: string;
  burst?: { durationMs?: number; intervalMs?: number };
}): Promise<CogniStabilitySmokeResult> {
  if (typeof window === 'undefined') {
    return { ok: false, failures: ['no window'], turns: [] };
  }
  const speak = (
    window as Window & {
      __cogniSpeakWithTTS?: (t: string, o?: object) => Promise<unknown>;
    }
  ).__cogniSpeakWithTTS;
  if (typeof speak !== 'function') {
    return { ok: false, failures: ['__cogniSpeakWithTTS missing'], turns: [] };
  }
  const l1 = options?.line1 ?? 'Turn one production validation.';
  const l2 = options?.line2 ?? 'Turn two stability check.';
  try {
    await speak(l1, { emotion: 'neutral', emotionIntensity: 0.55 });
  } catch (e) {
    return { ok: false, failures: [`speak turn1: ${String(e)}`], turns: [] };
  }
  const t1 = await cogniLipSyncValidateBurst(options?.burst);
  try {
    await speak(l2, { emotion: 'neutral', emotionIntensity: 0.55 });
  } catch (e) {
    return {
      ok: false,
      failures: [`speak turn2: ${String(e)}`],
      turns: [t1],
    };
  }
  const t2 = await cogniLipSyncValidateBurst(options?.burst);
  const failures: string[] = [];
  if (!t1.ok) failures.push(`turn1 burst: ${t1.failures.join('; ')}`);
  if (!t2.ok) failures.push(`turn2 burst: ${t2.failures.join('; ')}`);
  return { ok: failures.length === 0, failures, turns: [t1, t2] };
}

export function installCogniAvatarRuntimeValidation(): void {
  if (typeof window === 'undefined') return;
  const w = window as unknown as Window &
    Record<
      | '__cogniLipSyncAssertOnce'
      | '__cogniLipSyncValidateBurst'
      | '__cogniLipSyncValidateFullPipeline',
      unknown
    >;
  w.__cogniLipSyncAssertOnce = cogniLipSyncAssertOnce;
  w.__cogniLipSyncValidateBurst = cogniLipSyncValidateBurst;
  w.__cogniLipSyncValidateFullPipeline = cogniLipSyncValidateFullPipeline;
}
