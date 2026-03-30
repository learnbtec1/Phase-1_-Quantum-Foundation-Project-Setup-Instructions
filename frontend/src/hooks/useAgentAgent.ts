/**
 * useAgentAgent.ts — Phase 4 Multi-Modal Autonomous Agent Hook
 *
 * Orchestrates the complete Phase 4 pipeline:
 *
 *   [Microphone] → useVAD → WebSocket → [Backend]
 *       → JSON AgentFrame → BrainStore.processFrame()
 *       → AgentDirector (gestures, expressions, head, voice)
 *       → PCM / MP3 audio from server or client /api/tts-with-timing
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
 *   5. Every text/audio frame carries COGNI_PERSONA.system_prompt for LLM consistency.
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
import type { EmotionLabel, AgentFrame } from '@/types/ai';
import { COGNI_PERSONA }                   from '@/config/personality';
import { buildDeviceContextPayload }       from '@/lib/deviceContext';
import { resolveSpeakRate, stopTTSGlobally } from '@/ai/io/tts';
import {
  getStableWebSpeechVoice,
  ensureWebSpeechVoicesChangeHook,
} from '@/ai/io/webSpeechVoice';
import {
  durationMsFromVisemeCues,
  estimateDialogueDurationMs,
  planCoSpeechGestures,
} from '@/ai/avatar/coSpeechPlanner';
import { normalizeSpeechFrame, toAgentFrame } from '@/lib/frameNormalizer';
import { dispatchAvatar } from '@/utils/events/normalizeAvatarEvents';
import {
  normalizePerformanceList,
  schedulePerformanceCues,
  type PerformanceCue,
} from '@/ai/avatar/performanceTags';

/**
 * True while HTMLAudioElement from a WS `speech` frame is playing.
 * FIX: voice stability — must be set true when MP3/PCM from server actually plays.
 */
let serverTtsPlaybackActive = false;

// ─── Public hook interface ────────────────────────────────────────────────────

/** Optional flags for Phase B adaptive practice (`type: text` + practice). */
export interface SendTextOptions {
  practice?: boolean;
  topicId?:  number;
}

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
  /** Send a plain-text message (bypasses VAD). Use `opts.practice` for adaptive question mode. */
  sendText:        (text: string, opts?: SendTextOptions) => void;
  /** Reset all state and BrainStore memory. */
  clearHistory:    () => void;
  /** V28 — send arbitrary WS JSON (camera_frame, session_feedback, tool_interaction, …). */
  sendWsPayload:   (payload: Record<string, unknown>) => void;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function emitListeningEvent(active: boolean): void {
  if (typeof window === 'undefined') return;
  window.dispatchEvent(
    new CustomEvent('avatar:listening', { detail: { active } }),
  );
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
/**
 * Client-side fallback: scan dialogue text for inline `[gesture]` tokens
 * (e.g. "[wave] أهلاً"). Converts them to PerformanceCue objects that are
 * merged into the performance[] array before scheduling.
 * Mirrors the backend `extract_inline_gestures()` in cogni_output_format.py.
 */
const _INLINE_GESTURE_KEYS = [
  'wave','waving','think','thinking','point','pointing','beckon','beckoning',
  'agree','agreeing','nod','clap','clapping','cheer','celebrate',
  'relax','look','goodbye','bye','explain','encourage','question',
  'greet','salute','shrug','peace','sad','angry','surprise','surprised',
  'blush','sleepy',
];
const _INLINE_GESTURE_RE_CLIENT = new RegExp(
  '\\[(' + _INLINE_GESTURE_KEYS.join('|') + ')\\]',
  'gi',
);
const _GESTURE_TOKEN_MAP: Record<string, string> = {
  wave:'wave', waving:'wave', think:'think', thinking:'think',
  point:'point', pointing:'point', beckon:'beckon', beckoning:'beckon',
  agree:'agree', agreeing:'agree', nod:'ack', clap:'clap', clapping:'clap',
  cheer:'cheer', celebrate:'cheer', relax:'relax', look:'look',
  goodbye:'goodbye', bye:'goodbye', explain:'think', encourage:'ack',
  question:'think', greet:'wave', salute:'wave', shrug:'relax', peace:'peace',
  sad:'sad', angry:'angry', surprise:'surprise', surprised:'surprise',
  blush:'blush', sleepy:'sleepy',
};

function _parseClientInlineGestures(text: string): PerformanceCue[] {
  if (!text) return [];
  const cues: PerformanceCue[] = [];
  let wordCursor = 0;
  let lastIndex = 0;
  _INLINE_GESTURE_RE_CLIENT.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = _INLINE_GESTURE_RE_CLIENT.exec(text)) !== null) {
    const segment = text.slice(lastIndex, m.index);
    if (segment) wordCursor += segment.trim().split(/\s+/).filter(Boolean).length;
    lastIndex = m.index + m[0].length;
    const tokenKey = m[1].toLowerCase();
    const animKey  = _GESTURE_TOKEN_MAP[tokenKey] ?? 'ack';
    cues.push({
      tag:        `[GESTURE_${tokenKey.toUpperCase()}]`,
      start_word: wordCursor,
      animation:  animKey,
      intensity:  0.60,
    });
  }
  return cues;
}

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

