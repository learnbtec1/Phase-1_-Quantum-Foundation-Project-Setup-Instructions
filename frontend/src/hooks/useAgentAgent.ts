/**
 * useAgentAgent.ts — Phase 4 Multi-Modal Autonomous Agent Hook
 *
 * Orchestrates the complete Phase 4 pipeline:
 *
 *   [Microphone] → useVAD → WebSocket → [Backend]
 *       → JSON AgentFrame → BrainStore.processFrame()
 *       → AgentDirector (gestures, expressions, head, voice)
 *       → PCM audio / Web Speech TTS
 *       → EmotionalMemoryManager (trajectory tracking)
 *
 * Key differences from useAvatarAgent:
 *   1. Drives useBrainStore.processFrame() for every AI reply, updating the
 *      full emotional state (PAD, emotionLabel, lastFrame).
 *   2. Delegates all body-language performances to AgentDirector (which
 *      reacts automatically to BrainStore subscription changes).
 *   3. Feeds EmotionalMemoryManager after each interaction for long-term
 *      trajectory tracking.
 *   4. Provides a clean sendText() API for text-only (non-VAD) input.
 *
 * Usage:
 *   const {
 *     isListening, toggleListening, sendText,
 *     isConnected, emotion, lastTranscript, lastReply, error,
 *   } = useAgentAgent();
 */
// @refresh reset
'use client';

import {
  useCallback,
  useEffect,
  useRef,
  useState,
} from 'react';
import { useVAD }                          from '@/hooks/useVAD';
import { useBrainStore }                   from '@/store/useBrainStore';
import { agentDirector }                   from '@/ai/avatar/AgentDirector';
import { emotionalMemoryManager }          from '@/ai/avatar/EmotionalMemoryManager';
import type { EmotionLabel, AgentFrame }   from '@/types/ai';
import {
  ensureMicOpen,
  onDeviceChangeReopen,
  pickPreferredInputId,
}                                          from '@/utils/micManager';
import {
  HEARTBEAT_INTERVAL_SEC,
  TTS_CIRCUIT_BREAKER_THRESHOLD,
  TTS_COOLDOWN_SEC,
  PROACTIVE_QUESTION_MS,
} from '@/config/avatar';

// ─── Public hook interface ────────────────────────────────────────────────────

export interface AgentAgentOptions {
  /** WebSocket endpoint URL. Default: ws://localhost:8000/ws/agent */
  wsUrl?:         string;
  /** Attempt automatic reconnect after disconnect. Default: true */
  autoReconnect?: boolean;
  /** BCP-47 language tag for TTS / VAD. Default: 'ar-JO' (Jordanian) */
  lang?:          string;
}

export interface AgentAgentState {
  /** True while the microphone / VAD is actively recording */
  isListening:     boolean;
  /** True while the WebSocket is in OPEN state */
  isConnected:     boolean;
  /** True while waiting for a backend reply */
  isProcessing:    boolean;
  /** True between VAD send and Whisper returning transcript (Verona "hearing") */
  isTranscribing:  boolean;
  /** Current avatar emotion label (from last speech frame) */
  emotion:         string;
  /** Last speech-to-text transcript received from the backend */
  lastTranscript:  string;
  /** Last text reply sent by the avatar */
  lastReply:       string;
  /** Raw dialogue string (same as lastReply; kept for parity with useAvatarAgent) */
  lastDialogue:    string;
  /** Last error string, or null */
  error:           string | null;
  /** True if no audio input device found (no microphone connected) */
  micNotFound:     boolean;
  /** True if user denied microphone permission */
  permissionDenied: boolean;
  /** Clear permissionDenied/micNotFound flags so the user can retry after granting permission in browser/OS settings */
  resetPermissionDenied: () => void;

  startListening:  () => Promise<void>;
  stopListening:   () => void;
  /** Toggle mic on/off — preferred for button bindings. */
  toggleListening: () => Promise<void>;
  /** Send a plain-text message (bypasses VAD). */
  sendText:        (text: string) => void;
  /** Reset all state and BrainStore memory. */
  clearHistory:    () => void;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function emitListeningEvent(active: boolean): void {
  if (typeof window === 'undefined') return;
  window.dispatchEvent(
    new CustomEvent('avatar:listening', { detail: { active } }),
  );
}

/** Detect Arabic script in a string. */
const hasArabic = (s: string): boolean => /[\u0600-\u06FF]/.test(s);

/** Read last BTEC grade from localStorage (assessment page). Fallback to sessionStorage in private mode. */
function readLastGrade(): Record<string, unknown> | null {
  if (typeof window === 'undefined') return null;
  try {
    const raw = localStorage.getItem('nexus-last-grade')
      ?? sessionStorage.getItem('nexus-last-grade');
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    if (!parsed?.final_grade || parsed.final_grade === 'PENDING') return null;
    return parsed;
  } catch {
    return null;
  }
}

/** Convert ArrayBuffer audio bytes to Base64 using browser btoa. */
function arrayBufferToBase64(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  let binary = '';
  const chunkSize = 0x8000;

  for (let i = 0; i < bytes.length; i += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunkSize));
  }

  return btoa(binary);
}

/** Convert Blob audio to Base64 using FileReader Data URL parsing. */
function blobToBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(reader.error ?? new Error('Failed to read audio blob'));
    reader.onload = () => {
      const result = reader.result;
      if (typeof result !== 'string') {
        reject(new Error('Unexpected FileReader result while converting audio blob'));
        return;
      }

      const commaIdx = result.indexOf(',');
      resolve(commaIdx >= 0 ? result.slice(commaIdx + 1) : result);
    };
    reader.readAsDataURL(blob);
  });
}

/** Accept Blob or ArrayBuffer and always return Base64 audio data. */
async function audioInputToBase64(input: Blob | ArrayBuffer): Promise<string> {
  if (input instanceof Blob) {
    return blobToBase64(input);
  }
  return arrayBufferToBase64(input);
}

/**
 * Map Verona / backend emotion string to the canonical EmotionLabel type.
 * Unknown values fall back to 'neutral'.
 */
