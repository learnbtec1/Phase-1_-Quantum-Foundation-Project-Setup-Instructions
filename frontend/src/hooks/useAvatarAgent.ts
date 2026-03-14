/**
 * useAvatarAgent — wires useVAD + WebSocket to the existing VRMAvatar event system.
 *
 * Architecture:
 *   Microphone → useVAD (WAV blob) → WS /ws/agent → JSON frame
 *   JSON frame dispatches custom window events that VRMAvatar.tsx already listens for:
 *     • avatar:listening  { detail: { active: boolean } }
 *     • chat:received
 *     • chat:sent
 *     • avatar:speak      { detail: { timings, sampleRate, audio } }  (from tts.ts pattern)
 *
 * For Arabic TTS (when backend returns tts_unavailable) this hook falls back to
 * the browser's Web Speech API so the avatar still lip-syncs via the existing
 * phoneme/lipsync system.
 */
'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useVAD } from '@/hooks/useVAD';
import { directFromAgentFrame } from '@/ai/avatar/director';

// ── Types ────────────────────────────────────────────────────────────────────

export interface AvatarAgentOptions {
  /** WebSocket URL — defaults to ws://localhost:8000/ws/agent */
  wsUrl?: string;
  /** Auto-reconnect on disconnect (default true) */
  autoReconnect?: boolean;
  /** Language hint for VAD / Web Speech fallback (default 'ar-SA') */
  lang?: string;
}

export interface AvatarAgentState {
  isListening: boolean;
  isConnected: boolean;
  isProcessing: boolean;
  /** True between VAD send and Whisper returning the transcript. */
  isTranscribing: boolean;
  lastTranscript: string;
  lastReply: string;
  lastDialogue: string;
  emotion: string;
  error: string | null;
  startListening: () => Promise<void>;
  stopListening: () => void;
  /** Toggle mic on/off — preferred over start/stop for button binding. */
  toggleListening: () => Promise<void>;
  sendText: (text: string) => void;
  clearHistory: () => void;
}

// ── Helper: dispatch a listening-state change ─────────────────────────────

function emitListening(active: boolean) {
  if (typeof window === 'undefined') return;
  window.dispatchEvent(
    new CustomEvent('avatar:listening', { detail: { active } })
  );
}

// ── Helper: fast Arabic-character detection ───────────────────────────────────

const HAS_ARABIC = (s: string) => /[\u0600-\u06FF]/.test(s);

// ── Helper: Web Speech TTS fallback ─────────────────────────────────────────

function speakWebSpeech(text: string, lang = 'ar-SA') {
  if (typeof window === 'undefined' || !('speechSynthesis' in window)) return;
  window.speechSynthesis.cancel();

  // Auto-detect effective language from the text itself to prevent mismatch
  // (e.g. Arabic text spoken by a Japanese TTS voice).
  const effectiveLang = lang || (HAS_ARABIC(text) ? 'ar-SA' : 'en-US');
  const langBase = effectiveLang.split('-')[0];

  let spoken = false;
  const doSpeak = () => {
    if (spoken) return;
    spoken = true;
    const voices = window.speechSynthesis.getVoices();
    const preferred =
      voices.find(v => v.lang === effectiveLang) ??
      voices.find(v => v.lang.startsWith(langBase)) ??
      null;

    if (!preferred && voices.length > 0) {
      // No matching voice — using browser default risks playing in wrong language
      // (e.g. Japanese on Japanese Windows). Skip audio; avatar animations still fire.
      console.warn(
        '[TTS:fallback] No voice for', effectiveLang,
        '— audio skipped to avoid wrong-language TTS. Text preview:', text.slice(0, 60)
      );
      return;
    }

    const utt = new SpeechSynthesisUtterance(text);
    utt.lang = effectiveLang;
    utt.rate = 0.92;
    if (preferred) {
      utt.voice = preferred;
      console.log('[TTS:fallback] voice=', preferred.name, preferred.lang);
    }
    utt.onstart = () => {
      window.dispatchEvent(new CustomEvent('avatar:speak:start'));
    };
    utt.onend = () => {
      window.dispatchEvent(new CustomEvent('avatar:speak:end'));
    };
    utt.onerror = () => {
      window.dispatchEvent(new CustomEvent('avatar:speak:end'));
    };
    window.speechSynthesis.speak(utt);
  };

  // getVoices() returns [] until voiceschanged fires on first load
  if (window.speechSynthesis.getVoices().length > 0) {
    doSpeak();
  } else {
    window.speechSynthesis.onvoiceschanged = () => { doSpeak(); };
    // Failsafe timeout — only call doSpeak if voices have actually loaded.
    // If voices are still empty at 800ms, onvoiceschanged will eventually fire.
    // Calling doSpeak with empty voices → preferred=null → guard miss → Japanese default voice.
    setTimeout(() => {
      if (window.speechSynthesis.getVoices().length > 0) doSpeak();
    }, 800);
  }
}

