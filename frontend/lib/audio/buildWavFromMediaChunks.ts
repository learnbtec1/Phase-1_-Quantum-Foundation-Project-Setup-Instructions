/**
 * Build mono 16-bit PCM WAV @ targetSampleRate (default 16 kHz) from MediaRecorder WebM/Opus chunks.
 * Uses decodeAudioData + OfflineAudioContext resampling — avoids relying on backend ffmpeg for Opus.
 */
'use client';

import { getSharedAudioContext } from '@/lib/audio/avatarAudioContext';

function mixToMono(decoded: AudioBuffer): Float32Array {
  const len = decoded.length;
  const nch = decoded.numberOfChannels;
  if (nch === 1) return decoded.getChannelData(0).slice();
  const out = new Float32Array(len);
  const inv = 1 / nch;
  for (let c = 0; c < nch; c++) {
    const ch = decoded.getChannelData(c);
    for (let i = 0; i < len; i++) out[i] += ch[i] * inv;
  }
  return out;
}

async function resampleMonoToRate(
  mono: Float32Array,
  sourceRate: number,
  targetRate: number,
): Promise<Float32Array> {
  if (Math.abs(sourceRate - targetRate) < 0.5 || mono.length === 0) {
    return mono;
  }
  const durationSec = mono.length / sourceRate;
  const lengthOut = Math.max(1, Math.ceil(durationSec * targetRate));
  const offline = new OfflineAudioContext(1, lengthOut, targetRate);
  const buf = offline.createBuffer(1, mono.length, sourceRate);
  buf.getChannelData(0).set(mono);
  const src = offline.createBufferSource();
  src.buffer = buf;
  src.connect(offline.destination);
  src.start(0);
  const rendered = await offline.startRendering();
  return rendered.getChannelData(0).slice();
}

function encodeWavFloat32MonoPcm16(mono: Float32Array, sampleRate: number): Blob {
  const numChannels = 1;
  const bytesPerSample = 2;
  const numSamples = mono.length;
  const bufSize = 44 + numSamples * bytesPerSample;
  const buf = new ArrayBuffer(bufSize);
  const view = new DataView(buf);
  const writeStr = (offset: number, s: string) => {
    for (let i = 0; i < s.length; i++) view.setUint8(offset + i, s.charCodeAt(i));
  };
  const byteRate = sampleRate * numChannels * bytesPerSample;
  writeStr(0, 'RIFF');
  view.setUint32(4, bufSize - 8, true);
  writeStr(8, 'WAVE');
  writeStr(12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, numChannels, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, byteRate, true);
  view.setUint16(32, numChannels * bytesPerSample, true);
  view.setUint16(34, 16, true);
  writeStr(36, 'data');
  view.setUint32(40, numSamples * bytesPerSample, true);
  let offset = 44;
  for (let i = 0; i < numSamples; i++) {
    const s = Math.max(-1, Math.min(1, mono[i]));
    view.setInt16(offset, s < 0 ? s * 0x8000 : s * 0x7fff, true);
    offset += 2;
  }
  return new Blob([buf], { type: 'audio/wav' });
}

/**
 * Decode WebM/Opus (or other browser-supported container) chunks to WAV PCM16 mono @ targetSampleRate.
 */
export async function buildWavBlobFromMediaChunks(
  chunks: Blob[],
  targetSampleRate = 16000,
): Promise<Blob | null> {
  if (!chunks.length) return null;
  const combined = new Blob(chunks);
  if (combined.size < 32) return null;

  const arrBuf = await combined.arrayBuffer();

  async function tryDecode(ctx: AudioContext | OfflineAudioContext): Promise<AudioBuffer | null> {
    try {
      return await ctx.decodeAudioData(arrBuf.slice(0));
    } catch {
      return null;
    }
  }

  let decoded: AudioBuffer | null = null;
  const shared = getSharedAudioContext();
  if (shared) {
    decoded = await tryDecode(shared);
  }
  if (!decoded) {
    try {
      const tmp = new AudioContext();
      decoded = await tryDecode(tmp);
      await tmp.close().catch(() => {});
    } catch (e) {
      if (process.env.NODE_ENV === 'development') {
        console.warn('[buildWavFromMediaChunks] decodeAudioData failed (fallback AudioContext):', e);
      }
    }
  }
  if (!decoded || decoded.length === 0) {
    if (process.env.NODE_ENV === 'development') {
      console.warn('[buildWavFromMediaChunks] decodeAudioData returned empty — chunks may be incomplete WebM');
    }
    return null;
  }

  let mono = mixToMono(decoded);
  const srcRate = decoded.sampleRate;
  mono = await resampleMonoToRate(mono, srcRate, targetSampleRate);
  return encodeWavFloat32MonoPcm16(mono, targetSampleRate);
}
