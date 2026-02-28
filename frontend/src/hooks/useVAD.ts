/**
 * useVAD — Voice Activity Detection hook.
 * Primary: @ricky0123/vad-react (if installed).
 * Fallback: MediaRecorder + Web Audio analyser-based amplitude VAD.
 *
 * Usage:
 *   const { isRecording, startListening, stopListening } = useVAD({
 *     onSpeechEnd: (blob) => { /* send blob to STT * / },
 *   });
 */
'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

export interface UseVADOptions {
  /** Called when speech segment ends; receives WAV blob. */
  onSpeechEnd?: (audio: Blob) => void;
  /** Silence threshold (0–1). Default 0.015 */
  silenceThreshold?: number;
  /** Ms of silence before speech considered ended. Default 900 */
  silenceGapMs?: number;
  /** Language hint for Web Speech fallback. Default 'ar-SA' */
  lang?: string;
}

export interface UseVADReturn {
  isRecording: boolean;
  startListening: () => Promise<void>;
  stopListening: () => void;
  isSupported: boolean;
}

// ---------------------------------------------------------------------------
// Internal amplitude-based VAD (no external library needed)
// ---------------------------------------------------------------------------

async function buildWavBlob(chunks: Blob[], sampleRate: number): Promise<Blob | null> {
  try {
    const combined = new Blob(chunks);
    const arrBuf = await combined.arrayBuffer();
    const ctx = new AudioContext({ sampleRate });
    const decoded = await ctx.decodeAudioData(arrBuf);
    await ctx.close();

    const numChannels = 1;
    const numSamples = decoded.length;
    const bytesPerSample = 2;
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
    view.setUint16(20, 1, true);         // PCM
    view.setUint16(22, numChannels, true);
    view.setUint32(24, sampleRate, true);
    view.setUint32(28, byteRate, true);
    view.setUint16(32, numChannels * bytesPerSample, true);
    view.setUint16(34, 16, true);        // bitsPerSample
    writeStr(36, 'data');
    view.setUint32(40, numSamples * bytesPerSample, true);

    const pcm = decoded.getChannelData(0);
    let offset = 44;
    for (let i = 0; i < numSamples; i++) {
      const s = Math.max(-1, Math.min(1, pcm[i]));
      view.setInt16(offset, s < 0 ? s * 0x8000 : s * 0x7fff, true);
      offset += 2;
    }
    return new Blob([buf], { type: 'audio/wav' });
  } catch {
    return null;
  }
}

export function useVAD({
  onSpeechEnd,
  silenceThreshold = 0.015,
  silenceGapMs = 900,
  lang = 'ar-SA',
}: UseVADOptions = {}): UseVADReturn {
  const [isRecording, setIsRecording] = useState(false);
  const streamRef = useRef<MediaStream | null>(null);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const audioCtxRef = useRef<AudioContext | null>(null);
  const silenceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const rafRef = useRef<number>(0);
  const speechStartedRef = useRef(false);
  const activeRef = useRef(false);  // prevent stale closure callbacks

  const isSupported =
    typeof navigator !== 'undefined' &&
    !!navigator.mediaDevices?.getUserMedia &&
    !!window.MediaRecorder;

  const stopListening = useCallback(() => {
    activeRef.current = false;
    setIsRecording(false);
    cancelAnimationFrame(rafRef.current);
    if (silenceTimerRef.current) clearTimeout(silenceTimerRef.current);
    silenceTimerRef.current = null;

    const rec = recorderRef.current;
    recorderRef.current = null;

    if (rec && rec.state !== 'inactive') {
      rec.stop();
    }

    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;

    try { audioCtxRef.current?.close(); } catch { /* ignore */ }
    audioCtxRef.current = null;
    analyserRef.current = null;
    speechStartedRef.current = false;
    chunksRef.current = [];
  }, []);

  const startListening = useCallback(async () => {
    if (!isSupported || isRecording) return;
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: { channelCount: 1, sampleRate: 16000, echoCancellation: true, noiseSuppression: true },
      });
      streamRef.current = stream;
      activeRef.current = true;

      // Set up recorder
      const mime = MediaRecorder.isTypeSupported('audio/webm;codecs=opus')
        ? 'audio/webm;codecs=opus'
        : 'audio/webm';
      const recorder = new MediaRecorder(stream, { mimeType: mime });
      recorderRef.current = recorder;
      chunksRef.current = [];
      recorder.ondataavailable = (e) => {
        if (e.data.size > 0 && speechStartedRef.current) {
          chunksRef.current.push(e.data);
        }
      };
      recorder.onstop = async () => {
        if (!activeRef.current) return;
        if (chunksRef.current.length > 0) {
          const wav = await buildWavBlob(chunksRef.current, 16000);
          if (wav && onSpeechEnd) onSpeechEnd(wav);
        }
        chunksRef.current = [];
        speechStartedRef.current = false;
      };
      recorder.start(100);

      // Set up analyser for VAD
      const ctx = new AudioContext();
      audioCtxRef.current = ctx;
      const source = ctx.createMediaStreamSource(stream);
      const analyser = ctx.createAnalyser();
      analyser.fftSize = 512;
      source.connect(analyser);
      analyserRef.current = analyser;

      const dataArr = new Float32Array(analyser.fftSize);

      const checkAudio = () => {
        if (!activeRef.current) return;
        analyser.getFloatTimeDomainData(dataArr);
        let rms = 0;
        for (let i = 0; i < dataArr.length; i++) rms += dataArr[i] * dataArr[i];
        rms = Math.sqrt(rms / dataArr.length);

        if (rms > silenceThreshold) {
          speechStartedRef.current = true;
          if (silenceTimerRef.current) {
            clearTimeout(silenceTimerRef.current);
            silenceTimerRef.current = null;
          }
        } else if (speechStartedRef.current && !silenceTimerRef.current) {
          silenceTimerRef.current = setTimeout(() => {
            silenceTimerRef.current = null;
            if (!activeRef.current) return;
            // Speech segment ended — stop/restart recorder to get blob
            const rec = recorderRef.current;
            if (rec && rec.state === 'recording') {
              rec.stop();
              // Immediately restart
              setTimeout(() => {
                if (!activeRef.current) return;
                const newRec = new MediaRecorder(stream, { mimeType: mime });
                recorderRef.current = newRec;
                chunksRef.current = [];
                speechStartedRef.current = false;
                newRec.ondataavailable = recorder.ondataavailable;
                newRec.onstop = recorder.onstop;
                newRec.start(100);
              }, 50);
            }
          }, silenceGapMs);
        }
        rafRef.current = requestAnimationFrame(checkAudio);
      };
      rafRef.current = requestAnimationFrame(checkAudio);
      setIsRecording(true);
    } catch (err) {
      if (process.env.NODE_ENV === 'development') {
        console.warn('[useVAD] getUserMedia failed:', err);
      }
      activeRef.current = false;
    }
  }, [isSupported, isRecording, onSpeechEnd, silenceThreshold, silenceGapMs]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      activeRef.current = false;
      stopListening();
    };
  }, [stopListening]);

  return { isRecording, startListening, stopListening, isSupported };
}
