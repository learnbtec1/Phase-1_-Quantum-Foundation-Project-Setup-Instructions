/**
 * [PHASE1] STT Manager — Web Speech API primary, MediaRecorder+Whisper fallback.
 *
 * Events dispatched on `window`:
 *   - `avatar:listening`   { detail: { active: boolean } }
 *   - `avatar:transcript`  { detail: { text: string; isFinal: boolean } }
 *
 * Usage:
 *   startListening({ onInterim, onFinal, onError })
 *   stopListening()
 *   isListeningNow()
 */

'use client';

import { stopTTS } from '@/ai/io/tts';

// ─── Type shims (Web Speech API — may not be in tsconfig lib) ────────────────
/* eslint-disable @typescript-eslint/no-explicit-any */
type SpeechRecognitionInstance    = any;
type SpeechRecognitionCtor        = new () => SpeechRecognitionInstance;
type SpeechRecognitionEventAny    = any;
type SpeechRecognitionErrorEventAny = any;
/* eslint-enable @typescript-eslint/no-explicit-any */

function getSpeechRecognitionCtor(): SpeechRecognitionCtor | null {
  if (typeof window === 'undefined') return null;
  return (
    (window as unknown as { SpeechRecognition?: SpeechRecognitionCtor }).SpeechRecognition ??
    (window as unknown as { webkitSpeechRecognition?: SpeechRecognitionCtor }).webkitSpeechRecognition ??
    null
  );
}

export interface STTOptions {
  onInterim?: (text: string) => void;
  onFinal:    (text: string) => void;
  onError?:   (msg: string)  => void;
}

// ─── Module-level state ───────────────────────────────────────────────────────
let _recognition: SpeechRecognitionInstance | null = null;
let _mediaRecorder: MediaRecorder    | null = null;
let _listening = false;

function _emitListening(active: boolean): void {
  _listening = active;
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent('avatar:listening', { detail: { active } }));
  }
  console.log(`%c[PHASE1] STT listening: ${active}`, 'color:#a78bfa;font-weight:bold');
}

function _emitTranscript(text: string, isFinal: boolean): void {
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent('avatar:transcript', { detail: { text, isFinal } }));
  }
}

// ─── Public API ───────────────────────────────────────────────────────────────

/** Returns true if Web Speech API is available in this browser. */
export function initSTT(): boolean {
  return getSpeechRecognitionCtor() !== null;
}

/** Returns whether STT is actively listening. */
export function isListeningNow(): boolean {
  return _listening;
}

/** Stop any active STT session immediately. */
export function stopListening(): void {
  if (_recognition) {
    try { _recognition.abort(); } catch { /* ignore */ }
    _recognition = null;
  }
  if (_mediaRecorder) {
    try { _mediaRecorder.stop(); } catch { /* ignore */ }
    _mediaRecorder = null;
  }
  if (_listening) _emitListening(false);
}

/**
 * Start listening. Tries Web Speech API first; falls back to
 * MediaRecorder → /api/stt (Whisper) when Web Speech is unavailable.
 */
export function startListening(opts: STTOptions): void {
  if (_listening) stopListening();

  const Ctor = getSpeechRecognitionCtor();

  if (Ctor) {
    _startWebSpeech(Ctor, opts);
  } else {
    console.log('%c[PHASE1] Web Speech unavailable → using MediaRecorder fallback', 'color:#fb923c');
    _startMediaRecorder(opts).catch((err) => {
      opts.onError?.(`[PHASE1] MediaRecorder init failed: ${err}`);
      _emitListening(false);
    });
  }
}

// ─── Web Speech path ──────────────────────────────────────────────────────────

function _startWebSpeech(Ctor: SpeechRecognitionCtor, opts: STTOptions): void {
  const r: SpeechRecognitionInstance = new Ctor();
  r.lang            = 'ar-SA';
  r.continuous      = false;
  r.interimResults  = true;
  r.maxAlternatives = 1;

  r.onstart = () => {
    console.log('%c[PHASE1] Web Speech started', 'color:#4ade80');
    _emitListening(true);
  };

  let _bargedIn = false;
  r.onresult = (ev: SpeechRecognitionEventAny) => {
    const result    = ev.results[ev.results.length - 1];
    const text      = result[0].transcript.trim();
    const isFinal   = result.isFinal;
    // Phase 8: barge-in — interrupt TTS on first detected word
    if (!_bargedIn) { _bargedIn = true; stopTTS(); }
    _emitTranscript(text, isFinal);
    if (isFinal) {
      opts.onFinal(text);
    } else {
      opts.onInterim?.(text);
    }
  };

  r.onerror = (ev: SpeechRecognitionErrorEventAny) => {
    const msg = ev.error;
    console.warn('[PHASE1] Web Speech error:', msg);
    opts.onError?.(msg);
    _emitListening(false);
    _recognition = null;
  };

  r.onend = () => {
    if (_listening) _emitListening(false);
    _recognition = null;
  };

  _recognition = r;
  try {
    r.start();
  } catch (err) {
    console.error('[PHASE1] Web Speech start failed:', err);
    _recognition = null;
    opts.onError?.(String(err));
  }
}

