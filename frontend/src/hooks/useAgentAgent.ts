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
  /** BCP-47 language tag for TTS / VAD. Default: 'ar-SA' */
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

// ─── Hook ─────────────────────────────────────────────────────────────────────

export function useAgentAgent({
  wsUrl         = 'ws://localhost:8000/ws/agent',
  autoReconnect = true,
  lang          = 'ar-SA',
}: AgentAgentOptions = {}): AgentAgentState {

  // ── React state ─────────────────────────────────────────────────────────
  const [isConnected,    setIsConnected]    = useState(false);
  const [isProcessing,   setIsProcessing]   = useState(false);
  const [lastTranscript, setLastTranscript] = useState('');
  const [lastReply,      setLastReply]      = useState('');
  const [lastDialogue,   setLastDialogue]   = useState('');
  const [emotion,        setEmotion]        = useState('neutral');
  const [error,          setError]          = useState<string | null>(null);

  // ── Refs ─────────────────────────────────────────────────────────────────
  const wsRef           = useRef<WebSocket | null>(null);
  const reconnectTimer  = useRef<ReturnType<typeof setTimeout> | null>(null);
  const mountedRef      = useRef(true);
  const currentAudioRef = useRef<HTMLAudioElement | null>(null);
  const isListeningRef  = useRef(false);

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
        const msg = ((frame.message ?? frame.detail ?? 'Unknown backend error') as string);
        setError(msg);
        setIsProcessing(false);
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
      const ws = wsRef.current;
      if (!ws || ws.readyState !== WebSocket.OPEN) {
        console.warn('[useAgentAgent] WS not ready — dropping audio blob');
        return;
      }
      setIsProcessing(true);
      const buf = await blob.arrayBuffer();
      ws.send(buf);
      console.log('[useAgentAgent] Sent VAD audio blob:', buf.byteLength, 'bytes');
    },
  });

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
    const payload = JSON.stringify({ type: 'text', text: text.trim(), lang });
    ws.send(payload);
    useBrainStore.getState().pushTurn({ role: 'user', text: text.trim() });
    setLastTranscript(text.trim());
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
    console.log('[useAgentAgent] History cleared');
  }, [stopAudio]);

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
function speakWebSpeech(text: string, lang = 'ar-SA'): void {
  if (typeof window === 'undefined' || !('speechSynthesis' in window)) return;
  window.speechSynthesis.cancel();

  const effectiveLang = lang || (hasArabic(text) ? 'ar-SA' : 'en-US');
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