/** Normalize viseme arrays from Next `/api/tts-with-timing` → FastAPI (viseme_events) or legacy shapes. */
function normalizeVisemeEventsPayload(data: unknown): Array<{ t: number; id: number }> | null {
  if (!data || typeof data !== 'object') return null;
  const d = data as Record<string, unknown>;
  const raw =
    (Array.isArray(d.viseme_events) && d.viseme_events) ||
    (Array.isArray(d.visemeEvents) && d.visemeEvents) ||
    (Array.isArray(d.events) && d.events) ||
    null;
  if (!raw?.length) return null;
  const cues: Array<{ t: number; id: number }> = [];
  for (const item of raw) {
    if (!item || typeof item !== 'object') continue;
    const e = item as Record<string, unknown>;
    const t = Number(e.offset_ms ?? e.t ?? e.time_ms ?? 0);
    const id = Number(e.viseme_id ?? e.id ?? e.visemeId ?? 0);
    cues.push({
      t: Math.max(0, Number.isFinite(t) ? t : 0),
      id: Math.min(21, Math.max(0, Number.isFinite(id) ? id : 0)),
    });
  }
  return cues.length ? cues : null;
}

/** Normalize viseme arrays from Agent WS `speech` frames (Azure: { t, id }). */
function normalizeAgentWsVisemeCues(raw: unknown): Array<{ t: number; id: number }> | null {
  if (!Array.isArray(raw) || raw.length === 0) return null;
  const cues: Array<{ t: number; id: number }> = [];
  for (const item of raw) {
    if (!item || typeof item !== 'object') continue;
    const o = item as Record<string, unknown>;
    const t = Number(o.t ?? o.offset_ms ?? o.time_ms ?? 0);
    const id = Number(o.id ?? o.viseme_id ?? o.visemeId ?? 0);
    if (!Number.isFinite(t) || !Number.isFinite(id)) continue;
    cues.push({
      t: Math.max(0, t),
      id: Math.min(21, Math.max(0, Math.round(id))),
    });
  }
  return cues.length ? cues : null;
}

/**
 * Fetch viseme cue timeline from the same TTS route used by speakWithTTS, without playing
 * that audio — so PCM-from-WebSocket lip-sync can use Azure-style viseme IDs + timeline.
 * Expects FastAPI `POST /api/v1/tts-with-timing` JSON via Next proxy: `{ viseme_events: [{ offset_ms, viseme_id }] }`.
 */
async function fetchVisemeCuesFromTtsApi(
  text: string,
  signal?: AbortSignal,
): Promise<Array<{ t: number; id: number }> | null> {
  const trimmed = text.trim().slice(0, 5000);
  if (!trimmed || typeof window === 'undefined') return null;
  try {
    const res = await fetch('/api/tts-with-timing', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        text: trimmed,
        emotion: 'neutral',
        speed: resolveSpeakRate('neutral', COGNI_PERSONA.voiceParameters.rate),
        ar_voice: 'male',
      }),
      signal,
    });
    if (!res.ok) return null;
    const data = await res.json();
    return normalizeVisemeEventsPayload(data);
  } catch (e) {
    if (e instanceof DOMException && e.name === 'AbortError') return null;
    return null;
  }
}

// ─── Constants ─────────────────────────────────────────────────────────────────

/**
 * Milliseconds of silence (after the scene is ready) before the avatar
 * proactively greets the student.  16 s gives the user time to orient
 * themselves in the 3-D room before any greeting fires.
 */
const IDLE_TIMEOUT = 16_000;

/** FIX: Phase 3/4 — proactive gentle check-in after user silence (ms) */
const PROACTIVE_QUESTION_MS = 30_000;

/** داخلي فقط — عربي لتفعيل proactive_engagement في الباكند دون تسريب إنجليزي للنموذج/الواجهة */
const PROACTIVE_PROMPT =
  '[SYSTEM_EVENT: لاحظت صمتًا من الطالب منذ فترة. ردّ بتحية دافئة أو سؤال تفاعلي قصير باللهجة الأردنية يرتبط بالدرس.]';