function toEmotionLabel(raw: string): EmotionLabel {
  const MAP: Record<string, EmotionLabel> = {
    neutral:     'neutral',
    friendly:    'calm',
    thinking:    'thinking',
    encouraging: 'encouraging',
    celebrate:   'excited',
    celebration: 'excited',
    happy:       'happy',
    excited:     'excited',
    sad:         'sad',
    angry:       'angry',
    surprised:   'surprised',
    relax:       'relaxed',
    calm:        'calm',
    strict:      'attentive',
    strictEvaluation: 'attentive',
    proud:       'proud',
    curious:     'curious',
    attentive:   'attentive',
    concerned:   'concerned',
    sleepy:      'sleepy',
    bored:       'bored',
    anxious:     'anxious',
    empathetic:  'empathetic',
  };
  return MAP[raw] ?? 'neutral';
}

/**
 * Wrap raw 16-bit mono PCM bytes in a minimal WAV container for playback.
 * The Kokoro TTS backend returns int16 PCM with no RIFF header.
 */
function pcmToWavBlob(pcm: Uint8Array, sampleRate: number): Blob {
  const nCh = 1, bps = 16;
  const byteRate = sampleRate * nCh * (bps / 8);
  const buf  = new ArrayBuffer(44 + pcm.length);
  const view = new DataView(buf);
  const ws   = (o: number, s: string) => {
    for (let i = 0; i < s.length; i++) view.setUint8(o + i, s.charCodeAt(i));
  };
  ws(0, 'RIFF');  view.setUint32(4,  buf.byteLength - 8,    true);
  ws(8, 'WAVE');  ws(12, 'fmt ');
  view.setUint32(16, 16,          true); // fmt chunk size
  view.setUint16(20,  1,          true); // PCM
  view.setUint16(22, nCh,         true);
  view.setUint32(24, sampleRate,  true);
  view.setUint32(28, byteRate,    true);
  view.setUint16(32, nCh * (bps / 8), true);
  view.setUint16(34, bps,         true);
  ws(36, 'data'); view.setUint32(40, pcm.length, true);
  new Uint8Array(buf, 44).set(pcm);
  return new Blob([buf], { type: 'audio/wav' });
}

// ─── Constants ─────────────────────────────────────────────────────────────────

/** Milliseconds after WS connect before the avatar sends the welcome greeting.
 * Kept short (1 s) so the greeting fires as soon as the connection is live.
 * PROACTIVE_QUESTION_MS (30 s) is still used for re-engagement after long silence
 * inside the smartHeartbeat effect — but only when hasInitiated is still false. */
