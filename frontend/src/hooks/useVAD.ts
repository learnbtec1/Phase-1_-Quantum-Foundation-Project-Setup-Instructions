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
import { getSharedAudioContext } from '@/lib/audio/avatarAudioContext';

export interface UseVADOptions {
  /** Called when speech segment ends; receives WAV blob. */
  onSpeechEnd?: (audio: Blob) => void;
  /** Called the instant voice activity is first detected in a segment. */
  onSpeechStart?: () => void;
  /** RMS threshold (0–1). Higher = needs louder voice; reduces breath/keyboard false triggers. Default 0.045 */
  silenceThreshold?: number;
  /** Ms of silence after last loud frame before segment end. Larger = patient with pauses. Default 1300 */
  silenceGapMs?: number;
  /**
   * Minimum span (ms) from first above-threshold frame to last loud frame in the segment.
   * Shorter = spike/noise (clicks, breath) — segment is discarded and not sent to STT. Default 280. Set 0 to disable.
   */
  minSpeechDurationMs?: number;
  /** Language hint for Web Speech fallback. Default 'ar-SA' */
  lang?: string;
}

export interface UseVADReturn {
  isRecording: boolean;
  startListening: () => Promise<void>;
  stopListening: () => void;
  /**
   * Push-to-talk: start recording (no VAD / no auto-send on silence).
   * Stop with `stopManualAndSend()` to build WAV and call `onSpeechEnd`.
   */
  startManualRecording: () => Promise<void>;
  /** End manual segment and invoke `onSpeechEnd` with encoded audio (unless cancelled via `stopListening`). */
  stopManualAndSend: () => void;
  isSupported: boolean;
  /** True if no audio input device found — stop retrying */
  micNotFound: boolean;
  /** True if user denied mic permission — stop retrying */
  permissionDenied: boolean;
  /** Reset permissionDenied state/ref so startListening() can be retried (e.g. after user grants permission in Edge/Windows settings) */
  resetPermissionDenied: () => void;
}

// ---------------------------------------------------------------------------
// Exported mic helpers — Edge-safe constraints + Brain sync (`voice:mic:stopped`)
// ---------------------------------------------------------------------------

export function dispatchMicStopped(): void {
  if (typeof window === 'undefined') return;
  window.dispatchEvent(new Event('voice:mic:stopped'));
}

/**
 * Production mic open: strict `{ channelCount + sampleRate }` first.
 * Edge: `OverconstrainedError` → single retry with `{ audio: true }` (stream kept alive).
 */
export async function getMicStreamSafe(): Promise<MediaStream> {
  try {
    return await navigator.mediaDevices.getUserMedia({
      audio: {
        channelCount: 1,
        sampleRate: { ideal: 16000 },
        echoCancellation: true,
        noiseSuppression: true,
      },
    });
  } catch (e: unknown) {
    const err = e as { name?: string };
    if (err?.name === 'OverconstrainedError' || err?.name === 'ConstraintNotSatisfiedError') {
      console.warn('[useVAD] fallback to loose constraints');
      return await navigator.mediaDevices.getUserMedia({ audio: true });
    }
    throw e;
  }
}

// ---------------------------------------------------------------------------
// Internal VAD amplitude pipeline (MediaRecorder + analyser RMS gate)
// ---------------------------------------------------------------------------