/** Regex: رسائل استباقية من النظام — لا تُعرَض في فقاعة المستخدم */
const INTERNAL_SYSTEM_EVENT_PREFIX = /^\[SYSTEM_EVENT:/i;

/**
 * يزيل [SYSTEM_EVENT: …] من النص الظاهر (دفاع أمامي إن وصل من الخادم قديماً).
 */
function stripInternalSystemEvents(raw: string): string {
  return raw
    .replace(/\[SYSTEM_EVENT:\s*[\s\S]*?\]/gi, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

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
  /** V31 — suppress duplicate client-side TTS fallback when backend repeats tts_unavailable for same text */
  const lastTtsFallbackTextRef = useRef('');
  const lastTtsFallbackAtRef   = useRef(0);
  /**
   * True once AvatarCanvas fires 'avatar:scene:ready' (VRM has loaded and is
   * visible to the student).  The proactive greeting heartbeat is blocked
   * until this becomes true so the avatar never speaks before the user can see it.
   */
  const sceneReadyRef      = useRef(false);
  /** Last time the user sent audio/text (for proactive silence loop) */
  const lastUserActivityRef = useRef(Date.now());
  const proactiveSilenceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const sendTextRef = useRef<(t: string) => void>(() => {});
  const isProcessingRef = useRef(isProcessing);
  const isRecordingRef = useRef(false);
  /** Timers for co-speech keyword gestures — cleared on new reply / barge-in */
  const coSpeechTimersRef = useRef<ReturnType<typeof setTimeout>[]>([]);
  /** Performance Tag System — word-synced cues from backend `performance` array */
  const performanceTimersRef = useRef<ReturnType<typeof setTimeout>[]>([]);
  /** Abort in-flight viseme fetch from `/api/tts-with-timing` when a new speech frame arrives. */
  const visemeFetchAbortRef = useRef<AbortController | null>(null);
  /** Last inferred user mood for emotional memory (not avatar reply emotion). */
  const lastUserMoodRef = useRef<EmotionLabel>('neutral');

  const clearCoSpeechTimers = useCallback((): void => {
    coSpeechTimersRef.current.forEach(clearTimeout);
    coSpeechTimersRef.current = [];
  }, []);

  const clearPerformanceTimers = useCallback((): void => {
    performanceTimersRef.current.forEach(clearTimeout);
    performanceTimersRef.current = [];
  }, []);

  const scheduleCoSpeechForDialogue = useCallback((dialogue: string, durationMs: number): void => {
    if (typeof window === 'undefined' || !mountedRef.current) return;
    const trimmed = dialogue.trim();
    if (!trimmed) return;
    clearCoSpeechTimers();
    const eff = Math.max(
      4_000,
      Math.min(120_000, durationMs > 0 ? durationMs : estimateDialogueDurationMs(trimmed)),
    );
    planCoSpeechGestures(trimmed, eff).forEach((pl) => {
      const id = window.setTimeout(() => {
        if (!mountedRef.current) return;
        window.dispatchEvent(
          new CustomEvent('avatar:gesture', {
            detail: { type: pl.gesture, side: 'right', duration: 2.2 },
          }),
        );
        if (pl.emphasis === 'eyebrow') {
          window.dispatchEvent(
            new CustomEvent('avatar:speech:emphasis', { detail: { kind: 'eyebrow' } }),
          );
        }
        if (pl.emphasis === 'question_tilt') {
          window.dispatchEvent(
            new CustomEvent('avatar:speech:emphasis', { detail: { kind: 'question_tilt' } }),
          );
        }
      }, pl.atMs);
      coSpeechTimersRef.current.push(id);
    });
  }, [clearCoSpeechTimers]);

  // ── Audio (unified: server MP3 + client /api/tts-with-timing; cancel browser speechSynthesis on interrupt) ──

  const stopAllAudio = useCallback((): void => {
    clearCoSpeechTimers();
    clearPerformanceTimers();
    visemeFetchAbortRef.current?.abort();
    visemeFetchAbortRef.current = null;
    const a = currentAudioRef.current;
    if (a) {
      try { a.pause(); a.currentTime = 0; } catch { /* ignore */ }
      currentAudioRef.current = null;
    }
    serverTtsPlaybackActive = false;
    stopTTSGlobally();
    if (typeof window !== 'undefined' && 'speechSynthesis' in window) {
      try {
        window.speechSynthesis.cancel();
      } catch { /* ignore */ }
    }
  }, [clearCoSpeechTimers, clearPerformanceTimers]);

  const onVadSpeechStart = useCallback((): void => {
    if (isSpeakingRef.current) {
      stopAllAudio();
    }
    if (typeof window === 'undefined') return;
    window.dispatchEvent(new CustomEvent('cogni:user:speaking'));
  }, [stopAllAudio]);

  /**
   * Play server TTS from WS `speech` frames. Azure returns **MP3** (`audio_format: mp3`);
   * wrapping MP3 bytes as PCM WAV corrupts playback and can sound like a “second voice”
   * or trigger Web Speech fallback mid-session.
   */
  const playServerTTSAudio = useCallback(async (
    base64: string,
    sampleRate: number,
    fallbackText: string,
    opts?: {
      format?: string;
      visemeCues?: unknown;
      coSpeechDialogue?: string;
      /** When true, never schedule co-speech gestures (structured `performance` owns the turn). */
      coSpeechDisabled?: boolean;
    },
  ): Promise<void> => {
    stopAllAudio();
    try {
      const raw = Uint8Array.from(atob(base64), (c) => c.charCodeAt(0));
      const fmt = (opts?.format ?? 'pcm').toString().toLowerCase();
      const looksLikeWav =
        raw.length >= 12 &&
        raw[0] === 0x52 &&
        raw[1] === 0x49 &&
        raw[2] === 0x46 &&
        raw[3] === 0x46;

      let blob: Blob;
      if (fmt === 'mp3' || fmt === 'audio/mpeg' || fmt === 'mpeg') {
        blob = new Blob([raw], { type: 'audio/mpeg' });
      } else if (fmt === 'wav' || looksLikeWav) {
        blob = new Blob([raw], { type: 'audio/wav' });
      } else {
        blob = pcmToWavBlob(raw, sampleRate);
      }

      const url = URL.createObjectURL(blob);
      const audio = new Audio(url);
      currentAudioRef.current = audio;

      const serverCues = normalizeAgentWsVisemeCues(opts?.visemeCues);
      const visCtrl = new AbortController();
      visemeFetchAbortRef.current = visCtrl;
      const visemeCuePromise = serverCues
        ? Promise.resolve(serverCues)
        : fetchVisemeCuesFromTtsApi(fallbackText, visCtrl.signal);

      const coSpeechDisabled = !!opts?.coSpeechDisabled;
      const coDialogue = opts?.coSpeechDialogue?.trim();
      let coSpeechScheduled = false;
      const tryScheduleCoSpeech = (): void => {
        if (coSpeechDisabled || !coDialogue || coSpeechScheduled || !mountedRef.current) return;
        const fromAudio =
          audio.duration > 0 && Number.isFinite(audio.duration) ? audio.duration * 1000 : 0;
        const fromVis = durationMsFromVisemeCues(serverCues);
        const est = estimateDialogueDurationMs(fallbackText);
        const eff = Math.max(fromAudio, fromVis, est * 0.55);
        scheduleCoSpeechForDialogue(coDialogue, eff);
        coSpeechScheduled = true;
      };
      audio.addEventListener('loadedmetadata', tryScheduleCoSpeech, { once: true });
      window.setTimeout(() => {
        if (coDialogue && !coSpeechScheduled && mountedRef.current) tryScheduleCoSpeech();
      }, 500);

      let playbackStarted = false;

      audio.onplay = () => {
        playbackStarted = true;
        serverTtsPlaybackActive = true;
        if (typeof window !== 'undefined') {
          window.dispatchEvent(new CustomEvent('avatar:speak:start'));
        }
        useBrainStore.getState().setTalking(true);
        console.log('[useAgentAgent] Server TTS play:start', { format: fmt || 'pcm-wrap', blobType: blob.type });
        void visemeCuePromise.then((cues) => {
          if (!mountedRef.current || !cues?.length || typeof window === 'undefined') return;
          window.dispatchEvent(new CustomEvent('avatar:viseme:start'));
          window.dispatchEvent(
            new CustomEvent('avatar:visemes:timeline', { detail: { cues } }),
          );
          window.dispatchEvent(
            new CustomEvent('avatar:audio:element', { detail: { audio } }),
          );
          console.log(
            '[useAgentAgent] Lip-sync timeline bound —',
            cues.length,
            'cues',
            serverCues ? '(from WS)' : '(from /api/tts-with-timing)',
          );
        });
      };
      audio.onended = () => {
        clearCoSpeechTimers();
        URL.revokeObjectURL(url);
        currentAudioRef.current = null;
        serverTtsPlaybackActive = false;
        useBrainStore.getState().setTalking(false);
        if (typeof window !== 'undefined') {
          window.dispatchEvent(new CustomEvent('avatar:visemes:clear'));
          window.dispatchEvent(new CustomEvent('avatar:speak:end'));
        }
        console.log('[useAgentAgent] Server TTS play:end');
      };
      audio.onerror = () => {
        clearCoSpeechTimers();
        URL.revokeObjectURL(url);
        currentAudioRef.current = null;
        serverTtsPlaybackActive = false;
        useBrainStore.getState().setTalking(false);
        if (typeof window !== 'undefined') {
          window.dispatchEvent(new CustomEvent('avatar:visemes:clear'));
          window.dispatchEvent(new CustomEvent('avatar:speak:end'));
        }
        console.warn(
          '[useAgentAgent] Server TTS decode/play error — no Web Speech fallback (unified pipeline)',
          { playbackStarted },
        );
      };

      const playPromise = audio.play();
      if (playPromise !== undefined) {
        try {
          await playPromise;
        } catch (playErr: unknown) {
          const err = playErr as Error;
          if (err.name === 'NotAllowedError') {
            console.warn('[useAgentAgent] 🔇 Autoplay blocked — starting muted. User must unmute.');
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
            if (typeof window !== 'undefined') {
              window.dispatchEvent(new CustomEvent('cogni:autoplay-blocked', {
                detail: { audio, text: fallbackText },
              }));
            }
          } else {
            throw err;
          }
        }
      }
    } catch (err) {
      serverTtsPlaybackActive = false;
      console.warn('[useAgentAgent] playServerTTSAudio failed (no Web Speech fallback):', err);
    }
  }, [stopAllAudio, lang, scheduleCoSpeechForDialogue, clearCoSpeechTimers]);

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
        const um = (frame.user_mood ?? frame.userMood) as string | undefined;
        lastUserMoodRef.current = um?.trim() ? toEmotionLabel(um.trim()) : 'neutral';
        console.log('[useAgentAgent] Transcript:', transcript.slice(0, 80));
        if (typeof window !== 'undefined') {
          window.dispatchEvent(new CustomEvent('agent:user-activity'));
        }
        break;
      }

      // ── Backend asked to stop TTS immediately (barge-in / turn cancelled) ───
      case 'stop_speech': {
        clearCoSpeechTimers();
        stopAllAudio();
        useBrainStore.getState().setThinking(false);
        useBrainStore.getState().setTalking(false);
        setIsProcessing(false);
        if (typeof window !== 'undefined') {
          window.dispatchEvent(new CustomEvent('avatar:visemes:clear'));
          window.dispatchEvent(new CustomEvent('avatar:speak:end'));
        }
        console.log('[useAgentAgent] stop_speech — playback halted', frame);
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
        const dialogueRaw = (frame.dialogue ?? frame.text ?? '') as string;
        const dialogue   = stripInternalSystemEvents(dialogueRaw.trim());
        const norm       = normalizeSpeechFrame({ ...frame, dialogue });
        if (!norm) break;

        const rawEmotion = norm.emotionRaw;
        const action     = norm.actionRaw;

        const tsNow = Date.now();
        const hasServerAudio = type === 'speech' && !!(frame as { audio_base64?: string }).audio_base64;
        const isClientTtsFallback = !hasServerAudio;
        if (
          isClientTtsFallback
          && dialogue === lastTtsFallbackTextRef.current
          && tsNow - lastTtsFallbackAtRef.current < 10_000
        ) {
          console.warn('[useAgentAgent] Skipping duplicate TTS fallback (same text within 10s — likely quota loop)');
          break;
        }

        stopAllAudio();

        setIsProcessing(false);
        setLastReply(dialogue);
        setLastDialogue(dialogue);
        setEmotion(rawEmotion);

        const emotionLabel = norm.emotionLabel;

        // V20 — embodiment before audio: emotion on canvas + PAD immediately (no TTS wait)
        if (typeof window !== 'undefined') {
          dispatchAvatar('avatar:emotion', { emotion: rawEmotion });
        }
        useBrainStore.getState().applyStreamingEmbodiment(emotionLabel);

        // Client-side fallback: parse inline [gesture] tokens from dialogue in case
        // the backend didn't strip them (e.g. tts_unavailable frame, tutor endpoint).
        const _clientInlineCues = _parseClientInlineGestures(dialogue);

        const perf = normalizePerformanceList(
          (frame as Record<string, unknown>).performance,
        );
        // Merge: inline cues first (start_word=0 = immediate), then structured perf
        const perfMerged = [..._clientInlineCues, ...perf];
        const structuredPerformanceTurn = perfMerged.length > 0;

        // 1. Update BrainStore via processFrame — drives AgentDirector subscriptions
        const agentFrame: AgentFrame = {
          ...toAgentFrame(norm, frame as Record<string, unknown>),
          ...(structuredPerformanceTurn ? { gesturesFromStructuredPerformance: true } : {}),
        };
        useBrainStore.getState().processFrame(agentFrame);

        // 2. Emotional trajectory — log **user** mood (SER / server), not avatar reply emotion
        const topicSnippet = dialogue.split(/\s+/).slice(0, 5).join(' ');
        const rawUserMood = (frame.user_mood ?? frame.userMood) as string | undefined;
        const userMoodLabel = rawUserMood?.trim()
          ? toEmotionLabel(rawUserMood.trim())
          : lastUserMoodRef.current;
        emotionalMemoryManager.recordMoment(userMoodLabel, topicSnippet);
        lastUserMoodRef.current = userMoodLabel;

        // 3. Store avatar turn in short-term memory
        useBrainStore.getState().pushTurn({
          role:    'avatar',
          text:    dialogue,
          emotion: emotionLabel,
        });

        // 3b. Performance Tag System — word-synced cues (optional; replaces co-speech when present)
        clearPerformanceTimers();
        if (perfMerged.length && typeof window !== 'undefined') {
          const wcRaw = (frame as { word_cues?: unknown }).word_cues;
          const wc = Array.isArray(wcRaw)
            ? wcRaw.filter(
                (x): x is { t: number; w?: string } =>
                  !!x && typeof x === 'object' && typeof (x as { t?: unknown }).t === 'number',
              )
            : undefined;
          const est = estimateDialogueDurationMs(dialogue);
          performanceTimersRef.current = schedulePerformanceCues(
            dialogue,
            perfMerged,
            wc,
            est,
            (cue) => {
              if (!mountedRef.current) return;
              window.dispatchEvent(new CustomEvent('avatar:performance', { detail: cue }));
            },
          );
        }

        // 3c. Co-speech: server audio schedules on loadedmetadata; local TTS uses estimate
        clearCoSpeechTimers();

        // 4. Audio output
        //    - PCM audio from backend → play directly (preferred)
        //    - tts_unavailable or no audio → fall back to AgentDirector TTS
        const contagion = frame.contagion as
          | { emotion?: string; intensity?: number; note?: string }
          | undefined;
        if (contagion?.emotion && typeof window !== 'undefined') {
          window.dispatchEvent(new CustomEvent('cogni:student_contagion', { detail: contagion }));
        }

        if (type === 'speech' && frame.audio_base64) {
          lastTtsFallbackTextRef.current = '';
          const sampleRate = (frame.sample_rate ?? 24000) as number;
          const audioFmt = (frame.audio_format ?? frame.audioFormat ?? 'pcm') as string;
          const visRaw = frame.viseme_cues ?? frame.visemeCues;
          void playServerTTSAudio(frame.audio_base64 as string, sampleRate, dialogue, {
            format: audioFmt,
            visemeCues: visRaw,
            coSpeechDisabled: structuredPerformanceTurn,
            coSpeechDialogue: structuredPerformanceTurn ? undefined : dialogue,
          });
        } else {
          if (type === 'tts_unavailable' && typeof window !== 'undefined') {
            window.dispatchEvent(
              new CustomEvent('cogni:tts-secondary-voice', {
                detail: { message: 'Using secondary voice engine...', source: 'ws' },
              }),
            );
          }
          lastTtsFallbackTextRef.current = dialogue;
          lastTtsFallbackAtRef.current = tsNow;
          if (!perf.length) {
            scheduleCoSpeechForDialogue(dialogue, estimateDialogueDurationMs(dialogue));
          }
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

      case 'heartbeat':
        // Heartbeat frame received — update ping timer, no action needed
        console.log('[useAgentAgent] Heartbeat frame received');
        break;

      case 'goal_update': {
        const g = (frame.goal ?? '') as string;
        if (g.trim()) {
          console.log('[useAgentAgent] Thinker goal_update:', g.trim().slice(0, 160));
        }
        break;
      }

      case 'answer_graded': {
        const sc = frame.score as number | undefined;
        const fb = (frame.feedback ?? '') as string;
        console.log('[useAgentAgent] answer_graded score=', sc, fb?.slice(0, 120));
        break;
      }

      default:
        console.log('[useAgentAgent] Unhandled frame type:', type);
    }
  }, [lang, playServerTTSAudio, stopAllAudio, clearCoSpeechTimers, clearPerformanceTimers, scheduleCoSpeechForDialogue]);

  // ── WebSocket connection ───────────────────────────────────────────────────

  const connect = useCallback((): void => {
    if (wsRef.current?.readyState === WebSocket.OPEN) return;
    if (typeof window === 'undefined') return;

    let url = wsUrl;
    try {
      const token = localStorage.getItem('cogni_access_token');
      if (token) {
        const sep = url.includes('?') ? '&' : '?';
        url = `${url}${sep}token=${encodeURIComponent(token)}`;
      }
    } catch {
      /* ignore */
    }

    console.log(`[useAgentAgent] Connecting → ${url}`);
    const ws = new WebSocket(url);
    wsRef.current = ws;

    ws.onopen = () => {
      if (!mountedRef.current) return;
      setIsConnected(true);
      setError(null);
      console.log('[useAgentAgent] WS connected');
      // Step 1 digital-human: announce Cogni persona so the backend can lock LLM identity per session
      try {
        ws.send(
          JSON.stringify({
            type: 'persona_init',
            v: 1.1,
            persona_id: COGNI_PERSONA.id,
            system_prompt: COGNI_PERSONA.systemPrompt,
            platform: COGNI_PERSONA.platformName,
            voice_defaults: COGNI_PERSONA.voiceParameters,
          }),
        );
        console.log('[useAgentAgent] persona_init sent —', COGNI_PERSONA.id);
      } catch (e) {
        console.warn('[useAgentAgent] persona_init send failed:', e);
      }
      // V28 — device / time context for shorter lessons on mobile, evening tone, etc.
      try {
        const dc = buildDeviceContextPayload();
        ws.send(
          JSON.stringify({
            type: 'device_context',
            v: 1.1,
            ...dc,
          }),
        );
      } catch (e) {
        console.warn('[useAgentAgent] device_context send failed:', e);
      }
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

  const sendWsPayload = useCallback((payload: Record<string, unknown>) => {
    const ws = wsRef.current;
    if (!ws || ws.readyState !== WebSocket.OPEN) return;
    try {
      ws.send(JSON.stringify({ v: 1.1, ...payload }));
    } catch {
      /* ignore */
    }
  }, []);

  // ── VAD integration ──────────────────────────────────────────────────────

  const { isRecording, startListening: vadStart, stopListening: vadStop } = useVAD({
    lang,
    silenceThreshold: 0.03,
    silenceGapMs:     700,
    onSpeechStart: onVadSpeechStart,
    onSpeechEnd: async (blob: Blob) => {
      console.log(
        '[useAgentAgent] VAD onSpeechEnd — blob',
        blob.size,
        'bytes',
        blob.type || '(no type)',
      );
      // Full-duplex interrupt: send audio even if the avatar was speaking — backend
      // cancels the LLM/TTS turn and replies to the new utterance. Stop local playback
      // first to reduce speaker bleed (headphones recommended).
      if (isSpeakingRef.current) {
        console.log('[useAgentAgent] Interrupt: user spoke during avatar speech — stopping playback, sending audio');
        stopAllAudio();
      }
      const ws = wsRef.current;
      if (!ws || ws.readyState !== WebSocket.OPEN) {
        console.warn('[useAgentAgent] WS not ready — dropping audio blob');
        return;
      }
      setIsProcessing(true);
      try {
        console.log(`[Agent] Sending audio frame, size: ${blob.size} type=${blob.type || 'unknown'}`);
        const audioBase64 = await audioInputToBase64(blob);
        const emotionalCtx = emotionalMemoryManager.getContextSummary();
        const payload = {
          type: 'audio',
          data: audioBase64,
          /** Canonical key for LLM — same text as persona_init / tutor context */
          system_prompt: COGNI_PERSONA.systemPrompt,
          persona_system_prompt: COGNI_PERSONA.systemPrompt,
          persona: { id: COGNI_PERSONA.id, platform: COGNI_PERSONA.platformName },
          ...(emotionalCtx.trim() ? { emotional_context: emotionalCtx } : {}),
        };
        ws.send(JSON.stringify(payload));
        console.log(
          '[Agent] Audio WS sent — base64 length:',
          audioBase64.length,
          'chars | payload keys:',
          Object.keys(payload).join(','),
        );
      } catch (e) {
        setIsProcessing(false);
        setError('Failed to encode microphone audio');
        console.error('[useAgentAgent] Audio encoding error:', e);
      }
    },
  });

  isProcessingRef.current = isProcessing;
  isRecordingRef.current = isRecording;

  useEffect(() => {
    if (isRecording) {
      useBrainStore.getState().setUserPad({
        pleasure:  0.14,
        arousal:   0.24,
        dominance: 0.06,
      });
    } else {
      useBrainStore.getState().setUserPad(null);
    }
  }, [isRecording]);

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
    stopAllAudio();
    agentDirector.interruptSpeech();
    useBrainStore.getState().setPhysical({ isListening: true });
    emitListeningEvent(true);

    await vadStart();
    console.log('[useAgentAgent] Listening started');
  }, [vadStart, stopAllAudio]);

  const stopListening = useCallback((): void => {
    if (!isListeningRef.current) return;
    isListeningRef.current = false;
    // Cancel any pending half-duplex auto-resume — the user explicitly stopped listening.
    wasListeningRef.current = false;

    vadStop();
    useBrainStore.getState().setPhysical({ isListening: false });
    emitListeningEvent(false);
    if (typeof window !== 'undefined') {
      window.dispatchEvent(new CustomEvent('cogni:user:silent'));
    }
    console.log('[useAgentAgent] Listening stopped');
  }, [vadStop]);

  const toggleListening = useCallback(async (): Promise<void> => {
    if (isListeningRef.current) {
      stopListening();
    } else {
      await startListening();
    }
  }, [startListening, stopListening]);

  const sendText = useCallback((text: string, opts?: SendTextOptions): void => {
    const practice = opts?.practice === true;
    if (!text?.trim() && !practice) return;
    const ws = wsRef.current;
    if (!ws || ws.readyState !== WebSocket.OPEN) {
      console.warn('[useAgentAgent] WS not open — cannot sendText');
      setError('Not connected to agent');
      return;
    }

    const trimmed = (text || '').trim();
    /** لا تُسجَّل في BrainStore كرسالة مستخدم — تبقى تعليماً داخلياً للـ LLM فقط */
    const isInternalProactive = INTERNAL_SYSTEM_EVENT_PREFIX.test(trimmed);
    if (!isInternalProactive) {
      lastUserMoodRef.current = 'neutral';
    }

    // One-shot: attach the BTEC grade snapshot from the assessment page (if any).
    // The backend's process_text() injects it as a Debrief Context block so
    // the avatar can say "أرى إنك حصلت على Merit في موضوع X…" naturally.
    const gradeSnapshot = _consumeLastGrade();
    const emotionalCtx = emotionalMemoryManager.getContextSummary();
    const payload = JSON.stringify({
      type: 'text',
      text: trimmed,
      lang,
      practice,
      ...(opts?.topicId != null ? { topic_id: opts.topicId } : {}),
      /** Injected every turn so LLM stays aligned with Cogni / Eduverse even if persona_init raced */
      system_prompt: COGNI_PERSONA.systemPrompt,
      persona_system_prompt: COGNI_PERSONA.systemPrompt,
      persona: { id: COGNI_PERSONA.id, platform: COGNI_PERSONA.platformName },
      ...(gradeSnapshot ? { grade_result: gradeSnapshot } : {}),
      ...(emotionalCtx.trim() ? { emotional_context: emotionalCtx } : {}),
    });
    ws.send(payload);
    if (!isInternalProactive) {
      const displayUser = trimmed || (practice ? '[تدريب]' : '');
      useBrainStore.getState().pushTurn({ role: 'user', text: displayUser });
      setLastTranscript(displayUser);
    }
    setIsProcessing(true);
    if (gradeSnapshot) {
      console.log(
        '[useAgentAgent] grade_result attached — grade=%s subject=%s',
        gradeSnapshot.final_grade,
        gradeSnapshot.subject,
      );
    }
    console.log(
      '[useAgentAgent] Sent text:',
      isInternalProactive ? '(internal SYSTEM_EVENT — UI hidden)' : trimmed.slice(0, 80),
    );
    if (!isInternalProactive && typeof window !== 'undefined') {
      window.dispatchEvent(new CustomEvent('agent:user-activity'));
    }
  }, [lang]);

  // FIX: Phase 3/4 — proactive silence question (30s + jitter), does not touch 3D scene
  const resetProactiveSilenceTimer = useCallback((): void => {
    if (typeof window === 'undefined') return;
    if (proactiveSilenceTimerRef.current) {
      clearTimeout(proactiveSilenceTimerRef.current);
      proactiveSilenceTimerRef.current = null;
    }
    const jitter =
      COGNI_PERSONA.timing.gestureVarianceScale * (600 + Math.random() * 1800);
    proactiveSilenceTimerRef.current = setTimeout(() => {
      proactiveSilenceTimerRef.current = null;
      if (!mountedRef.current || !sceneReadyRef.current) {
        resetProactiveSilenceTimer();
        return;
      }
      if (isSpeakingRef.current || isProcessingRef.current || isRecordingRef.current) {
        resetProactiveSilenceTimer();
        return;
      }
      const quietMs = Date.now() - lastUserActivityRef.current;
      if (quietMs < PROACTIVE_QUESTION_MS + jitter * 0.25) {
        resetProactiveSilenceTimer();
        return;
      }
      const prompt =
        '[SYSTEM_EVENT: لاحظت صمتك. اسأل الطالب بلهجة أردنية دافئة إن كان يفضّل نرجع لنقطة سابقة أو يحتاج مثال إضافي — جملة واحدة قصيرة.]';
      sendTextRef.current(prompt);
      lastUserActivityRef.current = Date.now();
      resetProactiveSilenceTimer();
    }, PROACTIVE_QUESTION_MS + jitter);
  }, []);

  useEffect(() => {
    sendTextRef.current = sendText;
  }, [sendText]);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const onActivity = (): void => {
      lastUserActivityRef.current = Date.now();
      resetProactiveSilenceTimer();
    };
    window.addEventListener('agent:user-activity', onActivity);
    return () => window.removeEventListener('agent:user-activity', onActivity);
  }, [resetProactiveSilenceTimer]);

  const clearHistory = useCallback((): void => {
    useBrainStore.getState().reset();
    stopAllAudio();
    setLastTranscript('');
    setLastReply('');
    setLastDialogue('');
    setEmotion('neutral');
    setError(null);
    setHasInitiated(false); // Allow one new proactive greeting after history reset
    if (proactiveSilenceTimerRef.current) {
      clearTimeout(proactiveSilenceTimerRef.current);
      proactiveSilenceTimerRef.current = null;
    }
    console.log('[useAgentAgent] History cleared');
  }, [stopAllAudio]);

  // ── Avatar speaking tracker + Half-duplex VAD gate ────────────────────────
  // PRIMARY HALF-DUPLEX ENFORCEMENT:
  //   Start: pause the microphone the instant TTS begins — prevents the avatar
  //          from hearing its own voice through the speakers (echo-interruption loop).
  //   End:   restore the microphone 250 ms after TTS finishes so any residual
  // ── Cognitive Wait-Time — "Hmm…" filler after 2s of LLM silence ────────────
  // When the backend is thinking for > 2 s without a reply, Cogni says a short
  // Jordanian filler phrase + plays the thinking animation to fill dead air.
  useEffect(() => {
    if (typeof window === 'undefined') return;
    let waitTimer: ReturnType<typeof setTimeout> | null = null;
    const WAIT_MS = 2000;
    const JO_FILLERS = [
      '[think] يمم... خلّيني أفكر بهالسؤال.',
      '[think] لحظة كمان، بجمع أفكاري.',
      '[think] هممم، هاد سؤال منيح، بحتاج أفكر شوي.',
      '[think] يمم، تعطيني ثانية كمان.',
    ];
    const onThinkingStart = (): void => {
      waitTimer = setTimeout(() => {
        if (!mountedRef.current || isSpeakingRef.current) return;
        const filler = JO_FILLERS[Math.floor(Math.random() * JO_FILLERS.length)];
        window.dispatchEvent(new CustomEvent('avatar:speak:text', { detail: { text: filler } }));
      }, WAIT_MS);
    };
    const onThinkingEnd = (): void => {
      if (waitTimer) { clearTimeout(waitTimer); waitTimer = null; }
    };
    window.addEventListener('avatar:thinking',    onThinkingStart);
    window.addEventListener('avatar:speak:start', onThinkingEnd);
    window.addEventListener('avatar:speak:end',   onThinkingEnd);
    return () => {
      if (waitTimer) clearTimeout(waitTimer);
      window.removeEventListener('avatar:thinking',    onThinkingStart);
      window.removeEventListener('avatar:speak:start', onThinkingEnd);
      window.removeEventListener('avatar:speak:end',   onThinkingEnd);
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

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
      lastUserActivityRef.current = Date.now();
      window.dispatchEvent(new CustomEvent('agent:user-activity'));
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
    const onAuthChanged = (): void => {
      if (reconnectTimer.current) {
        clearTimeout(reconnectTimer.current);
        reconnectTimer.current = null;
      }
      try {
        wsRef.current?.close();
      } catch {
        /* ignore */
      }
      connect();
    };
    if (typeof window !== 'undefined') {
      window.addEventListener('cogni:auth-changed', onAuthChanged);
    }

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
      stopAllAudio();

      wsRef.current?.close();
      wsRef.current = null;

      if (reconnectTimer.current) {
        clearTimeout(reconnectTimer.current);
        reconnectTimer.current = null;
      }

      console.log('[useAgentAgent] Unmounted — all resources released');

      if (typeof window !== 'undefined') {
        window.removeEventListener('cogni:auth-changed', onAuthChanged);
      }
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
    sendWsPayload,
  };
}

export default useAgentAgent;