/**
 * Wrap raw 16-bit mono PCM bytes (Kokoro output) in a valid WAV container.
 * Kokoro returns int16.tobytes() with NO RIFF/fmt headers — this adds them.
 */
function pcmBytesToWavBlob(pcmBytes: Uint8Array, sampleRate: number): Blob {
  const numChannels = 1;
  const bitsPerSample = 16;
  const byteRate = sampleRate * numChannels * (bitsPerSample / 8);
  const blockAlign = numChannels * (bitsPerSample / 8);
  const dataSize = pcmBytes.length;
  const bufferSize = 44 + dataSize;
  const buffer = new ArrayBuffer(bufferSize);
  const view = new DataView(buffer);
  const writeStr = (offset: number, s: string) => {
    for (let i = 0; i < s.length; i++) view.setUint8(offset + i, s.charCodeAt(i));
  };
  writeStr(0, 'RIFF');
  view.setUint32(4, bufferSize - 8, true);
  writeStr(8, 'WAVE');
  writeStr(12, 'fmt ');
  view.setUint32(16, 16, true);         // fmt chunk size
  view.setUint16(20, 1, true);          // PCM format
  view.setUint16(22, numChannels, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, byteRate, true);
  view.setUint16(32, blockAlign, true);
  view.setUint16(34, bitsPerSample, true);
  writeStr(36, 'data');
  view.setUint32(40, dataSize, true);
  new Uint8Array(buffer, 44).set(pcmBytes);
  return new Blob([buffer], { type: 'audio/wav' });
}

// ── Helper: read the most recent BTEC grade from localStorage ─────────────────
// Written by assessment/page.tsx#saveLastGrade when evaluation completes.
// Returns null if no valid grade is present (PENDING is excluded — LLM should
// not reference an in-progress evaluation as a completed one).
function readLastGrade(): { final_grade: string; subject: string; criteria_summary: string; achieved: number; total: number } | null {
  if (typeof window === 'undefined') return null;
  try {
    const raw = localStorage.getItem('nexus-last-grade');
    if (!raw) return null;
    const parsed = JSON.parse(raw) as {
      final_grade?: string; subject?: string; criteria_summary?: string;
      achieved?: number; total?: number;
    };
    if (!parsed?.final_grade || parsed.final_grade === 'PENDING') return null;
    return {
      final_grade:      parsed.final_grade,
      subject:          parsed.subject          ?? '—',
      criteria_summary: parsed.criteria_summary ?? '',
      achieved:         parsed.achieved         ?? 0,
      total:            parsed.total            ?? 0,
    };
  } catch {
    return null;
  }
}

// ── Hook ─────────────────────────────────────────────────────────────────────

