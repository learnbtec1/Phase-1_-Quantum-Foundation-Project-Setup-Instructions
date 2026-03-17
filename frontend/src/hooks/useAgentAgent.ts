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

/**
 * Milliseconds of silence (after the scene is ready) before the avatar
 * proactively greets the student.  16 s gives the user time to orient
 * themselves in the 3-D room before any greeting fires.
 */
const IDLE_TIMEOUT = 16_000;

/** System prompt the avatar sends after the idle threshold is reached. */
const PROACTIVE_PROMPT =
  '[SYSTEM_EVENT: The student has been silent. Please proactively greet them, or ask an engaging ice-breaker question related to the lesson.]';

/**
 * Read and consume the BTEC grade snapshot saved by the assessment page.
 * Returns the parsed snapshot on first call, then clears it so it isn't re-sent.
 */
function _consumeLastGrade(): Record<string, unknown> | null {
  if (typeof window === 'undefined') return null;
  try {
    const raw = localStorage.getItem('nexus-last-grade');
    if (!raw) return null;
    const snapshot = JSON.parse(raw) as Record<string, unknown>;
    // Consume immediately — one-shot delivery to the avatar.
    localStorage.removeItem('nexus-last-grade');
    return snapshot;
  } catch {
    return null;
  }
}

// ─── Hook ─────────────────────────────────────────────────────────────────────