// ─── MediaRecorder path (Whisper fallback) ───────────────────────────────────

const VAD_SILENCE_MS  = 1500;   // stop recording after this much silence
const VAD_ENERGY_THRESHOLD = 0.015;
const CHUNK_INTERVAL_MS    = 100;

async function _startMediaRecorder(opts: STTOptions): Promise<void> {
  const stream = await navigator.mediaDevices.getUserMedia({ audio: true });

  // Energy VAD via AnalyserNode
  const ctx     = new AudioContext();
  const source  = ctx.createMediaStreamSource(stream);
  const analyser = ctx.createAnalyser();
  analyser.fftSize = 512;
  source.connect(analyser);
  const buf = new Float32Array(analyser.fftSize);

  const recorder = new MediaRecorder(stream, { mimeType: _pickMime() });
  _mediaRecorder  = recorder;
  const chunks: Blob[] = [];

  recorder.ondataavailable = (e) => { if (e.data.size > 0) chunks.push(e.data); };

  let silenceTimer: ReturnType<typeof setTimeout> | null = null;
  let started = false;

  const checkEnergy = () => {
    if (!_listening) return;
    analyser.getFloatTimeDomainData(buf);
    const rms = Math.sqrt(buf.reduce((s, v) => s + v * v, 0) / buf.length);

    if (rms > VAD_ENERGY_THRESHOLD) {
      if (silenceTimer) { clearTimeout(silenceTimer); silenceTimer = null; }
      if (!started) {
        started = true;
        stopTTS(); // Phase 8: barge-in — interrupt avatar speech
        console.log('%c[PHASE1] VAD: speech detected', 'color:#4ade80');
      }
    } else if (started) {
      silenceTimer ??= setTimeout(() => {
        console.log('%c[PHASE1] VAD: silence — stopping', 'color:#94a3b8');
        recorder.stop();
      }, VAD_SILENCE_MS);
    }
    setTimeout(checkEnergy, CHUNK_INTERVAL_MS);
  };

  recorder.onstart = () => {
    _emitListening(true);
    console.log('%c[PHASE1] MediaRecorder started', 'color:#4ade80');
    checkEnergy();
  };

  recorder.onstop = async () => {
    _emitListening(false);
    _mediaRecorder = null;
    stream.getTracks().forEach((t) => t.stop());
    try { ctx.close(); } catch { /* ignore */ }

    if (chunks.length === 0) {
      opts.onError?.('[PHASE1] No audio captured');
      return;
    }

    const blob = new Blob(chunks, { type: chunks[0].type || 'audio/webm' });
    console.log('%c[PHASE1] Sending to /api/stt…', 'color:#60a5fa');

    const fd = new FormData();
    fd.append('audio', blob, 'recording.wav');

    try {
      const res = await fetch('/api/stt', { method: 'POST', body: fd });
      const data = (await res.json()) as { transcript?: string; error?: string };
      const transcript = (data.transcript ?? '').trim();
      if (transcript) {
        _emitTranscript(transcript, true);
        opts.onFinal(transcript);
      } else {
        opts.onError?.(data.error ?? '[PHASE1] Empty transcript');
      }
    } catch (err) {
      opts.onError?.(`[PHASE1] /api/stt request failed: ${err}`);
    }
  };

  recorder.start(CHUNK_INTERVAL_MS);
}

function _pickMime(): string {
  const candidates = ['audio/webm;codecs=opus', 'audio/webm', 'audio/ogg;codecs=opus', 'audio/mp4'];
  for (const m of candidates) {
    if (typeof MediaRecorder !== 'undefined' && MediaRecorder.isTypeSupported(m)) return m;
  }
  return '';
}