export function useAvatarAgent({
  wsUrl = 'ws://localhost:8000/ws/agent',
  autoReconnect = true,
  lang = 'ar-SA',
}: AvatarAgentOptions = {}): AvatarAgentState {
  // ── State ─────────────────────────────────────────────────────────────────
  const [isConnected, setIsConnected] = useState(false);
  const [isProcessing, setIsProcessing] = useState(false);
  const [isTranscribing, setIsTranscribing] = useState(false);
  const [lastTranscript, setLastTranscript] = useState('');
  const [lastReply, setLastReply] = useState('');
  const [lastDialogue, setLastDialogue] = useState('');
  const [emotion, setEmotion] = useState('neutral');
  const [error, setError] = useState<string | null>(null);

  const wsRef = useRef<WebSocket | null>(null);
  const reconnectTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const mountedRef = useRef(true);

  // ── Audio helpers ─────────────────────────────────────────────────────────

  /** Stop currently playing audio + Web Speech and idle the avatar. */
  const stopCurrentAudio = useCallback(() => {
    const audio = currentAudioRef.current;
    if (audio) {
      try { audio.pause(); audio.currentTime = 0; } catch { /* ignore */ }
      currentAudioRef.current = null;
    }
    if (typeof window !== 'undefined') {
      if ('speechSynthesis' in window) window.speechSynthesis.cancel();
      window.dispatchEvent(new CustomEvent('avatar:stopSpeaking'));
    }
  }, []);

  /**
   * Decode a base64 raw-PCM string (Kokoro int16 mono) and play it,
   * stopping any previous audio first.
   * @param base64       Base64-encoded raw 16-bit mono PCM bytes
   * @param sampleRate   Sample rate reported by the backend (default 24000)
   * @param fallbackText If audio.play() is rejected (autoplay policy), speak this via Web Speech
   */
  const playAudioBase64 = useCallback((base64: string, sampleRate = 24000, fallbackText = '') => {
    stopCurrentAudio();
    try {
      const binary = atob(base64);
      const bytes = new Uint8Array(binary.length);
      for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
      // Kokoro returns raw int16 PCM — wrap it in a proper WAV container
      const blob = pcmBytesToWavBlob(bytes, sampleRate);
      console.log('[Audio] playing Kokoro PCM →', bytes.length, 'bytes, sampleRate=', sampleRate);
      const url = URL.createObjectURL(blob);
      const audio = new Audio(url);
      currentAudioRef.current = audio;
      const cleanup = () => {
        if (currentAudioRef.current === audio) currentAudioRef.current = null;
        URL.revokeObjectURL(url);
        if (typeof window !== 'undefined')
          window.dispatchEvent(new CustomEvent('avatar:speak:end'));
      };
      audio.addEventListener('ended', cleanup);
      audio.addEventListener('error', (e) => {
        console.error('[Audio] HTMLAudioElement error:', e);
        cleanup();
      });
      audio.play().catch((err) => {
        console.warn('[Audio] play() rejected:', err, '— falling back to Web Speech');
        cleanup();
        if (fallbackText) {
          // Use correct language: Arabic text → ar-SA, English → en-US
          speakWebSpeech(fallbackText, HAS_ARABIC(fallbackText) ? 'ar-SA' : 'en-US');
        }
      });
      if (typeof window !== 'undefined')
        window.dispatchEvent(new CustomEvent('avatar:speak:start'));
    } catch (err) {
      console.error('[Audio] playAudioBase64 decode error:', err);
      if (fallbackText) {
        speakWebSpeech(fallbackText, HAS_ARABIC(fallbackText) ? 'ar-SA' : 'en-US');
      }
    }
  }, [stopCurrentAudio, lang]);

  /**
   * Play Azure TTS MP3 bytes (base64) and wire the frame-perfect viseme timeline
   * to AvatarCanvas via the avatar:visemes:timeline + avatar:audio:element events.
   *
   * Unlike playAudioBase64 (Kokoro PCM), this path:
   *   1. Creates a plain `new Audio('data:audio/mp3;base64,...')` — no WAV wrapping.
   *   2. Dispatches avatar:visemes:timeline before playback so AvatarCanvas can
   *      pre-load the cue queue and start the binary-search lip-sync from frame 1.
   *   3. Dispatches avatar:audio:element so useFrame can poll audio.currentTime.
   */
  const playMp3Audio = useCallback((
    base64: string,
    visemeCues: Array<{ t: number; id: number }>,
    fallbackText = '',
  ) => {
    stopCurrentAudio();
    try {
      const audio = new Audio(`data:audio/mp3;base64,${base64}`);
      currentAudioRef.current = audio;
      if (typeof window !== 'undefined') {
        // 1. Pre-load viseme timeline BEFORE playback starts
        if (visemeCues.length > 0) {
          window.dispatchEvent(new CustomEvent('avatar:visemes:timeline', {
            detail: { cues: visemeCues },
          }));
        }
        // 2. Bind audio element so AvatarCanvas useFrame can poll currentTime each frame
        window.dispatchEvent(new CustomEvent('avatar:audio:element', {
          detail: { audio },
        }));
      }
      const cleanup = () => {
        if (currentAudioRef.current === audio) currentAudioRef.current = null;
        if (typeof window !== 'undefined')
          window.dispatchEvent(new CustomEvent('avatar:speak:end'));
      };
      audio.addEventListener('ended', cleanup);
      audio.addEventListener('error', (e) => {
        console.error('[Audio] MP3 error:', e);
        cleanup();
      });
      // Gap 2-A fix: dispatch speak:start ONLY when play() actually succeeds.
      // If we dispatch it before the rejection lands, the avatar starts lip-syncing
      // against viseme cues whose audio is not advancing (currentTime stays 0),
      // freezing the avatar's mouth on the first phoneme indefinitely.
      audio.play()
        .then(() => {
          if (typeof window !== 'undefined')
            window.dispatchEvent(new CustomEvent('avatar:speak:start'));
        })
        .catch((err) => {
          console.warn('[Audio] MP3 play() rejected:', err, '— falling back to Web Speech');
          cleanup();
          // Flush any pre-loaded viseme cues so the avatar's lips don't freeze
          // on cues[0] while the audio is blocked by autoplay policy.
          if (typeof window !== 'undefined')
            window.dispatchEvent(new CustomEvent('avatar:visemes:clear'));
          if (fallbackText) speakWebSpeech(fallbackText, HAS_ARABIC(fallbackText) ? 'ar-SA' : 'en-US');
        });
    } catch (err) {
      console.error('[Audio] playMp3Audio error:', err);
      if (fallbackText) speakWebSpeech(fallbackText, HAS_ARABIC(fallbackText) ? 'ar-SA' : 'en-US');
    }
  }, [stopCurrentAudio, lang]);

  // ── Audio management ──────────────────────────────────────────────────────
  // currentAudioRef tracks the HTMLAudioElement being played so we can stop
  // it before starting a new one (prevents overlapping voices).
  const currentAudioRef  = useRef<HTMLAudioElement | null>(null);
  const recordingTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // mirrors isRecording for reads inside memoised callbacks (avoids stale closure)
  const isRecordingRef   = useRef(false);

  // ── WebSocket setup ───────────────────────────────────────────────────────

  const handleMessage = useCallback((evt: MessageEvent) => {
    let frame: Record<string, unknown>;
    try {
      frame = JSON.parse(evt.data as string);
    } catch {
      return;
    }

    const type = frame.type as string;
    const audiolen = type === 'speech' ? String(frame.audio_base64 ?? '').length : 0;
    console.log('[WS] ←', type, audiolen ? `audio=${audiolen}b64chars` : '');

    if (type === 'transcribing') {
      // Whisper has received the audio and is now transcribing.
      // Drive isTranscribing true — VRMScene will show "thinking" head pose.
      setIsTranscribing(true);
      setIsProcessing(true);
      console.log('[useAvatarAgent] Transcribing…');
      if (typeof window !== 'undefined')
        window.dispatchEvent(new CustomEvent('avatar:transcribing', { detail: { active: true } }));
      if (!isRecordingRef.current) emitListening(true);
      return;
    }

    if (type === 'llm_thinking') {
      // Transcript done, LLM is now generating the reply.
      setIsTranscribing(false);
      setIsProcessing(true);
      setLastDialogue('');
      if (typeof window !== 'undefined')
        window.dispatchEvent(new CustomEvent('avatar:transcribing', { detail: { active: false } }));
      if (!isRecordingRef.current) emitListening(true);
      return;
    }

    // Whisper result arrives BEFORE the LLM reply — show it in the UI immediately.
    if (type === 'transcript') {
      const text = String(frame.text ?? '').trim();
      setIsTranscribing(false);
      if (typeof window !== 'undefined')
        window.dispatchEvent(new CustomEvent('avatar:transcribing', { detail: { active: false } }));
      if (text) {
        console.log('[useAvatarAgent] Transcript received:', text);
        setLastTranscript(text);
        if (typeof window !== 'undefined')
          window.dispatchEvent(new CustomEvent('avatar:transcript', { detail: { text } }));
      }
      return;
    }

    if (type === 'stream_token') {
      const chunk = String(frame.text ?? '');
      if (chunk) setLastDialogue(prev => prev + chunk);
      return;
    }

    if (type === 'speech') {
      setIsProcessing(false);
      setIsTranscribing(false);
      if (typeof window !== 'undefined')
        window.dispatchEvent(new CustomEvent('avatar:transcribing', { detail: { active: false } }));
      emitListening(false);
      setLastTranscript(String(frame.transcript ?? ''));
      setLastReply(String(frame.reply ?? ''));
      setLastDialogue(String(frame.dialogue ?? ''));
      setEmotion(String(frame.emotion ?? 'neutral'));
      setError(null);

      // Notify VRMAvatar that a reply was received (triggers head nod etc.)
      window.dispatchEvent(new CustomEvent('chat:received'));

      // Fire GestureEngine performance from the agent frame
      directFromAgentFrame({
        dialogue: String(frame.dialogue ?? ''),
        emotion:  String(frame.emotion  ?? 'neutral'),
        action:   String(frame.action   ?? ''),
      });

      // Don't start new audio if the user has already opened the mic
      if (isRecordingRef.current) return;

      const audiob64 = String(frame.audio_base64 ?? '');
      const audioFormat = String(frame.audio_format ?? '');
      if (audiob64) {
        const visemeCues = (frame.viseme_cues as Array<{ t: number; id: number }> | undefined) ?? [];
        if (audioFormat === 'mp3' || visemeCues.length > 0) {
          // Azure TTS — MP3 with frame-perfect viseme timeline for lip-sync
          playMp3Audio(audiob64, visemeCues, String(frame.dialogue ?? ''));
        } else {
          // Kokoro TTS — raw PCM wrapped in WAV container
          playAudioBase64(audiob64, Number(frame.sample_rate ?? 24000), String(frame.dialogue ?? ''));
        }
      } else {
        // No audio — fall back to Web Speech API
        stopCurrentAudio();
        speakWebSpeech(String(frame.dialogue ?? ''), lang);
      }
      return;
    }

    if (type === 'tts_unavailable') {
      setIsProcessing(false);
      emitListening(false);
      setLastTranscript(String(frame.transcript ?? ''));
      setLastReply(String(frame.reply ?? ''));
      setLastDialogue(String(frame.dialogue ?? ''));
      setEmotion(String(frame.emotion ?? 'neutral'));
      setError(null);

      window.dispatchEvent(new CustomEvent('chat:received'));

      // Fire GestureEngine performance (no audio but we still animate)
      directFromAgentFrame({
        dialogue: String(frame.dialogue ?? ''),
        emotion:  String(frame.emotion  ?? 'neutral'),
        action:   String(frame.action   ?? ''),
      });

      // Don't speak if user is already recording
      if (isRecordingRef.current) return;

      // Arabic text — Kokoro can't generate it; stop previous speech then use Web Speech
      stopCurrentAudio();
      speakWebSpeech(String(frame.dialogue ?? ''), lang);
      return;
    }

    if (type === 'error') {
      // Support both nested envelope { error: {...} } and legacy flat format
      const errObj = (frame.error ?? frame) as Record<string, unknown>;
      const severity = errObj.severity as string;
      const msg = String(errObj.message ?? 'Unknown error');
      setIsProcessing(false);
      if (severity !== 'warn') setError(msg);
      emitListening(false);
      return;
    }

    if (type === 'cleared' || type === 'pong') {
      // acknowledgements — no action needed
    }
  }, [lang, stopCurrentAudio, playAudioBase64, playMp3Audio]);

  const connect = useCallback(() => {
    if (!mountedRef.current) return;
    try {
      const ws = new WebSocket(wsUrl);
      // ── Identity guard against React Strict Mode double-mount echo ─────────
      // wsRef.current is set to the NEW ws immediately. Any in-flight onclose /
      // onerror from a previously-created WebSocket (now stale) will see
      // `wsRef.current !== ws` and exit silently, preventing a ghost reconnect
      // that would launch a second active connection → double audio output.
      wsRef.current = ws;

      ws.onopen = () => {
        if (!mountedRef.current || wsRef.current !== ws) { ws.close(); return; }
        setIsConnected(true);
        setError(null);
        // Keep-alive ping every 25s
        const pinger = setInterval(() => {
          if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ type: 'ping' }));
          else clearInterval(pinger);
        }, 25_000);
        (ws as unknown as Record<string, unknown>)._pinger = pinger;
      };

      ws.onmessage = (evt: MessageEvent) => {
        if (wsRef.current !== ws) return; // Stale WS1 from React Strict Mode double-mount — drop silently
        handleMessage(evt);
      };

      ws.onerror = () => {
        if (wsRef.current !== ws) return; // Stale connection — ignore
        setIsConnected(false);
      };

      ws.onclose = () => {
        if (wsRef.current !== ws) return; // Stale connection — ignore, prevent reconnect race
        const pinger = (ws as unknown as Record<string, unknown>)._pinger;
        if (pinger) clearInterval(pinger as ReturnType<typeof setInterval>);
        setIsConnected(false);
        setIsProcessing(false);
        emitListening(false);
        if (autoReconnect && mountedRef.current) {
          reconnectTimer.current = setTimeout(connect, 3_000);
        }
      };
    } catch (err) {
      setError(String(err));
    }
  }, [wsUrl, autoReconnect, handleMessage]);

  useEffect(() => {
    mountedRef.current = true;
    // Sanitize stale persona keys from prior sessions
    if (typeof window !== 'undefined') {
      const toRemove: string[] = [];
      for (let i = 0; i < localStorage.length; i++) {
        const key = localStorage.key(i);
        if (key && /furina|verona/i.test(key)) toRemove.push(key);
      }
      toRemove.forEach(k => {
        console.info('[Startup] Removed stale localStorage key:', k);
        localStorage.removeItem(k);
      });
    }
    connect();
    return () => {
      mountedRef.current = false;
      if (reconnectTimer.current) clearTimeout(reconnectTimer.current);
      if (recordingTimerRef.current) clearTimeout(recordingTimerRef.current);
      // Stop in-flight audio without dispatching window events (component is unmounting)
      const audio = currentAudioRef.current;
      if (audio) { try { audio.pause(); } catch { /* ignore */ } }
      if (typeof window !== 'undefined' && 'speechSynthesis' in window)
        window.speechSynthesis.cancel();
      // ── Critical: null wsRef BEFORE close() ───────────────────────────────
      // When ws.close() is called, ws.onclose fires asynchronously. By the time
      // it fires, if mountedRef is already true again (React Strict Mode remount),
      // it would schedule a reconnect → second connection → echo. Setting
      // wsRef.current = null first makes onclose see a stale ref and abort.
      const ws = wsRef.current;
      wsRef.current = null;
      if (ws) { try { ws.close(); } catch { /* ignore */ } }
    };
  }, [connect]);

  // ── VAD → send audio ──────────────────────────────────────────────────────

  const handleSpeechEnd = useCallback(async (blob: Blob) => {
    const ws = wsRef.current;
    if (!ws || ws.readyState !== WebSocket.OPEN) return;
    console.log('[VAD→WS] speech segment, blob=', blob.size, 'bytes');

    // Notify avatar the user has stopped speaking
    window.dispatchEvent(new CustomEvent('chat:sent'));

    try {
      // FileReader approach is safe for any blob size; btoa(String.fromCharCode(...spread))
      // throws RangeError: Maximum call stack exceeded on blobs larger than ~64 KB.
      const b64 = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve((reader.result as string).split(',')[1]);
        reader.onerror = () => reject(reader.error);
        reader.readAsDataURL(blob);
      });
      // Gap 4-A: include grade context in audio frames too so voiced queries
      // about grades are also answered with the debrief context.
      const gradeResult = readLastGrade();
      const audioPayload: Record<string, unknown> = { type: 'audio', data: b64 };
      if (gradeResult) audioPayload.grade_result = gradeResult;
      ws.send(JSON.stringify(audioPayload));
    } catch (err) {
      setError(String(err));
    }
  }, []);

  const { isRecording, startListening, stopListening } = useVAD({
    onSpeechEnd: handleSpeechEnd,
    // Sprint 3 tuning: 0.004 triggers on whisper-level speech even through
    // noise-suppression pipelines; 1500 ms gap fires fast after normal speech pauses.
    silenceThreshold: 0.004,
    silenceGapMs: 1500,
    lang,
    onSpeechStart: () => {
      // Mirror the detection event to the avatar so it can switch from
      // "listening" pose to "hearing" pose (e.g. lean forward) immediately.
      if (typeof window !== 'undefined')
        window.dispatchEvent(new CustomEvent('avatar:userSpeaking', { detail: { active: true } }));
    },
  });

  // Keep isRecordingRef in sync so handleMessage can read without stale closure
  useEffect(() => { isRecordingRef.current = isRecording; }, [isRecording]);

  /**
   * Toggle mic on/off.
   * ON  → stop avatar speech, start VAD, arm 60-second auto-stop.
   * OFF → clear timer, stop VAD (triggers onSpeechEnd which sends audio to WS).
   */
  const toggleListening = useCallback(async () => {
    if (isRecordingRef.current) {
      // Sync update: don't wait for useEffect to prevent a race where
      // a backend response arrives between stopListening() and the effect.
      isRecordingRef.current = false;
      console.log('[Mic] stopping recording');
      if (recordingTimerRef.current) {
        clearTimeout(recordingTimerRef.current);
        recordingTimerRef.current = null;
      }
      stopListening();
      emitListening(false);
    } else {
      isRecordingRef.current = true; // sync — guards handleMessage immediately
      console.log('[Mic] starting recording (silenceThreshold=0.004, silenceGapMs=1500, maxDuration=60s)');
      stopCurrentAudio(); // interrupt avatar speech immediately
      emitListening(true);
      setError(null);
      await startListening();
      // Auto-stop after 60 seconds
      recordingTimerRef.current = setTimeout(() => {
        isRecordingRef.current = false;
        console.log('[Mic] auto-stop after 60s');
        stopListening();
        emitListening(false);
        recordingTimerRef.current = null;
      }, 60_000);
    }
  }, [startListening, stopListening, stopCurrentAudio]);

  // Legacy single-action wrappers kept for API compatibility
  const wrappedStart = useCallback(async () => {
    stopCurrentAudio();
    emitListening(true);
    setError(null);
    await startListening();
  }, [startListening, stopCurrentAudio]);

  const wrappedStop = useCallback(() => {
    if (recordingTimerRef.current) {
      clearTimeout(recordingTimerRef.current);
      recordingTimerRef.current = null;
    }
    stopListening();
    emitListening(false);
  }, [stopListening]);

  // ── Send text directly ────────────────────────────────────────────────────

  const sendText = useCallback((text: string) => {
    const ws = wsRef.current;
    if (!ws || ws.readyState !== WebSocket.OPEN || !text.trim()) return;
    window.dispatchEvent(new CustomEvent('chat:sent'));
    // Gap 4-A: attach the most recent BTEC grade so the backend LLM can
    // reference it in its system prompt via the Debrief Context block.
    const gradeResult = readLastGrade();
    const payload: Record<string, unknown> = { type: 'text', message: text };
    if (gradeResult) payload.grade_result = gradeResult;
    ws.send(JSON.stringify(payload));
  }, []);

  // ── Clear server history ──────────────────────────────────────────────────

  const clearHistory = useCallback(() => {
    const ws = wsRef.current;
    if (!ws || ws.readyState !== WebSocket.OPEN) return;
    ws.send(JSON.stringify({ type: 'clear' }));
  }, []);

  return {
    isListening: isRecording,
    isConnected,
    isProcessing,
    isTranscribing,
    lastTranscript,
    lastReply,
    lastDialogue,
    emotion,
    error,
    startListening: wrappedStart,
    stopListening: wrappedStop,
    toggleListening,
    sendText,
    clearHistory,
  };
}
