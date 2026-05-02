/**
 * Playback chain extensions: dynamics compression, softly gated AGC, envelope fade.
 * Inserted **once** between MediaElementSource → AnalyserNode → destination.
 */
'use client';

export function isAvatarAudioEnhancerEnabled(): boolean {
  if (typeof process === 'undefined') return true;
  return process.env.NEXT_PUBLIC_AVATAR_AUDIO_ENHANCER !== 'false';
}

export type AvatarPlaybackEnhancerHandle = {
  dispose: () => void;
};

/** Target RMS (~) after compression — gentle broadcast-style leveling */
const TARGET_RMS = 0.072;
const RMS_FLOOR = 0.004;

function clamp(x: number, a: number, b: number): number {
  return Math.max(a, Math.min(b, x));
}

/**
 * Builds: source → DynamicsCompressor → gateGain → agcGain → `[lipAnalyser]` → destination.
 * LipSync reads **lipAnalyser** after processing so mouth tracks perceived speech level.
 */
export function attachAvatarPlaybackEnhancement(
  ctx: AudioContext,
  source: MediaElementAudioSourceNode,
  lipAnalyser: AnalyserNode,
): AvatarPlaybackEnhancerHandle {
  const comp = ctx.createDynamicsCompressor();
  comp.threshold.value = -22;
  comp.knee.value = 26;
  comp.ratio.value = 3.2;
  comp.attack.value = 0.003;
  comp.release.value = 0.22;

  const gateGain = ctx.createGain();
  gateGain.gain.value = 1;

  const agcGain = ctx.createGain();
  agcGain.gain.value = 1;

  const td = new Float32Array(lipAnalyser.fftSize);
  let raf = 0;
  let agcSmooth = 1;
  let gateSmooth = 1;
  let envSmooth = 0.001;
  let logged = false;

  const tick = (): void => {
    lipAnalyser.getFloatTimeDomainData(td);
    let sum = 0;
    for (let i = 0; i < td.length; i++) sum += td[i] * td[i];
    const rms = Math.sqrt(sum / Math.max(1, td.length));

    const gateTgt = rms < RMS_FLOOR ? 0.1 : clamp(1.15 - RMS_FLOOR / (rms + 1e-5) * 0.25, 0.2, 1);
    gateSmooth += (gateTgt - gateSmooth) * 0.09;

    const rawAgc = clamp(TARGET_RMS / (rms + 1e-5), 0.45, 2.4);
    const agcTarget = rms < RMS_FLOOR ? agcSmooth * 0.92 : rawAgc;
    agcSmooth += (agcTarget - agcSmooth) * 0.07;

    const envAttack = rms > 0.012 ? Math.min(1, envSmooth + 0.12) : Math.max(0.05, envSmooth * 0.988);
    envSmooth = envAttack;

    const gateMul = clamp(gateSmooth * envSmooth, 0.05, 1);
    const agcMul = clamp(agcSmooth, 0.35, 2.25);
    const t0 = ctx.currentTime;
    try {
      gateGain.gain.setTargetAtTime(gateMul, t0, 0.035);
      agcGain.gain.setTargetAtTime(agcMul, t0, 0.045);
    } catch {
      gateGain.gain.value = gateMul;
      agcGain.gain.value = agcMul;
    }

    if (!logged && typeof console !== 'undefined' && rms > 0.018) {
      logged = true;
      // eslint-disable-next-line no-console -- validation channel (master prompt §5)
      console.log('[AUDIO ENHANCED]', { rms: Number(rms.toFixed(4)) });
    }

    raf = requestAnimationFrame(tick);
  };

  source.connect(comp);
  comp.connect(gateGain);
  gateGain.connect(agcGain);
  agcGain.connect(lipAnalyser);
  lipAnalyser.connect(ctx.destination);

  raf = requestAnimationFrame(tick);

  return {
    dispose: (): void => {
      cancelAnimationFrame(raf);
      try {
        source.disconnect(comp);
      } catch {
        /* */
      }
      try {
        comp.disconnect();
        gateGain.disconnect();
        agcGain.disconnect();
        lipAnalyser.disconnect();
      } catch {
        /* */
      }
    },
  };
}