export function useAgentAgent({
  wsUrl         = 'ws://localhost:8000/ws/agent',
  autoReconnect = true,
  lang          = 'ar-JO',   // Jordanian Arabic dialect — Dr. Hamza
}: AgentAgentOptions = {}): AgentAgentState {

  // ── React state ─────────────────────────────────────────────────────────
  const [isConnected,    setIsConnected]    = useState(false);
  const [isProcessing,   setIsProcessing]   = useState(false);
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
  const mountedRef         = useRef(true);
  const currentAudioRef    = useRef<HTMLAudioElement | null>(null);
  const isListeningRef     = useRef(false);
  const idleTimerRef       = useRef<ReturnType<typeof setTimeout> | null>(null);
  /** Tracks avatar-speaking state via window events — kept as a ref to avoid re-renders. */
  const isSpeakingRef      = useRef(false);
  /**
   * True when the avatar-speaking tracker paused VAD mid-session (half-duplex).
   * Set on avatar:speak:start, cleared on avatar:speak:end or manual stopListening().
   * Allows automatic VAD resume once TTS playback ends.
   */
  const wasListeningRef    = useRef(false);
  /** Timestamp (ms) of the last empty_transcript warn — used to rate-limit console spam. */
  const lastEmptyErrorRef  = useRef(0);
  /**
   * True once AvatarCanvas fires 'avatar:scene:ready' (VRM has loaded and is
   * visible to the student).  The proactive greeting heartbeat is blocked
   * until this becomes true so the avatar never speaks before the user can see it.
   */
  const sceneReadyRef      = useRef(false);

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

      audio.onplay   = () => {
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
        speakWebSpeech(fallbackText, lang);
      };

      // ── Handle autoplay policy per browser specs ──────────────────────────
      // Try normal playback first. If NotAllowedError, start muted and let UI
      // show an "Unmute" button. This ensures we never get stuck with a
      // pending promised play() that rejects silently.
      const playPromise = audio.play();
      if (playPromise !== undefined) {
        try {
          await playPromise;
        } catch (playErr: unknown) {
          const err = playErr as Error;
          // Check if it's NotAllowedError (autoplay policy violation)
          if (err.name === 'NotAllowedError') {
            console.warn('[useAgentAgent] 🔇 Autoplay blocked — starting muted. User must unmute.');
            
            // Restart with muted audio to establish playback context
            audio.muted = true;
            const mutePlayPromise = audio.play();
            if (mutePlayPromise !== undefined) {
              try {
                await mutePlayPromise;
                console.log('[useAgentAgent] 🔊 Muted playback started — UI should show Unmute button');
              } catch (muteErr) {
                console.warn('[useAgentAgent] Muted playback also failed:', muteErr);
                throw muteErr;
              }
            }
            
            // Signal to UI: show "Unmute" button
            if (typeof window !== 'undefined') {
              window.dispatchEvent(new CustomEvent('cogni:autoplay-blocked', {
                detail: { audio, text: fallbackText },
              }));
            }
          } else {
            // Other play() errors
            throw err;
          }
        }
      }
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

      // ── STT transcript ────────────────────────────────────────────────
      case 'transcript': {
        const transcript = ((frame.text ?? frame.transcript ?? '') as string).trim();
        if (!transcript) break;
        setLastTranscript(transcript);
        useBrainStore.getState().pushTurn({ role: 'user', text: transcript });
        console.log('[useAgentAgent] Transcript:', transcript.slice(0, 80));
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

        setIsProcessing(false);
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
        //    - PCM audio from backend → play directly (preferred)
        //    - tts_unavailable or no audio → fall back to AgentDirector TTS
        if (type === 'speech' && frame.audio_base64) {
          const sampleRate = (frame.sample_rate ?? 24000) as number;
          playPCMAudio(frame.audio_base64 as string, sampleRate, dialogue);
        } else {
          // AgentDirector.scheduleTTS uses speakWithTTS (Kokoro /api/tts-with-timing)
          // with correct voice params; final fallback to Web Speech is inside speakWithTTS.
          agentDirector.scheduleTTS(dialogue, emotionLabel);
        }

        console.log(
          `[useAgentAgent] Speech frame — emotion="${rawEmotion}" len=${dialogue.length}`,
        );
        break;
      }

      // ── Backend error ─────────────────────────────────────────────────
      case 'error': {
        const errorObj = frame.error as Record<string, unknown> | undefined;
        const code     = (errorObj?.code     ?? '') as string;
        const severity = (errorObj?.severity ?? 'error') as string;
        const msg      = ((errorObj?.message ?? frame.message ?? frame.detail ?? 'Unknown backend error') as string);

        // VAD fires on ambient noise → Whisper returns empty_transcript/no_speech_detected
        // with severity:"warn". Rate-limit to one console.warn per 2 s so the
        // devtools overlay doesn't spam and the error state isn't shown to the user.
        if (
          (code === 'empty_transcript' || code === 'no_speech_detected') &&
          severity === 'warn'
        ) {
          const now = Date.now();
          if (now - lastEmptyErrorRef.current > 2000) {
            lastEmptyErrorRef.current = now;
            console.warn('[useAgentAgent] No speech detected (rate-limited — suppressed after this line):', msg);
          }
          setIsProcessing(false);
          break;
        }

        setError(msg);
        setIsProcessing(false);
        const detail = (errorObj?.detail ?? '') as string;
        if (detail) {
          console.error('[useAgentAgent] 🔥 REAL BACKEND ERROR:', detail);
        }
        console.error('[useAgentAgent] Backend error:', msg);
        break;
      }

      default:
        console.log('[useAgentAgent] Unhandled frame type:', type);
    }
  }, [lang, playPCMAudio]);

  // ── WebSocket connection ───────────────────────────────────────────────────

  const connect = useCallback((): void => {
    if (wsRef.current?.readyState === WebSocket.OPEN) return;
    if (typeof window === 'undefined') return;

    console.log(`[useAgentAgent] Connecting → ${wsUrl}`);
    const ws = new WebSocket(wsUrl);
    wsRef.current = ws;

    ws.onopen = () => {
      if (!mountedRef.current) return;
      setIsConnected(true);
      setError(null);
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

    ws.onclose = () => {
      if (!mountedRef.current) return;
      setIsConnected(false);
      console.warn('[useAgentAgent] WS closed');
      if (autoReconnect && mountedRef.current) {
        console.log('[useAgentAgent] Reconnecting in 3 s...');
        reconnectTimer.current = setTimeout(connect, 3000);
      }
    };

    ws.onerror = () => {
      setError('WebSocket connection error');
      console.error('[useAgentAgent] WS error');
    };
  }, [wsUrl, autoReconnect, handleFrame]);

  // ── VAD integration ──────────────────────────────────────────────────────

  const { isRecording, startListening: vadStart, stopListening: vadStop } = useVAD({
    lang,
    onSpeechEnd: async (blob: Blob) => {
      // ── Half-duplex guard ────────────────────────────────────────────────────
      // Discard audio captured while the avatar is speaking (speaker bleed / echo).
      // Primary prevention is avatar:speak:start pausing VAD entirely, but this
      // acts as a belt-and-suspenders gate for any timing races that still deliver a blob.
      if (isSpeakingRef.current) {
        console.log('[useAgentAgent] Half-duplex: echo blob discarded — avatar is currently speaking');
        return;
      }
      const ws = wsRef.current;
      if (!ws || ws.readyState !== WebSocket.OPEN) {
        console.warn('[useAgentAgent] WS not ready — dropping audio blob');
        return;
      }
      setIsProcessing(true);
      try {
        const audioBase64 = await audioInputToBase64(blob);
        const payload = {
          type: 'audio',
          data: audioBase64,
        };
        ws.send(JSON.stringify(payload));
        console.log('[useAgentAgent] Sent VAD audio payload as JSON base64:', audioBase64.length, 'chars');
      } catch (e) {
        setIsProcessing(false);
        setError('Failed to encode microphone audio');
        console.error('[useAgentAgent] Audio encoding error:', e);
      }
    },
  });

  // ── Stable ref wrappers for vadStart / vadStop ─────────────────────────────
  // The avatar:speak event handlers (useEffect below) need to call the latest
  // vadStart/vadStop without them in the effect dependency array (adding them
  // would re-register handlers on every isRecording change, risking double-fires).
  const _vadStartRef = useRef(vadStart);
  const _vadStopRef  = useRef(vadStop);
  _vadStartRef.current = vadStart;
  _vadStopRef.current  = vadStop;

  // ── Public API ────────────────────────────────────────────────────────────

  const startListening = useCallback(async (): Promise<void> => {
    if (isListeningRef.current) return;
    isListeningRef.current = true;

    // Interrupt any ongoing speech before listening (prevents echo)
    agentDirector.interruptSpeech();
    useBrainStore.getState().setPhysical({ isListening: true });
    emitListeningEvent(true);

    await vadStart();
    console.log('[useAgentAgent] Listening started');
  }, [vadStart]);

  const stopListening = useCallback((): void => {
    if (!isListeningRef.current) return;
    isListeningRef.current = false;
    // Cancel any pending half-duplex auto-resume — the user explicitly stopped listening.
    wasListeningRef.current = false;

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

    // One-shot: attach the BTEC grade snapshot from the assessment page (if any).
    // The backend's process_text() injects it as a Debrief Context block so
    // the avatar can say "أرى إنك حصلت على Merit في موضوع X…" naturally.
    const gradeSnapshot = _consumeLastGrade();
    const payload = JSON.stringify({
      type: 'text',
      text: text.trim(),
      lang,
      ...(gradeSnapshot ? { grade_result: gradeSnapshot } : {}),
    });
    ws.send(payload);
    useBrainStore.getState().pushTurn({ role: 'user', text: text.trim() });
    setLastTranscript(text.trim());
    setIsProcessing(true);
    if (gradeSnapshot) {
      console.log(
        '[useAgentAgent] grade_result attached — grade=%s subject=%s',
        gradeSnapshot.final_grade,
        gradeSnapshot.subject,
      );
    }
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

  // ── Avatar speaking tracker + Half-duplex VAD gate ────────────────────────
  // PRIMARY HALF-DUPLEX ENFORCEMENT:
  //   Start: pause the microphone the instant TTS begins — prevents the avatar
  //          from hearing its own voice through the speakers (echo-interruption loop).
  //   End:   restore the microphone 250 ms after TTS finishes so any residual
  //          speaker echo has decayed before the next VAD analysis window opens.
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const onStart = (): void => {
      isSpeakingRef.current = true;
      // Mute VAD the instant TTS playback begins.
      if (isListeningRef.current) {
        wasListeningRef.current = true;
        _vadStopRef.current();
        console.log('[useAgentAgent] Half-duplex: VAD paused — avatar is speaking');
      }
    };
    const onEnd = (): void => {
      isSpeakingRef.current = false;
      // Re-enable VAD after a 250 ms settling delay once TTS finishes.
      if (wasListeningRef.current) {
        wasListeningRef.current = false;
        setTimeout(() => {
          if (isListeningRef.current && mountedRef.current) {
            _vadStartRef.current().catch((e: unknown) => {
              console.warn('[useAgentAgent] Half-duplex: failed to resume VAD after TTS:', e);
            });
            console.log('[useAgentAgent] Half-duplex: VAD resumed — avatar finished speaking');
          }
        }, 250);
      }
    };
    window.addEventListener('avatar:speak:start', onStart);
    window.addEventListener('avatar:speak:end',   onEnd);
    return () => {
      window.removeEventListener('avatar:speak:start', onStart);
      window.removeEventListener('avatar:speak:end',   onEnd);
    };
  }, []); // intentionally empty — reads _vadStartRef / _vadStopRef for latest values

  // ── Scene-ready gate — listen for VRM loaded signal from AvatarCanvas ──────
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const onReady = () => {
      sceneReadyRef.current = true;
      console.log('[useAgentAgent] avatar:scene:ready received — idle timer now armed');
    };
    window.addEventListener('avatar:scene:ready', onReady);
    return () => window.removeEventListener('avatar:scene:ready', onReady);
  }, []);

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
      // Re-check live state via refs before firing (guards against stale closure)
      // sceneReadyRef: blocks greeting if the VRM hasn't loaded yet (user still zooming in)
      if (!mountedRef.current || isSpeakingRef.current || !sceneReadyRef.current) return;

      // If a grade snapshot exists, use a debrief-aware prompt so the avatar
      // opens with "أرى إنك أنهيت التقييم…" instead of the generic greeting.
      const pendingGrade = (() => {
        try {
          const raw = typeof window !== 'undefined' ? localStorage.getItem('nexus-last-grade') : null;
          return raw ? JSON.parse(raw) as Record<string, unknown> : null;
        } catch { return null; }
      })();

      const prompt = pendingGrade
        ? `[SYSTEM_EVENT: الطالب عاد للتو من صفحة التقييم. درجته: ${pendingGrade.final_grade ?? ''}، المادة: ${pendingGrade.subject ?? ''}. قدّم له تغذية راجعة تشجيعية باللهجة الأردنية — اذكر الدرجة بشكل طبيعي في حديثك ثم اسأله عن نقطة يريد تحسينها.]`
        : PROACTIVE_PROMPT;

      sendText(prompt);
      setHasInitiated(true);
      console.log('[useAgentAgent] Smart heartbeat fired — proactive greeting sent', pendingGrade ? `(debrief: ${pendingGrade.final_grade})` : '');
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

    return () => {
      mountedRef.current = false;

      // Clean up connections and playback
      agentDirector.stop();
      vadStop();
      stopAudio();

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
    emotion,
    lastTranscript,
    lastReply,
    lastDialogue,
    error,
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