const IDLE_TIMEOUT = 1_000;
/** Generate a compact request id for WS frame correlation. */
function generateReqId(): string {
  return `r${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
}
/** System prompt the avatar sends once on WS connect (welcome greeting). */
const PROACTIVE_PROMPT =
  '[SYSTEM_EVENT: قدّم نفسك باللهجة الأردنية — ابدأ بـ "السلام عليكم"، وعرّف نفسك كـ دكتور حمزة معلم BTEC، واسأل الطالب بأسلوبك الأردني الدافئ شو يودّ يتعلم اليوم. لا تتجاوز جملتين.]';

// ─── LLM rate-limit cooldown (module-level, survives re-renders) ─────────────
/** Unix-ms timestamp after which LLM calls are allowed again. */
let __LLM_COOLDOWN_UNTIL = 0;
function isLlmCooling(): boolean { return Date.now() < __LLM_COOLDOWN_UNTIL; }
function setCooldownS(sec: number): void {
  __LLM_COOLDOWN_UNTIL = Date.now() + Math.max(1000, sec * 1000);
  console.warn('[useAgentAgent] LLM cooldown set for %.0fs', sec);
}

// ─── Hook ─────────────────────────────────────────────────────────────────────

export function useAgentAgent({
  wsUrl         = 'ws://127.0.0.1:8000/ws/agent',
  autoReconnect = true,
  lang          = 'ar-JO',   // Jordanian Arabic dialect — Dr. Hamza
}: AgentAgentOptions = {}): AgentAgentState {

  // ── React state ─────────────────────────────────────────────────────────
  const [isConnected,    setIsConnected]    = useState(false);
  const [isProcessing,   setIsProcessing]   = useState(false);
  const [isTranscribing, setIsTranscribing] = useState(false);
  const [lastTranscript, setLastTranscript] = useState('');
  const [lastReply,      setLastReply]      = useState('');
  const [lastDialogue,   setLastDialogue]   = useState('');
  const [emotion,        setEmotion]        = useState('neutral');
  const [error,          setError]          = useState<string | null>(null);
  /** True after the one-time proactive greeting has been sent this session. */
  const [hasInitiated,   setHasInitiated]   = useState(false);

  // ── Refs ─────────────────────────────────────────────────────────────────
  const wsRef              = useRef<WebSocket | null>(null);
  const reconnectTimer     = useRef<ReturnType<typeof setTimeout> | null>(null);
  const reconnectAttempts  = useRef(0);
  const mountedRef         = useRef(true);
  const currentAudioRef = useRef<HTMLAudioElement | null>(null);
  const isListeningRef  = useRef(false);
  const idleTimerRef    = useRef<ReturnType<typeof setTimeout> | null>(null);
  /** Tracks avatar-speaking state via window events — kept as a ref to avoid re-renders. */
  const isSpeakingRef   = useRef(false);
  /** Number of consecutive server heartbeat frames missed (≥ 2 → reconnect). */
  const missedHeartbeatsRef       = useRef(0);
  /** Consecutive TTS audio decode / play failures. */
  const ttsFailuresRef            = useRef(0);
  /** If > Date.now(), TTS circuit is OPEN and we skip audio playback. */
  const ttsCircuitOpenUntilRef    = useRef(0);
  /** Set true before intentional WS close to suppress auto-reconnect. */
  const wasClosedIntentionallyRef = useRef(false);  /** Consecutive tts_unavailable frames — reset to 0 on first successful audio play. */
  const ttsUnavailableRetryRef    = useRef(0);
  /** True when VAD was recording before the avatar started speaking (auto-resume flag). */
  const wasListeningBeforeAvatarRef = useRef(false);  /** Timestamp (ms) of the last “لم أسمع شيئاً” (empty_transcript) error shown in UI.
   *  Rate-limits the message to at most once every 2 s so rapid re-tries
   *  don’t flood the error banner. */
  const lastEmptyErrorMsRef = useRef(0);
  /** True when the last sendText() was a SYSTEM_EVENT (heartbeat / proactive greeting). */
  const lastSentWasGreetRef = useRef(false);

  // ── VAD (declared first — before other callbacks — to keep hook call order stable) ─
  // onSpeechEnd uses only refs + stable state setters; empty deps array is intentional.
  const onSpeechEnd = useCallback(async (blob: Blob): Promise<void> => {
    const ws = wsRef.current;
    if (!ws || ws.readyState !== WebSocket.OPEN) {
      console.warn('[useAgentAgent] WS not ready — dropping audio blob');
      return;
    }
    setIsProcessing(true);
    try {
      const audioBase64 = await audioInputToBase64(blob);

      // Schema contract: E_WS_SCHEMA — reject before touching the socket
      if (!audioBase64) {
        console.error('[useAgentAgent] E_WS_SCHEMA: audioBase64 is empty — blob may be corrupt or zero-length');
        setIsProcessing(false);
        return;
      }

      const reqId = generateReqId();
      const payload: Record<string, unknown> = { v: 1.1, id: reqId, type: 'audio', data: audioBase64 };
      const gradeResult = readLastGrade();
      if (gradeResult) payload.grade_result = gradeResult;
      ws.send(JSON.stringify(payload));
      console.log('[useAgentAgent] Sent VAD audio payload id=%s len=%d', reqId, audioBase64.length);
    } catch (e) {
      setIsProcessing(false);
      setError('Failed to encode microphone audio');
      console.error('[useAgentAgent] Audio encoding error:', e);
    }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const { isRecording, startListening: vadStart, stopListening: vadStop, micNotFound, permissionDenied, resetPermissionDenied } = useVAD({
    lang,
    onSpeechEnd,
  });

  // ── Audio ────────────────────────────────────────────────────────────────

  const stopAudio = useCallback((): void => {
    const a = currentAudioRef.current;
    if (a) {
      try { a.pause(); a.currentTime = 0; } catch { /* ignore */ }
      currentAudioRef.current = null;
    }
    if (typeof window !== 'undefined' && 'speechSynthesis' in window) {
      window.speechSynthesis.cancel();
    }
  }, []);

  /**
   * Play base64-encoded MP3 bytes (from Lahajati.ai Jordanian Arabic TTS).
   * Creates a native audio/mpeg Blob URL — no PCM wrapping needed.
   * Falls back to Web Speech on autoplay policy rejection or decode error.
   */
  const playMp3Audio = useCallback(async (
    base64:       string,
    fallbackText: string,
  ): Promise<void> => {
    stopAudio();
    try {
      const raw   = Uint8Array.from(atob(base64), c => c.charCodeAt(0));
      const blob  = new Blob([raw], { type: 'audio/mpeg' });
      const url   = URL.createObjectURL(blob);
      const audio = new Audio(url);
      currentAudioRef.current = audio;

      // Expose element for AvatarCanvas timeline sync (before play starts)
      if (typeof window !== 'undefined') {
        window.dispatchEvent(new CustomEvent('avatar:audio:element', { detail: { audio } }));
      }

      // Guard: only fall back to Web Speech if the MP3 element never actually
      // started playing.  Without this, a mid-decode onerror would fire *after*
      // audio.play() resolved, launching Web Speech while the MP3 is still audible.
      let playStarted = false;

      audio.onplay  = () => {
        playStarted = true;
        if (typeof window !== 'undefined') {
          window.dispatchEvent(new CustomEvent('avatar:speak:start'));
        }
        useBrainStore.getState().setTalking(true);
      };
      audio.onended = () => {
        URL.revokeObjectURL(url);
        currentAudioRef.current = null;
        useBrainStore.getState().setTalking(false);
        if (typeof window !== 'undefined') {
          window.dispatchEvent(new CustomEvent('avatar:speak:end'));
        }
      };
      audio.onerror = () => {
        URL.revokeObjectURL(url);
        // Only use Web Speech fallback when the audio element never started;
        // if it already started, it means the audio was partially decoded —
        // calling speakWebSpeech here would play audio twice.
        if (!playStarted) speakWebSpeech(fallbackText, lang);
      };

      await audio.play();
    } catch (err) {
      const domErr = err as DOMException;
      if (domErr?.name === 'NotAllowedError') {
        // Browser autoplay policy — play deferred to first user gesture
        console.warn('[useAgentAgent] playMp3Audio blocked by autoplay policy — will replay on first click');
        document.addEventListener('click', () => {
          currentAudioRef.current?.play().catch(() => speakWebSpeech(fallbackText, lang));
        }, { once: true });
      } else {
        console.warn('[useAgentAgent] playMp3Audio failed:', err);
        speakWebSpeech(fallbackText, lang);
      }
    }
  }, [stopAudio, lang]);

  /**
   * Decode base64-encoded raw PCM bytes (Kokoro int16 mono) and play as WAV.
   * Falls back to Web Speech on autoplay policy rejection or decode error.
   */
  const playPCMAudio = useCallback(async (
    base64:      string,
    sampleRate:  number,
    fallbackText: string,
  ): Promise<void> => {
    stopAudio();
    try {
      const raw  = Uint8Array.from(atob(base64), c => c.charCodeAt(0));
      const blob = pcmToWavBlob(raw, sampleRate);
      const url  = URL.createObjectURL(blob);
      const audio = new Audio(url);
      currentAudioRef.current = audio;

      // Guard: only fall back to Web Speech if the PCM audio element never
      // actually started playing (same pattern as playMp3Audio).
      let pcmPlayStarted = false;

      audio.onplay   = () => {
        pcmPlayStarted = true;
        if (typeof window !== 'undefined') {
          window.dispatchEvent(new CustomEvent('avatar:speak:start'));
        }
        useBrainStore.getState().setTalking(true);
        console.log('[useAgentAgent] PCM audio play:start');
      };
      audio.onended  = () => {
        URL.revokeObjectURL(url);
        currentAudioRef.current = null;
        useBrainStore.getState().setTalking(false);
        if (typeof window !== 'undefined') {
          window.dispatchEvent(new CustomEvent('avatar:speak:end'));
        }
        console.log('[useAgentAgent] PCM audio play:end');
      };
      audio.onerror  = () => {
        URL.revokeObjectURL(url);
        console.warn('[useAgentAgent] PCM audio error — falling back to Web Speech');
        if (!pcmPlayStarted) speakWebSpeech(fallbackText, lang);
      };

      await audio.play();
    } catch (err) {
      console.warn('[useAgentAgent] playPCMAudio failed:', err);
      speakWebSpeech(fallbackText, lang);
    }
  }, [stopAudio, lang]);

  // ── WebSocket frame handler ──────────────────────────────────────────────

  const handleFrame = useCallback((raw: unknown): void => {
    if (!mountedRef.current) return;
    const frame = raw as Record<string, unknown>;
    const type  = (frame.type ?? '') as string;

    console.log(`[useAgentAgent] WS frame type="${type}"`, frame);

    switch (type) {

      // ── STT transcribing (Verona "hearing") ────────────────────────────
      case 'transcribing': {
        setIsTranscribing(true);
        if (typeof window !== 'undefined') {
          window.dispatchEvent(new CustomEvent('avatar:transcribing', { detail: { active: true } }));
        }
        console.log('[useAgentAgent] Transcribing…');
        break;
      }

      // ── STT transcript ────────────────────────────────────────────────
      case 'transcript': {
        setIsTranscribing(false);
        if (typeof window !== 'undefined') {
          window.dispatchEvent(new CustomEvent('avatar:transcribing', { detail: { active: false } }));
        }
        const transcript = ((frame.text ?? frame.transcript ?? '') as string).trim();
        if (!transcript) break;
        setLastTranscript(transcript);
        useBrainStore.getState().pushTurn({ role: 'user', text: transcript });
        if (typeof window !== 'undefined') {
          window.dispatchEvent(new CustomEvent('avatar:transcript', { detail: { text: transcript } }));
        }
        console.log('[useAgentAgent] Transcript received:', transcript.slice(0, 80));
        break;
      }

      // ── Thinking indicator ────────────────────────────────────────────
      case 'llm_thinking': // backend compat alias
      case 'thinking': {
        useBrainStore.getState().setThinking(true);
        setIsProcessing(true);
        if (typeof window !== 'undefined') {
          window.dispatchEvent(
            new CustomEvent('avatar:thinking', { detail: { active: true } }),
          );
        }
        break;
      }

      // ── Speech (with or without PCM audio) ───────────────────────────
      case 'speech':
      case 'tts_unavailable': {
        const dialogue   = ((frame.dialogue ?? frame.text ?? '') as string).trim();
        const rawEmotion = ((frame.emotion  ?? 'neutral') as string).trim();
        const action     = ((frame.action   ?? '')         as string).trim();

        if (!dialogue) break;

        // Mark greeting as done when the backend-initiated welcome arrives so the
        // smart-heartbeat idle timer doesn't fire a second greeting.
        if ((frame.id as string | undefined) === 'greet_0') {
          setHasInitiated(true);
        }

        setIsProcessing(false);
        setIsTranscribing(false);
        if (typeof window !== 'undefined') {
          window.dispatchEvent(new CustomEvent('avatar:transcribing', { detail: { active: false } }));
        }
        setLastReply(dialogue);
        setLastDialogue(dialogue);
        setEmotion(rawEmotion);

        const emotionLabel = toEmotionLabel(rawEmotion);

        // 1. Update BrainStore via processFrame — drives AgentDirector subscriptions
        const agentFrame: AgentFrame = {
          text:               dialogue,
          emotion:            rawEmotion,
          gesture:            action,
          gesture_duration_ms: 1500,
          expression:         rawEmotion,
          voice:              {
            pitch: 0,
            rate:  frame.speech_rate ? (frame.speech_rate as number) : 1.0,
          },
          thinking_time_ms:   frame.thinking_ms ? (frame.thinking_ms as number) : 400,
        };
        useBrainStore.getState().processFrame(agentFrame);

        // 2. Record emotional trajectory
        const topicSnippet = dialogue.split(/\s+/).slice(0, 5).join(' ');
        emotionalMemoryManager.recordMoment(emotionLabel, `${rawEmotion}:${topicSnippet}`);

        // 3. Store avatar turn in short-term memory
        useBrainStore.getState().pushTurn({
          role:    'avatar',
          text:    dialogue,
          emotion: emotionLabel,
        });

        // 4. Audio output
        //    - MP3 from Azure TTS (audio_format=="mp3") → play as Blob URL
        //    - Legacy PCM from Kokoro → wrap in WAV and play (fallback path)
        //    - tts_unavailable or no audio → fall back to AgentDirector TTS
        //
        // Dispatch viseme timeline BEFORE audio play so AvatarCanvas has cues
        // ready the moment isTalkingRef flips true on audio.onplay.
        const visemeCues = (frame.viseme_cues ?? []) as Array<{ t: number; id: number }>;
        if (typeof window !== 'undefined' && visemeCues.length > 0) {
          window.dispatchEvent(
            new CustomEvent('avatar:visemes:timeline', { detail: { cues: visemeCues } }),
          );
          console.log(`[useAgentAgent] Dispatched ${visemeCues.length} viseme cues to canvas`);
        }

        if (type === 'speech' && frame.audio_base64) {
          const now = Date.now();
          // TTS circuit breaker: if too many consecutive audio failures, skip to text TTS
          if (ttsCircuitOpenUntilRef.current > now) {
            console.warn('[useAgentAgent] TTS circuit OPEN — falling back to AgentDirector TTS');
            agentDirector.scheduleTTS(dialogue, emotionLabel);
          } else {
            const fmt = (frame.audio_format ?? 'pcm') as string;
            const playPromise = fmt === 'mp3'
              ? playMp3Audio(frame.audio_base64 as string, dialogue)
              : playPCMAudio(frame.audio_base64 as string, (frame.sample_rate ?? 22050) as number, dialogue);
            playPromise.catch(() => {
              ttsFailuresRef.current += 1;
              if (ttsFailuresRef.current >= TTS_CIRCUIT_BREAKER_THRESHOLD) {
                ttsCircuitOpenUntilRef.current = Date.now() + TTS_COOLDOWN_SEC * 1000;
                ttsFailuresRef.current = 0;
                console.warn(
                  `[useAgentAgent] TTS circuit OPENED for ${TTS_COOLDOWN_SEC}s after ${TTS_CIRCUIT_BREAKER_THRESHOLD} failures`,
                );
              }
              agentDirector.scheduleTTS(dialogue, emotionLabel);
            }).then(() => {
              // Reset failure counter and unavailable-retry counter on success
              ttsFailuresRef.current = 0;
              ttsUnavailableRetryRef.current = 0;
            });
          }
        } else {
          // tts_unavailable: retry via AgentDirector REST TTS with jitter backoff;
          // fall directly to Web Speech after 2 consecutive backend TTS failures.
          if (type === 'tts_unavailable') {
            // ── System-greet path: retry via /api/chat for server-side WAV audio ──
            if (lastSentWasGreetRef.current) {
              lastSentWasGreetRef.current = false; // consume flag
              fetch('/api/chat', {
                method:  'POST',
                headers: { 'Content-Type': 'application/json' },
                body:    JSON.stringify({ message: dialogue || PROACTIVE_PROMPT }),
              })
                .then(r => r.json())
                .then((j: Record<string, unknown>) => {
                  const audioUrl = (j?.tts as Record<string, unknown> | undefined)?.audioUrl as string | undefined;
                  if (audioUrl) {
                    if (typeof window !== 'undefined' && 'speechSynthesis' in window) {
                      window.speechSynthesis.cancel();
                    }
                    const a = new Audio(audioUrl);
                    currentAudioRef.current = a;
                    a.onplay  = () => {
                      useBrainStore.getState().setTalking(true);
                      if (typeof window !== 'undefined') window.dispatchEvent(new CustomEvent('avatar:speak:start'));
                    };
                    a.onended = () => {
                      currentAudioRef.current = null;
                      useBrainStore.getState().setTalking(false);
                      if (typeof window !== 'undefined') window.dispatchEvent(new CustomEvent('avatar:speak:end'));
                    };
                    a.play().catch(() => speakWebSpeech(dialogue, lang));
                    console.log('[useAgentAgent] tts_unavailable+greet → served WAV from /api/chat');
                  } else {
                    speakWebSpeech(dialogue, lang);
                  }
                })
                .catch(() => speakWebSpeech(dialogue, lang));
            } else {
              ttsUnavailableRetryRef.current += 1;
              const jitterMs = 300 + Math.random() * 400; // 300–700 ms
              if (ttsUnavailableRetryRef.current > 2) {
                // Max retries exceeded — bypass REST TTS and go straight to Web Speech
                ttsUnavailableRetryRef.current = 0;
                setTimeout(() => speakWebSpeech(dialogue, lang), jitterMs);
                console.warn('[useAgentAgent] tts_unavailable x3 — falling back directly to Web Speech');
              } else {
                // Retry via AgentDirector REST TTS (it has its own Web Speech fallback)
                setTimeout(
                  () => agentDirector.scheduleTTS(dialogue, emotionLabel),
                  jitterMs,
                );
                console.warn(
                  `[useAgentAgent] tts_unavailable — retrying via AgentDirector (attempt ${ttsUnavailableRetryRef.current}/2) in ${Math.round(jitterMs)}ms`,
                );
              }
            }
          } else {
            // type === 'speech' but audio_base64 missing: delegate to AgentDirector.
            agentDirector.scheduleTTS(dialogue, emotionLabel);
          }
        }

        console.log(
          `[useAgentAgent] Speech frame — emotion="${rawEmotion}" len=${dialogue.length}`,
        );
        break;
      }

      // ── Backend error ─────────────────────────────────────────────────
      case 'error': {
        const errorObj = frame.error as Record<string, unknown> | undefined;
        const msg = ((errorObj?.message ?? frame.message ?? frame.detail ?? 'Unknown backend error') as string);        const errCode = ((errorObj?.code ?? frame.code ?? '') as string);

        // Rate-limit “لم أسمع شيئاً” (empty_transcript / no_speech_detected) to once per 2 s.
        // Rapid VAD re-tries would otherwise spam the error banner on every 900 ms cycle.
        const isEmptyTranscript = errCode === 'empty_transcript' || errCode === 'no_speech_detected';
        if (isEmptyTranscript) {
          const now = Date.now();
          if (now - lastEmptyErrorMsRef.current < 2000) {
            console.warn('[useAgentAgent] empty_transcript suppressed (rate-limit 2 s)');
            setIsProcessing(false);
            setIsTranscribing(false);
            break;
          }
          lastEmptyErrorMsRef.current = now;
        }
        setError(msg);
        setIsProcessing(false);
        setIsTranscribing(false);
        if (typeof window !== 'undefined') {
          window.dispatchEvent(new CustomEvent('avatar:transcribing', { detail: { active: false } }));
        }
        console.error('[useAgentAgent] Backend error:', msg);
        break;
      }

      // ── WS protocol heartbeat (← server sends every HEARTBEAT_INTERVAL_SEC) ──────
      case 'heartbeat': {
        // Reset missed-counter and reply with pong (v1.1: echo the server's id)
        missedHeartbeatsRef.current = 0;
        const ws = wsRef.current;
        if (ws?.readyState === WebSocket.OPEN) {
          ws.send(JSON.stringify({ v: 1.1, id: (frame.id ?? 'pong') as string, type: 'pong' }));
        }
        break;
      }

      default:
        console.warn('[useAgentAgent] Unhandled frame type:', type, '(v=' + (frame.v ?? '?') + ', id=' + (frame.id ?? '?') + ')');
    }
  }, [lang, playPCMAudio, playMp3Audio]);

  // ── WebSocket connection ───────────────────────────────────────────────────

  const connect = useCallback((): void => {
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      console.log('[useAgentAgent] Already connected, skipping new connection');
      return;
    }
    if (typeof window === 'undefined') return;

    // Close any stale/half-open connection before creating a fresh one
    if (wsRef.current) {
      try { wsRef.current.close(); } catch { /* ignore */ }
      wsRef.current = null;
    }
    wasClosedIntentionallyRef.current = false;

    console.log(`[useAgentAgent] Connecting → ${wsUrl}`);
    const ws = new WebSocket(wsUrl);
    wsRef.current = ws;

    ws.onopen = () => {
      if (!mountedRef.current) return;
      setIsConnected(true);
      setError(null);
      reconnectAttempts.current = 0;   // reset backoff counter on success
      console.log('[useAgentAgent] WS connected');
    };

    ws.onmessage = (evt: MessageEvent) => {
      if (!mountedRef.current) return;
      try {
        const data = typeof evt.data === 'string'
          ? JSON.parse(evt.data)
          : evt.data;
        handleFrame(data);
      } catch (e) {
        console.error('[useAgentAgent] JSON parse error:', e);
      }
    };

    ws.onclose = (evt: CloseEvent) => {
      if (!mountedRef.current) return;
      setIsConnected(false);
      // Code 1000 = normal closure (server shut down cleanly); 1001 = going away.
      const normal = evt.code === 1000 || evt.code === 1001;
      if (normal) {
        console.log(`[useAgentAgent] WS closed normally (code=${evt.code})`);
      } else {
        console.warn(`[useAgentAgent] WS closed unexpectedly (code=${evt.code} reason=${evt.reason || 'none'})`);
      }
      const maxRetries = 5;
      if (autoReconnect && mountedRef.current && !wasClosedIntentionallyRef.current) {
        if (reconnectAttempts.current >= maxRetries) {
          console.error(`[useAgentAgent] Max reconnect attempts (${maxRetries}) reached — giving up`);
          setError('تعذّر الاتصال بالخادم بعد عدة محاولات — يرجى إعادة تحميل الصفحة');
          return;
        }
        // Exponential back-off: 2s, 4s, 8s, 16s … capped at 30s
        reconnectAttempts.current += 1;
        const delay = Math.min(2000 * Math.pow(2, reconnectAttempts.current - 1), 30000);
        console.log(`[useAgentAgent] Reconnecting in ${delay / 1000}s (attempt ${reconnectAttempts.current}/${maxRetries})...`);
        reconnectTimer.current = setTimeout(connect, delay);
      }
    };

    ws.onerror = (evt: Event) => {
      // onerror always fires just before onclose — the useful diagnostic is in
      // onclose (code + reason).  Log as warn (not error) to avoid a red
      // stack-trace storm while the backend is starting up.
      // We do NOT call setError() here — onopen resets it to null on success.
      const url = (evt.target as WebSocket | null)?.url ?? wsUrl;
      console.warn(`[useAgentAgent] WS error on ${url} — waiting for onclose to reconnect`);
    };
  }, [wsUrl, autoReconnect, handleFrame]);

  // ── VAD integration ──────────────────────────────────────────────────────
  // onSpeechEnd + useVAD are declared at the top of the hook body (before audio/WS
  // callbacks) to guarantee identical hook call order on every render (Rules of Hooks).

  // ── Public API ────────────────────────────────────────────────────────────

  const startListening = useCallback(async (): Promise<void> => {
    if (isListeningRef.current) return;

    // Don't attempt to start if we know there's no mic or permission was denied
    if (micNotFound || permissionDenied) {
      console.log('[useAgentAgent] Cannot start listening — micNotFound=' + micNotFound + ' permissionDenied=' + permissionDenied);
      return;
    }

    isListeningRef.current = true;

    // ── Barge-in: stop avatar speech immediately when mic opens ──────────
    if (isSpeakingRef.current) {
      stopAudio();
      if (typeof window !== 'undefined') {
        window.dispatchEvent(new CustomEvent('avatar:stopSpeech'));
      }
    }

    // Interrupt any ongoing speech before listening (prevents echo)
    agentDirector.interruptSpeech();
    useBrainStore.getState().setPhysical({ isListening: true });
    emitListeningEvent(true);

    try {
      await vadStart();
      console.log('[useAgentAgent] Listening started');
    } catch (err) {
      // vadStart() only throws for truly unexpected errors — NotFoundError and
      // NotAllowedError are handled inside useVAD (sets micNotFound/permissionDenied
      // state and returns silently), so they never reach here.
      isListeningRef.current = false;
      useBrainStore.getState().setPhysical({ isListening: false });
      emitListeningEvent(false);
      setError('تعذّر تشغيل الميكروفون — تأكد من توصيل جهاز صوتي');
      console.error('[useAgentAgent] VAD start failed (unexpected):', err);
    }
  }, [vadStart]);

  const stopListening = useCallback((): void => {
    if (!isListeningRef.current) return;
    isListeningRef.current = false;

    vadStop();
    useBrainStore.getState().setPhysical({ isListening: false });
    emitListeningEvent(false);
    console.log('[useAgentAgent] Listening stopped');
  }, [vadStop]);

  const toggleListening = useCallback(async (): Promise<void> => {
    if (isListeningRef.current) {
      stopListening();
    } else {
      await startListening();
    }
  }, [startListening, stopListening]);

  const sendText = useCallback((text: string): void => {
    if (!text?.trim()) return;
    const ws = wsRef.current;
    if (!ws || ws.readyState !== WebSocket.OPEN) {
      console.warn('[useAgentAgent] WS not open — cannot sendText');
      setError('Not connected to agent');
      return;
    }
    // Track whether this is a system/greeting message (for tts_unavailable retry path)
    lastSentWasGreetRef.current = text.trim().startsWith('[SYSTEM_EVENT');
    const payload: Record<string, unknown> = { type: 'text', text: text.trim(), lang };
    const gradeResult = readLastGrade();
    if (gradeResult) payload.grade_result = gradeResult;
    ws.send(JSON.stringify(payload));
    useBrainStore.getState().pushTurn({ role: 'user', text: text.trim() });
    // Only surface real user text — filter out internal system event prompts
    // (e.g. '[SYSTEM_EVENT: The student has been silent...]' from smart heartbeat)
    if (!text.trim().startsWith('[SYSTEM_EVENT')) {
      setLastTranscript(text.trim());
    }
    setIsProcessing(true);
    console.log('[useAgentAgent] Sent text:', text.slice(0, 80));
  }, [lang]);

  const clearHistory = useCallback((): void => {
    useBrainStore.getState().reset();
    stopAudio();
    setLastTranscript('');
    setLastReply('');
    setLastDialogue('');
    setEmotion('neutral');
    setError(null);
    setHasInitiated(false); // Allow one new proactive greeting after history reset
    console.log('[useAgentAgent] History cleared');
  }, [stopAudio]);

  // ── Microphone lifecycle manager ─────────────────────────────────────────────
  // • Registers device-change auto-reopen once.
  // • Opens the mic after the welcome greeting finishes (avatar:speak:end),
  //   or after 1.2 s if no greeting plays (e.g. autoplay blocked).
  // • Emits 'mic:needs-user-gesture' so PermissionBanner shows a visible prompt.
  // • Does NOT create AudioContext / VAD graph until the stream is live.

  useEffect(() => {
    if (typeof window === 'undefined') return;
    onDeviceChangeReopen();
    let preferId: string | undefined;

    const openSafe = async (reason: string): Promise<void> => {
      if (
        (window as unknown as Record<string, unknown>).__BOOT_GREETING_ACTIVE__ ||
        (window as unknown as Record<string, unknown>).__DISABLE_VAD__
      ) return;
      try {
        if (!preferId) preferId = await pickPreferredInputId();
        await ensureMicOpen({
          sampleRate:      48000,
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl:  false,
          deviceId:         preferId,
        });
        if (process.env.NODE_ENV === 'development')
          console.log('[MIC] opened:', reason);
      } catch (e: unknown) {
        const err = e as { name?: string; message?: string };
        console.warn('[MIC] open failed:', reason, err?.name, err?.message);
        window.dispatchEvent(new CustomEvent('mic:needs-user-gesture'));
      }
    };

    const onSpeakEnd  = (): void => { setTimeout(() => openSafe('after-greet-wav'), 250); };
    const onFocus     = (): void => { openSafe('window-focus'); };
    const onVisible   = (): void => { if (document.visibilityState === 'visible') openSafe('visible'); };

    window.addEventListener('avatar:speak:end',   onSpeakEnd);
    window.addEventListener('focus',              onFocus);
    document.addEventListener('visibilitychange', onVisible);

    const t0 = setTimeout(() => openSafe('initial-mount'), 1_200);

    return (): void => {
      clearTimeout(t0);
      window.removeEventListener('avatar:speak:end',   onSpeakEnd);
      window.removeEventListener('focus',              onFocus);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, []);

  // ── Avatar speaking tracker (keeps isSpeakingRef in sync via window events) ──

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const onStart = (): void => { isSpeakingRef.current = true; };
    const onEnd   = (): void => { isSpeakingRef.current = false; };
    window.addEventListener('avatar:speak:start', onStart);
    window.addEventListener('avatar:speak:end',   onEnd);
    return () => {
      window.removeEventListener('avatar:speak:start', onStart);
      window.removeEventListener('avatar:speak:end',   onEnd);
    };
  }, []);

  // ── VAD auto-stop / auto-resume around avatar speech (barge-in guard) ────────
  //
  // When the avatar starts playing audio we pause VAD so the microphone doesn't
  // pick up the speakers.  When the avatar finishes, VAD resumes automatically
  // if it was running before (wasListeningBeforeAvatarRef).
  //
  // This is the complement of the barge-in path already in startListening()
  // (which stops avatar speech when the USER presses the mic button).

  useEffect(() => {
    if (typeof window === 'undefined') return;

    const onAvatarSpeakStart = (): void => {
      if (!isListeningRef.current) return;
      wasListeningBeforeAvatarRef.current = true;
      // Pause recording without toggling the UI mic button
      vadStop();
      isListeningRef.current = false;
      useBrainStore.getState().setPhysical({ isListening: false });
      emitListeningEvent(false);
      console.log('[useAgentAgent] Avatar speaking — VAD paused (barge-in guard)');
    };

    const onAvatarSpeakEnd = (): void => {
      if (!wasListeningBeforeAvatarRef.current) return;
      wasListeningBeforeAvatarRef.current = false;
      // Brief tail-gap: give the audio driver a tick to flush before the mic opens
      setTimeout(async () => {
        if (!mountedRef.current || isListeningRef.current) return;
        try {
          isListeningRef.current = true;
          await vadStart();
          useBrainStore.getState().setPhysical({ isListening: true });
          emitListeningEvent(true);
          console.log('[useAgentAgent] Avatar finished — VAD auto-resumed');
        } catch {
          isListeningRef.current = false;
        }
      }, 400);
    };

    window.addEventListener('avatar:speak:start', onAvatarSpeakStart);
    window.addEventListener('avatar:speak:end',   onAvatarSpeakEnd);
    return () => {
      window.removeEventListener('avatar:speak:start', onAvatarSpeakStart);
      window.removeEventListener('avatar:speak:end',   onAvatarSpeakEnd);
    };
  }, [vadStop, vadStart]);

  // ── WS protocol heartbeat watchdog — reconnect after 2 missed server beats ──

  useEffect(() => {
    if (!isConnected) return;
    // The backend sends a heartbeat every HEARTBEAT_INTERVAL_SEC.
    // We check every (HEARTBEAT_INTERVAL_SEC + 5) seconds; if missedHeartbeatsRef
    // hits >= 2 consecutive misses the WS is likely stale → force reconnect.
    const WATCH_MS = (HEARTBEAT_INTERVAL_SEC + 5) * 1000;
    const watchdog = setInterval(() => {
      if (!mountedRef.current) return;
      missedHeartbeatsRef.current += 1;
      if (missedHeartbeatsRef.current >= 2) {
        console.warn('[useAgentAgent] 2 missed heartbeats — forcing WS reconnect');
        missedHeartbeatsRef.current = 0;
        wsRef.current?.close();   // triggers ws.onclose → autoReconnect
      }
    }, WATCH_MS);
    return () => clearInterval(watchdog);
  }, [isConnected]);

  // ── Auto-start VAD when WS connects (no mic button press needed) ────────────
  // Fires 1.5 s after connect so the welcome greeting can begin playing first.
  // If the avatar is still speaking at the 1.5 s mark (fast backend response),
  // defer VAD start to avatar:speak:end to avoid interrupting the greeting.

  useEffect(() => {
    if (!isConnected) return;
    let cancelled = false;

    const doStart = (): void => {
      if (cancelled || !mountedRef.current || isListeningRef.current) return;
      startListening().catch(() => {});
      console.log('[useAgentAgent] Auto-started VAD after WS connect');
    };

    const t = setTimeout(() => {
      if (cancelled) return;
      if (isSpeakingRef.current || currentAudioRef.current !== null) {
        // Avatar is still delivering the greeting — defer until speech ends
        console.log('[useAgentAgent] Auto-VAD deferred — avatar speaking at 1.5 s mark');
        const onSpeakEnd = (): void => {
          window.removeEventListener('avatar:speak:end', onSpeakEnd);
          setTimeout(doStart, 400); // tail gap: let audio driver flush before mic opens
        };
        window.addEventListener('avatar:speak:end', onSpeakEnd);
      } else {
        doStart();
      }
    }, 1_500);

    return () => {
      cancelled = true;
      clearTimeout(t);
    };
  }, [isConnected, startListening]);

  // ── Smart heartbeat — proactive greeting after IDLE_TIMEOUT of silence ───

  useEffect(() => {
    // Clear any previously scheduled timer on every dependency change
    if (idleTimerRef.current) {
      clearTimeout(idleTimerRef.current);
      idleTimerRef.current = null;
    }

    // Block conditions: already greeted, not yet connected, busy, or user is speaking
    if (hasInitiated || !isConnected || isProcessing || isRecording) return;

    idleTimerRef.current = setTimeout(() => {
      // Re-check live state via refs before firing (guards against stale closure).
      // Also block when an audio element is actively playing (isSpeakingRef covers
      // the window-event path; currentAudioRef covers the element directly).
      if (!mountedRef.current || isSpeakingRef.current || currentAudioRef.current !== null) return;
      // Skip heartbeat if LLM is in rate-limit cooldown
      if (isLlmCooling()) {
        console.warn('[useAgentAgent] Smart heartbeat skipped — LLM cooling');
        return;
      }
      sendText(PROACTIVE_PROMPT);
      setHasInitiated(true);
      console.log('[useAgentAgent] Smart heartbeat fired — proactive greeting sent');
    }, IDLE_TIMEOUT);

    return () => {
      if (idleTimerRef.current) {
        clearTimeout(idleTimerRef.current);
        idleTimerRef.current = null;
      }
    };
  }, [isConnected, isProcessing, isRecording, hasInitiated, sendText]);

  // ── Mount / unmount ───────────────────────────────────────────────────────

  useEffect(() => {
    mountedRef.current = true;

    // Start AgentDirector (subscribes to BrainStore; idempotent)
    agentDirector.start();

    // Open WebSocket
    connect();

    // bfcache support: close WS when page is hidden (saved to cache), reopen on restore
    const onPageHide = (): void => {
      wasClosedIntentionallyRef.current = true;
      wsRef.current?.close();
      wsRef.current = null;
    };
    const onPageShow = (e: PageTransitionEvent): void => {
      if (e.persisted) {
        wasClosedIntentionallyRef.current = false;
        connect();
      }
    };
    window.addEventListener('pagehide', onPageHide);
    window.addEventListener('pageshow', onPageShow);

    return () => {
      mountedRef.current = false;

      window.removeEventListener('pagehide', onPageHide);
      window.removeEventListener('pageshow', onPageShow);

      // Clean up connections and playback
      agentDirector.stop();
      vadStop();
      stopAudio();

      wasClosedIntentionallyRef.current = true;  // prevent auto-reconnect on teardown
      wsRef.current?.close();
      wsRef.current = null;

      if (reconnectTimer.current) {
        clearTimeout(reconnectTimer.current);
        reconnectTimer.current = null;
      }

      console.log('[useAgentAgent] Unmounted — all resources released');
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return {
    isListening:     isRecording,
    isConnected,
    isProcessing,
    isTranscribing,
    emotion,
    lastTranscript,
    lastReply,
    lastDialogue,
    error,
    micNotFound,
    permissionDenied,
    resetPermissionDenied,
    startListening,
    stopListening,
    toggleListening,
    sendText,
    clearHistory,
  };
}

// ─── Web Speech TTS fallback ──────────────────────────────────────────────────

/**
 * Browser-native speech synthesis fallback.
 * Selects a voice that matches `lang` to avoid wrong-language synthesis.
 * Dispatches avatar:speak:start / avatar:speak:end for lip-sync integration.
 */
function speakWebSpeech(text: string, lang = 'ar-JO'): void {
  if (typeof window === 'undefined' || !('speechSynthesis' in window)) return;
  window.speechSynthesis.cancel();

  const effectiveLang = lang || (hasArabic(text) ? 'ar-JO' : 'en-US');
  const langBase      = effectiveLang.split('-')[0];
  let   spoken        = false;

  const doSpeak = (): void => {
    if (spoken) return;
    spoken = true;

    const voices  = window.speechSynthesis.getVoices();
    const voice   =
      voices.find(v => v.lang === effectiveLang) ??
      voices.find(v => v.lang.startsWith(langBase)) ??
      null;

    if (!voice && voices.length > 0) {
      console.warn(
        '[useAgentAgent:TTS] No matching voice for', effectiveLang,
        '— skipping to avoid wrong-language TTS. Text preview:', text.slice(0, 60),
      );
      return;
    }

    const utt  = new SpeechSynthesisUtterance(text);
    utt.lang   = effectiveLang;
    utt.rate   = 0.92;
    if (voice) utt.voice = voice;

    utt.onstart = () => {
      window.dispatchEvent(new CustomEvent('avatar:speak:start'));
      useBrainStore.getState().setTalking(true);
    };
    utt.onend = () => {
      window.dispatchEvent(new CustomEvent('avatar:speak:end'));
      useBrainStore.getState().setTalking(false);
    };
    utt.onerror = () => {
      window.dispatchEvent(new CustomEvent('avatar:speak:end'));
      useBrainStore.getState().setTalking(false);
    };

    window.speechSynthesis.speak(utt);
    console.log('[useAgentAgent:TTS] Web Speech:', text.slice(0, 50));
  };

  // getVoices() returns [] until voiceschanged fires on first page load
  if (window.speechSynthesis.getVoices().length > 0) {
    doSpeak();
  } else {
    window.speechSynthesis.onvoiceschanged = () => { doSpeak(); };
    // Safety timeout — only call if voices have actually loaded by then
    setTimeout(() => {
      if (window.speechSynthesis.getVoices().length > 0) doSpeak();
    }, 900);
  }
}

export default useAgentAgent;
