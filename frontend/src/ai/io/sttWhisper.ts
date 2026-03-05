/**
 * Whisper STT: record audio with MediaRecorder, send to /api/stt.
 * Use when backend Whisper is available for higher accuracy than Web Speech API.
 */
const TARGET_SAMPLE_RATE = 16000;

export interface WhisperSTTResult {
  transcript: string;
  success: boolean;
}

/**
 * Create a Whisper STT recorder. Call start() then stop() to get transcript.
 */
export function createWhisperSTT(): {
  start: () => void;
  stop: () => Promise<WhisperSTTResult>;
  isSupported: () => boolean;
  isRecording: () => boolean;
} {
  let stream: MediaStream | null = null;
  let recorder: MediaRecorder | null = null;
  let chunks: Blob[] = [];

  const isSupported = () =>
    typeof navigator !== 'undefined' &&
    !!navigator.mediaDevices?.getUserMedia &&
    !!window.MediaRecorder;

  const isRecording = () => !!recorder && recorder.state === 'recording';

  const start = async () => {
    if (!isSupported() || recorder) return;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mime = MediaRecorder.isTypeSupported('audio/webm;codecs=opus')
        ? 'audio/webm;codecs=opus'
        : 'audio/webm';
      recorder = new MediaRecorder(stream, { mimeType: mime });
      chunks = [];
      recorder.ondataavailable = (e) => {
        if (e.data.size > 0) chunks.push(e.data);
      };
      recorder.start(100);
    } catch {
      stream?.getTracks().forEach((t) => t.stop());
      stream = null;
      recorder = null;
    }
  };

  const stop = async (): Promise<WhisperSTTResult> => {
    const rec = recorder;
    if (!rec || rec.state !== 'recording') return { transcript: '', success: false };
    return new Promise((resolve) => {
      rec.onstop = async () => {
        stream?.getTracks().forEach((t) => t.stop());
        stream = null;
        const r = rec;
        recorder = null;
        if (!r || chunks.length === 0) {
          resolve({ transcript: '', success: false });
          return;
        }
        const wav = await convertChunksToWav(chunks);
        chunks = [];
        if (!wav) {
          resolve({ transcript: '', success: false });
          return;
        }
        try {
          const fd = new FormData();
          fd.append('audio', wav, 'recording.wav');
          const res = await fetch('/api/stt', { method: 'POST', body: fd });
          if (!res.ok) {
            resolve({ transcript: '', success: false });
            return;
          }
          const data = await res.json();
          const transcript = (data?.transcript ?? '').trim();
          resolve({ transcript, success: true });
        } catch {
          resolve({ transcript: '', success: false });
        }
      };
      rec.stop();
    });
  };

  return { start, stop, isSupported, isRecording };
}

async function convertChunksToWav(blobs: Blob[]): Promise<Blob | null> {
  try {
    if (blobs.length === 0) return null;
    const webmBlob = new Blob(blobs, { type: 'audio/webm' });
    const arrayBuffer = await webmBlob.arrayBuffer();
    const ctx = new AudioContext();
    const decoded = await ctx.decodeAudioData(arrayBuffer);
    await ctx.close();

    const ch = decoded.getChannelData(0);
    const sr = decoded.sampleRate;
    const mono = ch.length;
    let pcm: Int16Array;
    if (sr === TARGET_SAMPLE_RATE) {
      pcm = new Int16Array(mono);
      for (let i = 0; i < mono; i++) {
        const s = Math.max(-1, Math.min(1, ch[i]));
        pcm[i] = s < 0 ? s * 32768 : s * 32767;
      }
    } else {
      const ratio = sr / TARGET_SAMPLE_RATE;
      const outLen = Math.floor(mono / ratio);
      pcm = new Int16Array(outLen);
      for (let i = 0; i < outLen; i++) {
        const srcIdx = i * ratio;
        const idx = Math.floor(srcIdx);
        const frac = srcIdx - idx;
        const s0 = idx < mono ? ch[idx] : 0;
        const s1 = idx + 1 < mono ? ch[idx + 1] : s0;
        const s = s0 + frac * (s1 - s0);
        const clamped = Math.max(-1, Math.min(1, s));
        pcm[i] = clamped < 0 ? clamped * 32768 : clamped * 32767;
      }
    }

    const wav = pcmToWav(pcm, TARGET_SAMPLE_RATE);
    return new Blob([wav], { type: 'audio/wav' });
  } catch {
    return null;
  }
}

function pcmToWav(pcm: Int16Array, sampleRate: number): ArrayBuffer {
  const numChannels = 1;
  const bitsPerSample = 16;
  const byteRate = sampleRate * numChannels * (bitsPerSample / 8);
  const dataSize = pcm.byteLength;
  const header = new ArrayBuffer(44);
  const view = new DataView(header);
  const writeStr = (offset: number, s: string) => {
    for (let i = 0; i < s.length; i++) view.setUint8(offset + i, s.charCodeAt(i));
  };
  writeStr(0, 'RIFF');
  view.setUint32(4, 36 + dataSize, true);
  writeStr(8, 'WAVE');
  writeStr(12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, numChannels, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, byteRate, true);
  view.setUint16(32, numChannels * (bitsPerSample / 8), true);
  view.setUint16(34, bitsPerSample, true);
  writeStr(36, 'data');
  view.setUint32(40, dataSize, true);
  const out = new Uint8Array(44 + dataSize);
  out.set(new Uint8Array(header), 0);
  out.set(new Uint8Array(pcm.buffer), 44);
  return out.buffer;
}

export function isWhisperSTTSupported(): boolean {
  return typeof navigator !== 'undefined' && !!navigator.mediaDevices?.getUserMedia && !!window.MediaRecorder;
}