async function buildWavBlob(chunks: Blob[], sampleRate: number): Promise<Blob | null> {
  try {
    const combined = new Blob(chunks);
    const arrBuf = await combined.arrayBuffer();
    const ctx = getSharedAudioContext();
    if (!ctx) return null;
    const decoded = await ctx.decodeAudioData(arrBuf.slice(0));

    const numChannels = 1;
    const numSamples = decoded.length;
    const outRate = decoded.sampleRate || sampleRate;
    const bytesPerSample = 2;
    const bufSize = 44 + numSamples * bytesPerSample;
    const buf = new ArrayBuffer(bufSize);
    const view = new DataView(buf);

    const writeStr = (offset: number, s: string) => {
      for (let i = 0; i < s.length; i++) view.setUint8(offset + i, s.charCodeAt(i));
    };
    const byteRate = outRate * numChannels * bytesPerSample;
    writeStr(0, 'RIFF');
    view.setUint32(4, bufSize - 8, true);
    writeStr(8, 'WAVE');
    writeStr(12, 'fmt ');
    view.setUint32(16, 16, true);
    view.setUint16(20, 1, true);         // PCM
    view.setUint16(22, numChannels, true);
    view.setUint32(24, outRate, true);
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
  onSpeechStart,
  silenceThreshold = 0.045,
  silenceGapMs = 1300,
  minSpeechDurationMs = 280,
  lang = 'ar-SA',
}: UseVADOptions = {}): UseVADReturn {
  const [isRecording, setIsRecording] = useState(false);
  const [micNotFound,    setMicNotFound]    = useState(false);
  const [permissionDenied, setPermissionDenied] = useState(false);
  const micNotFoundRef      = useRef(false);
  const permissionDeniedRef = useRef(false);
  const streamRef = useRef<MediaStream | null>(null);
  const mimeTypeRef = useRef('audio/webm');
  const recorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const audioCtxRef = useRef<AudioContext | null>(null);
  const vadMediaSourceRef = useRef<MediaStreamAudioSourceNode | null>(null);
  const silenceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const rafRef = useRef<number>(0);
  const speechStartedRef = useRef(false);
  const activeRef = useRef(false);  // prevent stale closure callbacks
  // firstChunkSavedRef: the MediaRecorder EBML/WebM container header is only
  // present in the VERY FIRST ondataavailable chunk.  If we discard that chunk
  // (because speechStarted is still false), all saved chunks are header-less and
  // AudioContext.decodeAudioData + PyAV both fail → audio_too_short backend error.
  // Fix: unconditionally save the first chunk, then filter by speechStarted for
  // subsequent chunks.  Reset this flag on every recorder restart.
  const firstChunkSavedRef = useRef(false);
  // hadSpeechThisSegmentRef: distinguishes "only saved the silent header chunk"
  // from "actually recorded speech" so onstop can skip no-speech segments.
  const hadSpeechThisSegmentRef = useRef(false);
  /** Time of first above-threshold sample in current segment (performance.now). */
  const vocalStartMsRef = useRef(0);
  /** Time of most recent above-threshold sample (for min speech span). */
  const lastLoudAtMsRef = useRef(0);
  /** Push-to-talk — isolated from amplitude-VAD pipeline */
  const manualActiveRef = useRef(false);
  const manualCancelRef = useRef(false);
  const manualStreamRef = useRef<MediaStream | null>(null);
  const manualRecorderRef = useRef<MediaRecorder | null>(null);
  const manualChunksRef = useRef<Blob[]>([]);

  const isSupported =
    typeof navigator !== 'undefined' &&
    typeof window !== 'undefined' &&
    !!navigator.mediaDevices?.getUserMedia &&
    !!window.MediaRecorder;

  const stopListening = useCallback(() => {
    // Cancel push-to-talk without delivering audio
    const mRec = manualRecorderRef.current;
    if (mRec && mRec.state === 'recording') {
      manualCancelRef.current = true;
      try {
        mRec.stop();
      } catch {
        /* ignore */
      }
      // recorder.onstop clears manual* refs (avoid clearing chunks before onstop runs)
    } else {
      manualRecorderRef.current = null;
      manualStreamRef.current?.getTracks().forEach((t) => t.stop());
      manualStreamRef.current = null;
      manualChunksRef.current = [];
      manualActiveRef.current = false;
    }

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

    try {
      vadMediaSourceRef.current?.disconnect();
    } catch { /* ignore */ }
    vadMediaSourceRef.current = null;
    audioCtxRef.current = null;
    try { (window as unknown as Record<string, unknown>).__AUDIO_CTX__ = null; } catch { /* SSR */ }
    analyserRef.current = null;
    speechStartedRef.current = false;
    // Reset EBML-header and speech-gate flags so the NEXT startListening call
    // always saves the new recorder's first (header) chunk unconditionally.
    // Without this, a stop→start cycle re-introduces the audio_too_short bug.
    firstChunkSavedRef.current = false;
    hadSpeechThisSegmentRef.current = false;
    vocalStartMsRef.current = 0;
    lastLoudAtMsRef.current = 0;
    chunksRef.current = [];
    dispatchMicStopped();
  }, []);

  const startListening = useCallback(async () => {
    if (!isSupported) {
      throw new Error('[useVAD] getUserMedia / MediaRecorder not supported');
    }
    if (isRecording) return;
    if (manualActiveRef.current) {
      console.warn('[useVAD] startListening ignored — manual recording active');
      throw new Error('[useVAD] manual recording active');
    }

    if (micNotFoundRef.current || permissionDeniedRef.current) {
      console.log('[useVAD] Not retrying — previous error (micNotFound=' +
        micNotFoundRef.current + ' permissionDenied=' + permissionDeniedRef.current + ')');
      throw new Error('[useVAD] microphone blocked (not found or permission denied)');
    }

    // Defensive segment-state reset — idempotent guard against any code path
    // that calls startListening() without a prior stopListening() (e.g. HMR,
    // error recovery, or direct hook invocation in tests).
    firstChunkSavedRef.current      = false;
    hadSpeechThisSegmentRef.current = false;
    vocalStartMsRef.current         = 0;
    lastLoudAtMsRef.current         = 0;
    chunksRef.current               = [];
    speechStartedRef.current        = false;
    console.log('[useVAD] Segment state reset — starting fresh session');

    // enumerateDevices() is advisory only — browsers hide audioinput entries
    // before the user grants permission (Chrome privacy feature), so a result
    // of zero audioinput devices does NOT mean no microphone is attached.
    // We log it for diagnostics but always proceed to getUserMedia, which is
    // the authoritative check (NotFoundError = truly no device).
    try {
      const devices = await navigator.mediaDevices.enumerateDevices();
      const audioInputCount = devices.filter((d) => d.kind === 'audioinput').length;
      if (audioInputCount === 0) {
        console.warn('[useVAD] enumerateDevices() found 0 audioinput entries — may be hidden until permission granted; proceeding to getUserMedia');
      } else {
        console.log('[useVAD] Audio input devices visible:', audioInputCount);
      }
    } catch (enumErr) {
      console.warn('[useVAD] enumerateDevices() failed (will still attempt getUserMedia):', enumErr);
    }

    try {
      console.log('[useVAD] Requesting microphone...');
      const stream = await getMicStreamSafe();
      console.log('[useVAD] Microphone access granted');
      streamRef.current = stream;
      activeRef.current = true;

      // ── External track-end guard ────────────────────────────────────────────
      // If the user (or OS/browser) kills the mic outside the app's stop button,
      // the audio track fires "ended".  Without this listener the hook stays in
      // "listening" state forever and future startListening() calls are skipped.
      // We normalise the whole session to idle — no console.error, just debug.
      for (const track of stream.getAudioTracks()) {
        track.onended = () => {
          if (!activeRef.current) return;
          console.warn('[useVAD] track ended');
          activeRef.current = false;
          setIsRecording(false);
          cancelAnimationFrame(rafRef.current);
          if (silenceTimerRef.current) {
            clearTimeout(silenceTimerRef.current);
            silenceTimerRef.current = null;
          }
          streamRef.current = null;
          recorderRef.current = null;
          try {
            vadMediaSourceRef.current?.disconnect();
          } catch { /* ignore */ }
          vadMediaSourceRef.current = null;
          audioCtxRef.current = null;
          analyserRef.current = null;
          chunksRef.current = [];
          firstChunkSavedRef.current = false;
          hadSpeechThisSegmentRef.current = false;
          speechStartedRef.current = false;
          vocalStartMsRef.current = 0;
          lastLoudAtMsRef.current = 0;
          dispatchMicStopped();
        };
      }

      // Set up recorder — restart after each segment happens inside onstop only
      // (never clear chunksRef from a timer before onstop copies data — race fix).
      const mime = MediaRecorder.isTypeSupported('audio/webm;codecs=opus')
        ? 'audio/webm;codecs=opus'
        : 'audio/webm';
      mimeTypeRef.current = mime;

      const wireRecorder = (rec: MediaRecorder) => {
        rec.ondataavailable = (e) => {
          if (!activeRef.current) return;
          if (e.data.size === 0) return;
          if (!firstChunkSavedRef.current) {
            firstChunkSavedRef.current = true;
            chunksRef.current.push(e.data);
          } else if (speechStartedRef.current) {
            chunksRef.current.push(e.data);
          }
        };

        rec.onstop = async () => {
          if (!activeRef.current) return;

          const hadSpeech = hadSpeechThisSegmentRef.current;
          hadSpeechThisSegmentRef.current = false;
          vocalStartMsRef.current = 0;
          lastLoudAtMsRef.current = 0;
          const savedChunks = [...chunksRef.current];
          chunksRef.current = [];
          speechStartedRef.current = false;

          const restartSegment = () => {
            if (!activeRef.current || !streamRef.current) return;
            try {
              const newRec = new MediaRecorder(streamRef.current, {
                mimeType: mimeTypeRef.current || 'audio/webm',
              });
              recorderRef.current = newRec;
              firstChunkSavedRef.current = false;
              wireRecorder(newRec);
              newRec.start(100);
            } catch (err) {
              console.error('[useVAD] Failed to restart MediaRecorder after segment:', err);
            }
          };

          if (!hadSpeech || savedChunks.length === 0) {
            console.log('[VAD] onstop: no speech in segment — restarting recorder only');
            queueMicrotask(restartSegment);
            return;
          }

          console.log(
            `[VAD] onstop: building WAV from ${savedChunks.length} chunks (type=${savedChunks[0]?.type ?? '?'})`,
          );
          const wav = await buildWavBlob(savedChunks, 16000);
          if (wav) {
            console.log(
              `[VAD] WAV ready — invoking onSpeechEnd | size=${wav.size} bytes type=${wav.type || 'audio/wav'}`,
            );
            console.log('📦 [VAD] Speech ended - WAV blob generated, size:', wav.size);
            onSpeechEnd?.(wav);
          } else {
            const rawBlob = new Blob(savedChunks, { type: savedChunks[0]?.type ?? 'audio/webm' });
            console.warn(
              `[VAD] buildWavBlob failed — invoking onSpeechEnd with raw blob | size=${rawBlob.size} type=${rawBlob.type}`,
            );
            console.log('📦 [VAD] Speech ended - WAV blob generated, size:', rawBlob.size);
            onSpeechEnd?.(rawBlob);
          }

          queueMicrotask(restartSegment);
        };
      };

      const recorder = new MediaRecorder(stream, { mimeType: mime });
      recorderRef.current = recorder;
      chunksRef.current = [];
      wireRecorder(recorder);
      recorder.start(100);

      // Set up analyser for VAD — single shared AudioContext (do not close on stop)
      const ctx = getSharedAudioContext();
      if (!ctx) {
        throw new Error('[useVAD] getSharedAudioContext() unavailable');
      }
      void ctx.resume().catch(() => {
        console.warn('[useVAD] Shared AudioContext still suspended — mic graph may be silent until unlock');
      });
      audioCtxRef.current = ctx;
      try { (window as unknown as Record<string, unknown>).__AUDIO_CTX__ = ctx; } catch { /* SSR */ }
      try {
        vadMediaSourceRef.current?.disconnect();
      } catch { /* ignore */ }
      const source = ctx.createMediaStreamSource(stream);
      vadMediaSourceRef.current = source;
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
          const nowMs = typeof performance !== 'undefined' ? performance.now() : Date.now();
          // Log once per speech segment — only when transitioning from silence to speech
          if (!speechStartedRef.current) {
            // eslint-disable-next-line no-console
            console.log('[VAD] voice detected');
            console.log(`[useVAD] Speech Detected — Recording... (rms=${rms.toFixed(4)}, threshold=${silenceThreshold})`);
            hadSpeechThisSegmentRef.current = true;
            vocalStartMsRef.current = nowMs;
            lastLoudAtMsRef.current = nowMs;
            console.log('🎤 [VAD] Speech started - capturing audio...');
            onSpeechStart?.();
          } else {
            lastLoudAtMsRef.current = nowMs;
          }
          speechStartedRef.current = true;
          if (silenceTimerRef.current) {
            clearTimeout(silenceTimerRef.current);
            silenceTimerRef.current = null;
          }
        } else if (speechStartedRef.current && !silenceTimerRef.current) {
          silenceTimerRef.current = setTimeout(() => {
            silenceTimerRef.current = null;
            if (!activeRef.current) return;

            const minMs = Math.max(0, minSpeechDurationMs);
            if (minMs > 0 && vocalStartMsRef.current > 0) {
              const activeSpeechMs = lastLoudAtMsRef.current - vocalStartMsRef.current;
              if (activeSpeechMs < minMs) {
                console.log(
                  `[VAD] Rejecting short noise spike — activeSpeechMs=${Math.round(activeSpeechMs)} < minSpeechDurationMs=${minMs} (rms threshold=${silenceThreshold})`,
                );
                speechStartedRef.current = false;
                hadSpeechThisSegmentRef.current = false;
                vocalStartMsRef.current = 0;
                lastLoudAtMsRef.current = 0;
                const recDrop = recorderRef.current;
                if (recDrop && recDrop.state === 'recording') {
                  recDrop.stop();
                }
                return;
              }
            }

            // eslint-disable-next-line no-console
            console.log('[VAD] silence detected');
            console.log(`[VAD] Silence Detected — ending segment (gap=${silenceGapMs}ms) → stop → onstop → WAV`);
            window.dispatchEvent(new CustomEvent('cogni:user:silent'));
            const rec = recorderRef.current;
            if (rec && rec.state === 'recording') {
              rec.stop();
            }
          }, silenceGapMs);
        }
        rafRef.current = requestAnimationFrame(checkAudio);
      };
      rafRef.current = requestAnimationFrame(checkAudio);
      setIsRecording(true);
    } catch (err: unknown) {
      activeRef.current = false;
      const e = err as { name?: string; message?: string };

      if (e?.name === 'NotFoundError' || e?.message?.includes('device not found')) {
        // Handled via micNotFound state — do NOT re-throw (would spam useAgentAgent catch)
        // Use warn (not error) — no mic hardware is an expected env condition, not a code bug.
        console.warn('[useVAD] No microphone hardware found — will not retry');
        setMicNotFound(true);
        micNotFoundRef.current = true;
        return;
      } else if (e?.name === 'NotAllowedError' || e?.name === 'PermissionDeniedError') {
        // Handled via permissionDenied state — do NOT re-throw
        // Use warn (not error) — this is expected browser behaviour, not a code bug.
        console.warn('[useVAD] Microphone permission denied — showing UI banner');
        setPermissionDenied(true);
        permissionDeniedRef.current = true;
        return;
      } else if (e?.name === 'SecurityError') {
        console.error('[useVAD] SecurityError — page must be served over HTTPS or localhost');
        setPermissionDenied(true);
        permissionDeniedRef.current = true;
        return;
      }
      // Only re-throw truly unexpected errors so callers can surface them
      console.error('[useVAD] Unexpected mic error:', e?.name, e?.message);
      throw err;
    }
  }, [
    isSupported,
    isRecording,
    onSpeechEnd,
    onSpeechStart,
    silenceThreshold,
    silenceGapMs,
    minSpeechDurationMs,
  ]);

  const stopManualAndSend = useCallback(() => {
    manualCancelRef.current = false;
    const rec = manualRecorderRef.current;
    if (rec && rec.state === 'recording') {
      rec.stop();
    }
  }, []);

  const startManualRecording = useCallback(async () => {
    if (!isSupported || isRecording) return;
    if (activeRef.current) {
      console.warn('[useVAD] startManualRecording ignored — VAD listening active');
      return;
    }
    if (micNotFoundRef.current || permissionDeniedRef.current) {
      console.log('[useVAD] Manual: not retrying — micNotFound or permissionDenied');
      return;
    }

    try {
      const devices = await navigator.mediaDevices.enumerateDevices();
      const audioInputCount = devices.filter((d) => d.kind === 'audioinput').length;
      if (audioInputCount === 0) {
        console.warn('[useVAD] Manual: 0 audioinput in enumerateDevices — proceeding to getUserMedia');
      }
    } catch (enumErr) {
      console.warn('[useVAD] Manual: enumerateDevices failed:', enumErr);
    }

    try {
      console.log('[useVAD] Manual: requesting microphone...');
      const stream = await getMicStreamSafe();
      manualStreamRef.current = stream;
      manualChunksRef.current = [];
      manualCancelRef.current = false;
      manualActiveRef.current = true;

      for (const track of stream.getAudioTracks()) {
        track.onended = () => {
          if (!manualActiveRef.current) return;
          console.warn('[useVAD] track ended');
          manualCancelRef.current = true;
          try {
            manualRecorderRef.current?.stop();
          } catch {
            /* ignore */
          }
        };
      }

      const mime = MediaRecorder.isTypeSupported('audio/webm;codecs=opus')
        ? 'audio/webm;codecs=opus'
        : 'audio/webm';

      const recorder = new MediaRecorder(stream, { mimeType: mime });
      manualRecorderRef.current = recorder;

      recorder.ondataavailable = (e) => {
        if (!manualActiveRef.current) return;
        if (e.data.size > 0) manualChunksRef.current.push(e.data);
      };

      recorder.onstop = async () => {
        const cancelled = manualCancelRef.current;
        manualCancelRef.current = false;
        const chunks = [...manualChunksRef.current];
        manualChunksRef.current = [];
        manualStreamRef.current?.getTracks().forEach((t) => t.stop());
        manualStreamRef.current = null;
        manualRecorderRef.current = null;
        manualActiveRef.current = false;
        setIsRecording(false);
        dispatchMicStopped();

        if (cancelled || chunks.length === 0) {
          if (cancelled) console.log('[useVAD] Manual: cancelled — no upload');
          return;
        }

        const wav = await buildWavBlob(chunks, 16000);
        if (wav) {
          console.log(`[useVAD] Manual: WAV ready — onSpeechEnd | ${wav.size} bytes`);
          console.log('📦 [VAD] Speech ended - WAV blob generated, size:', wav.size);
          onSpeechEnd?.(wav);
        } else {
          const raw = new Blob(chunks, { type: chunks[0]?.type ?? 'audio/webm' });
          console.warn('[useVAD] Manual: buildWavBlob failed — sending raw blob');
          console.log('📦 [VAD] Speech ended - WAV blob generated, size:', raw.size);
          onSpeechEnd?.(raw);
        }
      };

      recorder.start(100);
      setIsRecording(true);
      window.dispatchEvent(new CustomEvent('voice:mic:started'));
      console.log('[useVAD] Manual: recording started');
    } catch (err: unknown) {
      manualActiveRef.current = false;
      setIsRecording(false);
      const e = err as { name?: string; message?: string };
      if (e?.name === 'NotFoundError' || e?.message?.includes('device not found')) {
        console.warn('[useVAD] Manual: no microphone');
        setMicNotFound(true);
        micNotFoundRef.current = true;
        return;
      }
      if (e?.name === 'NotAllowedError' || e?.name === 'PermissionDeniedError') {
        console.warn('[useVAD] Manual: permission denied');
        setPermissionDenied(true);
        permissionDeniedRef.current = true;
        return;
      }
      if (e?.name === 'SecurityError') {
        console.error('[useVAD] Manual: SecurityError — HTTPS or localhost required');
        setPermissionDenied(true);
        permissionDeniedRef.current = true;
        return;
      }
      console.error('[useVAD] Manual: unexpected error', e?.name, e?.message);
      throw err;
    }
  }, [isSupported, isRecording, onSpeechEnd]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      activeRef.current = false;
      stopListening();
    };
  }, [stopListening]);

  const resetPermissionDenied = useCallback(() => {
    permissionDeniedRef.current = false;
    setPermissionDenied(false);
    micNotFoundRef.current = false;
    setMicNotFound(false);
    console.log('[useVAD] resetPermissionDenied — refs cleared, ready to retry');
  }, []);

  return {
    isRecording,
    startListening,
    stopListening,
    startManualRecording,
    stopManualAndSend,
    isSupported,
    micNotFound,
    permissionDenied,
    resetPermissionDenied,
  };
}
