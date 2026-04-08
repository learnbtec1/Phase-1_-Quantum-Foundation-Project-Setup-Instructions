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
import { unifiedGestureEngine, initGestureNormalizer } from '@/ai/cognitive/UnifiedGestureEngine';
import { PRIORITY } from '@/constants/gestures';
import { emotionalMemoryManager }          from '@/ai/avatar/EmotionalMemoryManager';
import type { EmotionLabel, AgentFrame } from '@/types/ai';
import { COGNI_PERSONA, COGNI_JSON_BRAIN_SYSTEM_APPEND } from '@/config/personality';
import { buildDeviceContextPayload }       from '@/lib/deviceContext';
import { authHeaders }                     from '@/lib/auth';
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
  analyzeIntent,
  intentToEmotionOverlay,
  intentToGestureHint,
} from '@/ai/intentAnalyzer';
import {
  getNextStrategy,
  buildStrategySystemSuffix,
  getStrategyAvatarBehavior,
  type StrategyContext,
  type StudentLevel,
  type StudentState,
  type BtecTarget,
  type LearningMoment,
} from '@/ai/teaching/TeachingStrategyEngine';
import { intuitionEngine, getPhysiognomySummary } from '@/ai/cognitive/IntuitionEngine';
import { persuasionEngine } from '@/ai/cognitive/PersuasionEngine';
import { temporalAwareness } from '@/ai/cognitive/TemporalAwareness';
import {
  normalizeGesturesArrayFromWs,
  normalizePerformanceList,
  schedulePerformanceCues,
  type PerformanceCue,
} from '@/ai/avatar/performanceTags';
import {
  COGNI_FOCUS_SUBJECT_EVENT,
  getCogniFocusSubject,
  readAssessmentCoaching,
  type AssessmentCoachingPayload,
} from '@/lib/cogniSessionContext';

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
  /** WebSocket endpoint URL. Default: من `NEXT_PUBLIC_API_URL` أو `ws://127.0.0.1:8000/ws/agent` */
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

/**
 * Normalise a raw time value to **seconds** for LipSyncManager.
 * - If the field is `offset_ms` or `time_ms` → divide by 1000.
 * - If the field is `t` (Azure/server convention already in seconds) → keep.
 * - Auto-detect: if value > 300 assume ms and convert.
 */
function toVisemeSec(
  e: Record<string, unknown>,
  key: string,
  isExplicitMs: boolean,
): number {
  const raw = Number(e[key] ?? 0);
  if (!Number.isFinite(raw)) return 0;
  if (isExplicitMs || raw > 300) return raw / 1000;
  return raw;
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
    // Priority: offset_ms (explicit ms) → time_ms (explicit ms) → t (seconds)
    let tSec: number;
    if ('offset_ms' in e) {
      tSec = toVisemeSec(e, 'offset_ms', true);
    } else if ('time_ms' in e) {
      tSec = toVisemeSec(e, 'time_ms', true);
    } else {
      tSec = toVisemeSec(e, 't', false);
    }
    const id = Number(e.viseme_id ?? e.id ?? e.visemeId ?? 0);
    cues.push({
      t:  Math.max(0, tSec),
      id: Math.min(21, Math.max(0, Number.isFinite(id) ? Math.round(id) : 0)),
    });
  }
  if (!cues.length) return null;
  // Sort ascending (API may return unsorted)
  cues.sort((a, b) => a.t - b.t);
  return cues;
}

/** Normalize viseme arrays from Agent WS `speech` frames. */
function normalizeAgentWsVisemeCues(raw: unknown): Array<{ t: number; id: number }> | null {
  if (!Array.isArray(raw) || raw.length === 0) return null;
  const cues: Array<{ t: number; id: number }> = [];
  for (const item of raw) {
    if (!item || typeof item !== 'object') continue;
    const o = item as Record<string, unknown>;
    // WS convention varies: prefer offset_ms if present (explicit ms), else t (seconds)
    let tSec: number;
    if ('offset_ms' in o) {
      tSec = toVisemeSec(o, 'offset_ms', true);
    } else if ('time_ms' in o) {
      tSec = toVisemeSec(o, 'time_ms', true);
    } else {
      tSec = toVisemeSec(o, 't', false);
    }
    const id = Number(o.id ?? o.viseme_id ?? o.visemeId ?? 0);
    if (!Number.isFinite(tSec) || !Number.isFinite(id)) continue;
    cues.push({
      t:  Math.max(0, tSec),
      id: Math.min(21, Math.max(0, Math.round(id))),
    });
  }
  if (!cues.length) return null;
  cues.sort((a, b) => a.t - b.t);
  return cues;
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
      headers: { 'Content-Type': 'application/json', ...authHeaders() },
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
    const raw = localStorage.getItem('eduverse-last-grade');
    if (!raw) return null;
    const snapshot = JSON.parse(raw) as Record<string, unknown>;
    // Consume immediately — one-shot delivery to the avatar.
    localStorage.removeItem('eduverse-last-grade');
    return snapshot;
  } catch {
    return null;
  }
}

function trimAssessmentCoachingForWs(p: AssessmentCoachingPayload): Record<string, unknown> {
  return {
    final_grade: p.final_grade,
    subject: p.subject,
    achieved: p.achieved,
    total: p.total,
    criteria_summary: (p.criteria_summary || '').slice(0, 1200),
    gaps_detail_ar: (p.gaps_detail_ar || '').slice(0, 3500),
    coaching_goal_ar: (p.coaching_goal_ar || '').slice(0, 800),
    ts: p.ts,
    ...(p.report_excerpt ? { report_excerpt: String(p.report_excerpt).slice(0, 1200) } : {}),
  };
}

// ─── Hook ─────────────────────────────────────────────────────────────────────

/** يطابق AvatarAgentClient: `NEXT_PUBLIC_API_URL` → WebSocket `/ws/agent` */
const DEFAULT_WS_AGENT_URL =
  typeof process !== 'undefined' && process.env.NEXT_PUBLIC_API_URL?.trim()
    ? `${process.env.NEXT_PUBLIC_API_URL.trim().replace(/\/$/, '').replace(/^https:\/\//i, 'wss://').replace(/^http:\/\//i, 'ws://')}/ws/agent`
    : 'ws://127.0.0.1:8000/ws/agent';

export function useAgentAgent({
  wsUrl         = DEFAULT_WS_AGENT_URL,
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
  const coSpeechTimersRef = useRef<number[]>([]);
  /** Performance Tag System — word-synced cues from backend `performance` array */
  const performanceTimersRef = useRef<number[]>([]);
  /** Abort in-flight viseme fetch from `/api/tts-with-timing` when a new speech frame arrives. */
  const visemeFetchAbortRef = useRef<AbortController | null>(null);
  /** Last inferred user mood for emotional memory (not avatar reply emotion). */
  const lastUserMoodRef = useRef<EmotionLabel>('neutral');

  // ── Teaching Strategy Engine ────────────────────────────────────────────────
  const teachingCtxRef = useRef<StrategyContext>({
    studentLevel:     'developing',
    studentState:     'neutral',
    btecTarget:       'unknown',
    learningMoment:   'session_start',
    sessionTurnCount: 0,
  });
  /** Strategy suffix sent with each LLM request as extra system context */
  const activeStrategySuffixRef = useRef<string>('');
  const sessionTurnCountRef = useRef(0);
  /** Keep-alive ping interval — cleared on WS close / unmount. */
  const keepAliveIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  /** Connection-open timeout — cleared in onopen; fires close() if server never opens. */
  const connectTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

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
    if (typeof window !== 'undefined' && window.speechSynthesis) {
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
      /**
       * يُستدعى مرة واحدة عند بدء التشغيل الفعلي (onplay) — لمزامنة تعبير الوجه و performance مع الصوت.
       */
      onAudibleAnchor?: () => void;
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
      // crossOrigin MUST be set before src is used for MediaElementSource (wireAnalyser)
      audio.crossOrigin = 'anonymous';
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
        // Prefer actual audio duration (most accurate); fall back to viseme timeline end, then estimate
        const fromAudio  = audio.duration > 0 && Number.isFinite(audio.duration) ? audio.duration * 1000 : 0;
        const fromVis    = durationMsFromVisemeCues(serverCues); // now correctly converts seconds → ms
        const fromEst    = estimateDialogueDurationMs(fallbackText);
        // Take the best available source; estimate is a last resort floor
        const eff = fromAudio > 0 ? fromAudio : fromVis > 0 ? fromVis : Math.max(fromEst, 4000);
        scheduleCoSpeechForDialogue(coDialogue, eff);
        coSpeechScheduled = true;
      };
      audio.addEventListener('loadedmetadata', tryScheduleCoSpeech, { once: true });
      // Fallback if loadedmetadata fires before we register (rare in Safari)
      window.setTimeout(() => {
        if (coDialogue && !coSpeechScheduled && mountedRef.current) tryScheduleCoSpeech();
      }, 350);

      let playbackStarted = false;
      let audibleStartFired = false;

      audio.onplay = () => {
        playbackStarted = true;
        serverTtsPlaybackActive = true;
        if (!audibleStartFired) {
          audibleStartFired = true;
          try {
            opts?.onAudibleAnchor?.();
          } catch (cbErr) {
            console.warn('[useAgentAgent] onAudibleAnchor error:', cbErr);
          }
        }
        useBrainStore.getState().setTalking(true);
        if (typeof window !== 'undefined') {
          // Dispatch avatar:audio:element FIRST so AvatarCanvas wires the analyser ref
          // before avatar:speak:start sets isTalkingRef.current = true in the same turn.
          window.dispatchEvent(new CustomEvent('avatar:audio:element', { detail: { audio } }));
          window.dispatchEvent(new CustomEvent('avatar:speak:start'));
        }
        console.log('[useAgentAgent] Server TTS play:start', { format: fmt || 'pcm-wrap', blobType: blob.type });
        void visemeCuePromise.then((cues) => {
          if (!mountedRef.current || !cues?.length || typeof window === 'undefined') return;
          // Dispatch timeline after audio:element is already bound
          window.dispatchEvent(
            new CustomEvent('avatar:visemes:timeline', { detail: { cues } }),
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
        if (!audibleStartFired) {
          audibleStartFired = true;
          try {
            opts?.onAudibleAnchor?.();
          } catch {
            /* ignore */
          }
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

    // pong: keep silent — avoid console spam from 28s keep-alive
    if (type !== 'pong') {
      console.log(`[useAgentAgent] 📨 Received:`, type, frame);
    }

    switch (type) {

      // ── STT transcript ────────────────────────────────────────────────
      case 'transcript': {
        const transcript = ((frame.text ?? frame.transcript ?? '') as string).trim();
        if (!transcript) break;
        setLastTranscript(transcript);
        useBrainStore.getState().pushTurn({ role: 'user', text: transcript });
        useBrainStore.getState().setUserSpeaking(true);
        setTimeout(() => useBrainStore.getState().setUserSpeaking(false), 800);
        const um = (frame.user_mood ?? frame.userMood) as string | undefined;
        lastUserMoodRef.current = um?.trim() ? toEmotionLabel(um.trim()) : 'neutral';

        // ── All intelligence layers: intuition + strategy + persuasion + temporal ──
        sessionTurnCountRef.current += 1;
        temporalAwareness.incrementTurn();

        const lowerTx = transcript.toLowerCase();
        const learningMoment: LearningMoment = (() => {
          if (/ما فهمت|مش واضح|مش فاهم|confused|don.t understand|لا أفهم/.test(lowerTx)) return 'confusion_signal';
          if (/[؟?]/.test(transcript) && /كيف|ليش|ما|شو|وين|why|how|what|explain/.test(lowerTx)) return 'question_asked';
          if (/غلط|خطأ|error|wrong|incorrect/.test(lowerTx)) return 'error_made';
          if (/صح|فهمت|تمام|أوكي|okay|got it|understand|مفهوم/.test(lowerTx)) return 'correct_answer';
          if (/p1|p2|p3|m1|m2|d1|d2|معيار|criterion|pass|merit|distinction/.test(lowerTx)) return 'criterion_attempt';
          if (sessionTurnCountRef.current === 1) return 'session_start';
          if (sessionTurnCountRef.current % 5 === 0) return 'revision_needed';
          return 'question_asked';
        })();

        // Infer student state from mood/content
        const studentState: StudentState = (() => {
          const mood = lastUserMoodRef.current;
          if (mood === 'anxious' || mood === 'sad') return 'frustrated';
          if (learningMoment === 'confusion_signal') return 'confused';
          if (learningMoment === 'correct_answer' || mood === 'excited') return 'progressing';
          if (mood === 'bored' || mood === 'sleepy') return 'bored';
          if (mood === 'curious' || mood === 'attentive') return 'engaged';
          return 'neutral';
        })();

        // Infer student level from history
        const recentHistory = useBrainStore.getState().conversationHistory.slice(-10);
        const studentLevel: StudentLevel = (() => {
          const correctCount = recentHistory.filter(t => t.role === 'user' &&
            /صح|فهمت|تمام|correct|understand/.test(t.text)).length;
          const confusionCount = recentHistory.filter(t => t.role === 'user' &&
            /ما فهمت|مش واضح|confused/.test(t.text)).length;
          if (confusionCount >= 3) return 'struggling';
          if (confusionCount >= 1 || correctCount < 2) return 'developing';
          if (correctCount >= 5) return 'excelling';
          return 'achieving';
        })();

        // Infer BTEC target level from context
        const btecTarget: BtecTarget = (() => {
          const dlState = useBrainStore.getState();
          // Check if deep link has target
          if (lowerTx.includes('distinction') || lowerTx.includes('امتياز')) return 'distinction';
          if (lowerTx.includes('merit') || lowerTx.includes('ميريت')) return 'merit';
          if (lowerTx.includes('pass') || lowerTx.includes('نجاح')) return 'pass';
          return 'unknown';
        })();

        // Update teaching context
        teachingCtxRef.current = {
          studentLevel,
          studentState,
          btecTarget,
          learningMoment,
          sessionTurnCount: sessionTurnCountRef.current,
          topicKeyword: (() => {
            const match = lowerTx.match(/\b(swot|pestle|marketing mix|financial|human resources|operations|unit \d+)\b/i);
            return match ? match[0] : undefined;
          })(),
          criterionCode: (() => {
            const match = lowerTx.match(/\b([pmd]\d+)\b/i);
            return match ? match[0].toUpperCase() : undefined;
          })(),
        };

        // ── Layer 1: Intuition Engine ──────────────────────────────────────────
        const recentHistoryTexts = useBrainStore.getState().conversationHistory
          .slice(-6).map(t => t.text);
        const intuitionReading = intuitionEngine.read(transcript, recentHistoryTexts);
        useBrainStore.getState().setIntuitionReading({
          studentPattern:          intuitionReading.studentPattern,
          hiddenWeakness:          intuitionReading.hiddenWeakness,
          studentRealNeed:         intuitionReading.realNeed,
          comprehensionConfidence: intuitionReading.comprehensionConfidence,
          stressSignals:           intuitionReading.stressSignals,
        });

        // ── Layer 2: Temporal Awareness ────────────────────────────────────────
        const temporalCtx = temporalAwareness.getContext();
        useBrainStore.getState().setTemporalContext({
          sessionPhase:         temporalCtx.sessionPhase,
          estimatedEnergyLevel: temporalCtx.energyLevel,
          daysToExam:           temporalCtx.daysToExam,
        });

        // ── Layer 3: Strategy Engine ───────────────────────────────────────────
        const strategy = getNextStrategy(teachingCtxRef.current);
        const strategySuffix = buildStrategySystemSuffix(strategy, teachingCtxRef.current);

        // ── Layer 4: Persuasion Engine ─────────────────────────────────────────
        const persuasionMode = persuasionEngine.selectMode(
          teachingCtxRef.current.studentLevel,
          intuitionReading.studentPattern,
          intuitionReading.inferredEmotion,
          sessionTurnCountRef.current,
        );
        const persuasionDirective = persuasionEngine.buildDirective(
          teachingCtxRef.current.topicKeyword ?? 'BTEC',
          persuasionMode,
          intuitionReading.studentPattern,
          intuitionReading,
          teachingCtxRef.current.btecTarget,
        );
        const persuasionSuffix = persuasionEngine.buildPersuasionSuffix(persuasionDirective, intuitionReading);
        const temporalSuffix = temporalAwareness.buildTemporalSuffix(temporalCtx);
        useBrainStore.getState().setPersuasionMode(persuasionMode);

        // ── Compose full system suffix ─────────────────────────────────────────
        activeStrategySuffixRef.current =
          `${strategySuffix}\n${persuasionSuffix}\n${temporalSuffix}`;

        if (process.env.NODE_ENV === 'development') {
          console.log(`[TeachingStrategy] 📚 ${strategy.name} (d=${strategy.effectSize}) | ${learningMoment} | ${studentLevel}`);
          console.log(`[Intuition] 🔮 Pattern: ${intuitionReading.studentPattern} | Weakness: ${intuitionReading.hiddenWeakness ?? 'none'}`);
          console.log(`[Persuasion] 🎯 Mode: ${persuasionMode} | Hook: ${persuasionDirective.hook}`);
          console.log(`[Temporal] ⏱ Phase: ${temporalCtx.sessionPhase} | Energy: ${Math.round(temporalCtx.energyLevel * 100)}%`);
        }

        // ── Drive avatar body language per strategy ────────────────────────────
        const avatarBehavior = getStrategyAvatarBehavior(strategy);
        if (typeof window !== 'undefined') {
          window.dispatchEvent(new CustomEvent('avatar:emotion', {
            detail: { emotion: avatarBehavior.emotion, strength: 0.7 },
          }));
          window.dispatchEvent(new CustomEvent('avatar:gaze', {
            detail: { yaw: avatarBehavior.gazeTarget === 'think' ? -0.18 : 0,
                      pitch: avatarBehavior.gazeTarget === 'think' ? -0.12 : 0,
                      durationMs: 2000 },
          }));
          void unifiedGestureEngine.play(avatarBehavior.gesture, { priority: PRIORITY.NORMAL });
          // Extra: if hidden weakness detected, trigger concerned look
          if (intuitionReading.hiddenWeakness && typeof window !== 'undefined') {
            setTimeout(() => {
              window.dispatchEvent(new CustomEvent('avatar:micro:gesture', { detail: { kind: 'nod', durationMs: 400 } }));
            }, 800);
          }
        }
        console.log('[useAgentAgent] Transcript:', transcript.slice(0, 80));

        // ── Intent-driven avatar pre-reaction (before LLM reply arrives) ────
        // NOTE: serialised to avoid multiple avatar:gesture in same tick competing
        if (typeof window !== 'undefined') {
          const intent = analyzeIntent(transcript);
          const emoOverlay = intentToEmotionOverlay(intent);
          const gestureHint = intentToGestureHint(intent);

          // 1. Emotion overlay first — sets face before body language
          if (emoOverlay) {
            dispatchAvatar('avatar:emotion', { emotion: emoOverlay.emotion, strength: emoOverlay.strength });
          }

          // 2. Strategy-based gesture (high priority) — from intuition engine
          // Already dispatched in the strategy block above (unifiedGestureEngine.play)

          // 3. Intent gesture hint — only if no strategy gesture was fired
          //    Delayed 80ms to avoid same-tick collision with strategy gesture
          if (gestureHint) {
            setTimeout(() => {
              window.dispatchEvent(new CustomEvent('avatar:gesture', {
                detail: { gesture: gestureHint, duration: 2200 },
              }));
            }, 80);
          }

          // 4. Acknowledging nod — delayed further to sequence correctly
          //    Uses avatar:nod (now wired in VRMSkeletonManager) for micro nod
          setTimeout(() => {
            window.dispatchEvent(new CustomEvent('avatar:nod', {
              detail: { intensity: 0.12, duration: 0.5 },
            }));
          }, 200);

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
          window.dispatchEvent(
            new CustomEvent('avatar:emotion', { detail: { emotion: 'thinking', strength: 0.6 } }),
          );
          void unifiedGestureEngine.play('Thinking', { priority: PRIORITY.HIGH });
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

        // Clear thinking state as soon as reply arrives
        useBrainStore.getState().setThinking(false);

        // ── Awareness layer: internal monologue + awareness cues ───────────────
        const internalMonologue = (frame.internal_monologue ?? '') as string;
        const awarenessCues = frame.awareness_cues as AgentFrame['awareness_cues'] | undefined;
        if (internalMonologue || awarenessCues) {
          useBrainStore.getState().setAwarenessCues(awarenessCues ?? null, internalMonologue || null);
          // Awareness cues → drive avatar gaze/energy
          if (awarenessCues?.gaze_target && typeof window !== 'undefined') {
            const gazeMap: Record<string, { yaw: number; pitch: number }> = {
              user:  { yaw: 0,    pitch: 0 },
              away:  { yaw: 0.28, pitch: 0.08 },
              think: { yaw: -0.22, pitch: -0.15 },
            };
            const gz = gazeMap[awarenessCues.gaze_target] ?? gazeMap['user'];
            window.dispatchEvent(new CustomEvent('avatar:gaze', {
              detail: { yaw: gz.yaw, pitch: gz.pitch, durationMs: 2800 },
            }));
          }
          if (typeof awarenessCues?.movement_energy === 'number' && typeof window !== 'undefined') {
            // Translate movement_energy (0–1) to a PAD arousal hint
            const energyArousal = (awarenessCues.movement_energy - 0.5) * 1.5; // map 0–1 → -0.75..0.75
            const brainState = useBrainStore.getState();
            if (Math.abs(energyArousal) > 0.2) {
              const newArousal = Math.max(-1, Math.min(1, brainState.pad.arousal * 0.7 + energyArousal * 0.3));
              useBrainStore.getState().setUserPad({ ...brainState.userPad, arousal: newArousal, pleasure: brainState.pad.pleasure, dominance: brainState.pad.dominance } as import('@/types/ai').PADVector);
            }
          }
        }

        const emotionLabel = norm.emotionLabel;

        // Canvas emotion: مع صوت الخادم نؤجّل حتى onplay (تزامن وجه/صوت). بدون صوت خادم نُرسِل فوراً.
        const deferCanvasEmotionUntilPlay = hasServerAudio;
        if (typeof window !== 'undefined' && !deferCanvasEmotionUntilPlay) {
          dispatchAvatar('avatar:emotion', { emotion: rawEmotion });
        }
        useBrainStore.getState().applyStreamingEmbodiment(emotionLabel);

        // Client-side fallback: parse inline [gesture] tokens from dialogue in case
        // the backend didn't strip them (e.g. tts_unavailable frame, tutor endpoint).
        const _clientInlineCues = _parseClientInlineGestures(dialogue);

        const perf = normalizePerformanceList(
          (frame as Record<string, unknown>).performance,
        );
        const gesturesNorm = normalizeGesturesArrayFromWs(
          (frame as Record<string, unknown>).gestures,
        );
        // Inline cues first; then server performance[]. If that is empty, use gestures[]
        // (backend augment_ws_reply_gestures often fills gestures while JSON leaves performance []).
        const perfMerged =
          perf.length > 0
            ? [..._clientInlineCues, ...perf]
            : [..._clientInlineCues, ...gesturesNorm];
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

        // 3b. Performance word-sync — مع صوت الخادم: الجدولة داخل onAudibleAnchor. وإلا: فوراً.
        clearPerformanceTimers();
        const wcRawForPerf = (frame as { word_cues?: unknown }).word_cues;
        const wcForPerf = Array.isArray(wcRawForPerf)
          ? wcRawForPerf.filter(
              (x): x is { t: number; w?: string } =>
                !!x && typeof x === 'object' && typeof (x as { t?: unknown }).t === 'number',
            )
          : undefined;

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
            onAudibleAnchor: () => {
              if (!mountedRef.current || typeof window === 'undefined') return;
              dispatchAvatar('avatar:emotion', { emotion: rawEmotion });
              if (!perfMerged.length) return;
              clearPerformanceTimers();
              const estDialogue = estimateDialogueDurationMs(dialogue);
              performanceTimersRef.current = schedulePerformanceCues(
                dialogue,
                perfMerged,
                wcForPerf,
                estDialogue,
                (cue) => {
                  if (!mountedRef.current) return;
                  window.dispatchEvent(new CustomEvent('avatar:performance', { detail: cue }));
                },
                { anchorMs: 0 },
              );
            },
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
          if (perfMerged.length && typeof window !== 'undefined') {
            const estDialogue = estimateDialogueDurationMs(dialogue);
            performanceTimersRef.current = schedulePerformanceCues(
              dialogue,
              perfMerged,
              wcForPerf,
              estDialogue,
              (cue) => {
                if (!mountedRef.current) return;
                window.dispatchEvent(new CustomEvent('avatar:performance', { detail: cue }));
              },
              { anchorMs: 0 },
            );
          }
          if (!perfMerged.length) {
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

      case 'init_ack':
        // Server-side sends this if it implements ack (currently optional in backend).
        console.log('[useAgentAgent] ✅ persona_init acknowledged by server:', frame);
        break;

      case 'connection_ack':
        console.log('[useAgentAgent] ✅ Connection acknowledged by server:', frame);
        break;

      case 'pong':
        // Response to our keep-alive ping — connection is alive.
        break;

      case 'device_context_ack':
        break;

      case 'goal_update': {
        const g = (frame.goal ?? '') as string;
        const trimmedGoal = g.trim();
        if (trimmedGoal) {
          if (process.env.NODE_ENV === 'development') {
            console.log('[useAgentAgent] Thinker goal_update:', trimmedGoal.slice(0, 160));
          }
          // Wire to BrainStore — drives awareness layer in AgentDirector
          useBrainStore.getState().setTeachingGoal(trimmedGoal.slice(0, 320));
          // Dispatch for AgentDirector to react (e.g. brief think gesture)
          agentDirector.processWsFrame({ type: 'agent:thinking', goal: trimmedGoal });
          // Soft emit to window for any UI component that wants to show the goal
          if (typeof window !== 'undefined') {
            window.dispatchEvent(new CustomEvent('cogni:goal_update', { detail: { goal: trimmedGoal } }));
          }
        }
        break;
      }

      case 'answer_graded': {
        const sc = frame.score as number | undefined;
        const fb = (frame.feedback ?? '') as string;
        console.log('[useAgentAgent] answer_graded score=', sc, fb?.slice(0, 120));
        break;
      }

      case 'auth_ok':
        console.log('[useAgentAgent] ✅ auth_ok from server', frame);
        break;

      // ── Gesture / action / emotion / LLM meta-frames from server ───────────
      case 'agent:response':
      case 'llm_response':
      case 'agent:gesture':
      case 'agent:action':
      case 'agent:emotion':
      case 'agent:thinking':
        agentDirector.processWsFrame(frame as Record<string, unknown>);
        break;

      default:
        console.log('[useAgentAgent] Unhandled frame type:', type);
    }
  }, [lang, playServerTTSAudio, stopAllAudio, clearCoSpeechTimers, clearPerformanceTimers, scheduleCoSpeechForDialogue]);

  // ── WebSocket connection ───────────────────────────────────────────────────

  const connect = useCallback((): void => {
    if (wsRef.current?.readyState === WebSocket.OPEN) return;
    if (typeof window === 'undefined') return;

    const url = wsUrl;
    let accessToken: string | null = null;
    try {
      accessToken = localStorage.getItem('cogni_access_token');
    } catch {
      /* ignore */
    }

    console.log(`[useAgentAgent] Connecting → ${url}`);
    // Phase 3: JWT must not appear in the URL. Optional subprotocol carries token (browser);
    // server also accepts { type: "auth", token } as the first text frame after connect.
    const ws =
      accessToken && typeof WebSocket !== 'undefined'
        ? new WebSocket(url, ['cogni-auth-v1', accessToken])
        : new WebSocket(url);
    wsRef.current = ws;

    // Connection-open watchdog: if the server never ACKs the WS upgrade within 8s,
    // close and let autoReconnect handle it.
    connectTimeoutRef.current = setTimeout(() => {
      if (ws.readyState !== WebSocket.OPEN) {
        console.warn('[useAgentAgent] ⏱ Connection timeout (8s) — closing and retrying');
        ws.close();
      }
    }, 8000);

    ws.onopen = () => {
      // Cancel connection watchdog
      if (connectTimeoutRef.current) {
        clearTimeout(connectTimeoutRef.current);
        connectTimeoutRef.current = null;
      }
      if (!mountedRef.current) return;
      setIsConnected(true);
      setError(null);
      console.log('[useAgentAgent] ✅ WS connected');
      // Always send auth as the first text frame when we have a token (before persona_init).
      // Some proxies strip the second Sec-WebSocket-Protocol value; the server only treats
      // the first frame as handshake auth when JWT from the header was missing/invalid.
      // Backend ignores duplicate auth after subprotocol auth (idempotent).
      try {
        if (accessToken) {
          ws.send(
            JSON.stringify({ type: 'auth', token: accessToken, v: 1.1 }),
          );
          console.log('[useAgentAgent] ✅ Auth frame sent (first text frame, v=1.1)');
        } else {
          console.warn(
            '[useAgentAgent] No cogni_access_token — /ws/agent may close with auth_required. Log in or set COGNI_WS_ALLOW_ANONYMOUS=true on the API.',
          );
        }
      } catch (e) {
        console.warn('[useAgentAgent] auth frame send failed:', e);
      }
      // Step 1 digital-human: announce Cogni persona so the backend can lock LLM identity per session
      try {
        // Build enhanced system prompt: base identity + JSON brain awareness layer
        // Import synchronously at module level — COGNI_JSON_BRAIN_SYSTEM_APPEND is already imported
        const jsonModeEnabled = process.env.NEXT_PUBLIC_COGNI_JSON_BRAIN_MODE === 'true'
          || process.env.NEXT_PUBLIC_COGNI_PERFORMANCE_JSON_MODE === 'true';
        const enhancedSystemPrompt = jsonModeEnabled
          ? `${COGNI_PERSONA.systemPrompt}\n\n${COGNI_JSON_BRAIN_SYSTEM_APPEND}`
          : COGNI_PERSONA.systemPrompt;

        const personaInitMsg = {
          type: 'persona_init',
          v: 1.1,
          persona_id: COGNI_PERSONA.id,
          system_prompt: enhancedSystemPrompt,
          platform: COGNI_PERSONA.platformName,
          voice_defaults: COGNI_PERSONA.voiceParameters,
          // Signal server to use gpt-4o-mini for this session (free tier)
          model_hint: 'gpt-4o-mini',
          enable_awareness: true,
          enable_internal_monologue: true,
        };
        ws.send(JSON.stringify(personaInitMsg));
        console.log('[useAgentAgent] Sending persona_init —', COGNI_PERSONA.id);
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
      try {
        const fs = getCogniFocusSubject();
        if (fs) {
          ws.send(
            JSON.stringify({
              type: 'set_focus_subject',
              subject: fs,
              student_override: true,
              v: 1.1,
            }),
          );
        }
      } catch (e) {
        console.warn('[useAgentAgent] set_focus_subject send failed:', e);
      }

      // Keep-alive ping every 28s — prevents idle-timeout disconnects from proxy/nginx/Docker.
      if (keepAliveIntervalRef.current) clearInterval(keepAliveIntervalRef.current);
      keepAliveIntervalRef.current = setInterval(() => {
        if (ws.readyState === WebSocket.OPEN) {
          try {
            if (process.env.NODE_ENV === 'development') {
              console.log('[useAgentAgent] Sending keep-alive ping');
            }
            ws.send(JSON.stringify({ type: 'ping', timestamp: Date.now(), v: 1.1 }));
          } catch { /* ignore — onclose will handle reconnect */ }
        }
      }, 28_000);
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

    ws.onclose = (event: CloseEvent) => {
      if (keepAliveIntervalRef.current) {
        clearInterval(keepAliveIntervalRef.current);
        keepAliveIntervalRef.current = null;
      }
      if (connectTimeoutRef.current) {
        clearTimeout(connectTimeoutRef.current);
        connectTimeoutRef.current = null;
      }
      if (!mountedRef.current) return;
      setIsConnected(false);

      const reason = (event.reason || '').trim() || '(none)';
      console.warn(
        `[useAgentAgent] WS closed — code=${event.code} reason="${reason}" clean=${event.wasClean}`,
      );

      if (!autoReconnect || !mountedRef.current) return;

      if (event.wasClean && event.code === 1000) {
        console.log('[useAgentAgent] Clean closure (1000), not scheduling reconnect');
        return;
      }

      const delay = 3000;
      console.log(`[useAgentAgent] Reconnecting in ${delay / 1000}s...`);
      reconnectTimer.current = setTimeout(connect, delay);
    };

    ws.onerror = (event: Event) => {
      console.error('[useAgentAgent] WS error:', event);
      setError('WebSocket connection error');
      if (ws.readyState === WebSocket.CONNECTING) {
        console.warn('[useAgentAgent] Error during CONNECTING — closing so onclose can run');
        try {
          ws.close();
        } catch {
          /* ignore */
        }
      }
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
        const fsAudio = getCogniFocusSubject();
        const rawCoach = readAssessmentCoaching();
        const coachingOut = rawCoach ? trimAssessmentCoachingForWs(rawCoach) : null;
        const payload = {
          type: 'audio',
          data: audioBase64,
          v: 1.1,
          ...(blob.type?.trim() ? { mime_type: blob.type.trim().slice(0, 128) } : {}),
          /** Canonical key for LLM — same text as persona_init / tutor context */
          system_prompt: COGNI_PERSONA.systemPrompt,
          persona_system_prompt: COGNI_PERSONA.systemPrompt,
          persona: { id: COGNI_PERSONA.id, platform: COGNI_PERSONA.platformName },
          ...(emotionalCtx.trim() ? { emotional_context: emotionalCtx } : {}),
          ...(fsAudio ? { focus_subject: fsAudio } : {}),
          ...(coachingOut ? { assessment_coaching: coachingOut } : {}),
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
    const fsNow = getCogniFocusSubject();
    const rawCoach = readAssessmentCoaching();
    const coachingOut = rawCoach ? trimAssessmentCoachingForWs(rawCoach) : null;
    const payload = JSON.stringify({
      type: 'text',
      text: trimmed,
      lang,
      practice,
      v: 1.1,
      ...(opts?.topicId != null ? { topic_id: opts.topicId } : {}),
      /** Injected every turn so LLM stays aligned with Cogni / Eduverse even if persona_init raced */
      // Teaching strategy suffix — adds research-backed pedagogy context to each turn
      system_prompt: activeStrategySuffixRef.current
        ? `${COGNI_PERSONA.systemPrompt}\n${activeStrategySuffixRef.current}`
        : COGNI_PERSONA.systemPrompt,
      persona_system_prompt: COGNI_PERSONA.systemPrompt,
      persona: { id: COGNI_PERSONA.id, platform: COGNI_PERSONA.platformName },
      // Teaching metadata for backend tutor pipeline (all intelligence layers)
      teaching_strategy: teachingCtxRef.current ? {
        student_level:             teachingCtxRef.current.studentLevel,
        student_state:             teachingCtxRef.current.studentState,
        btec_target:               teachingCtxRef.current.btecTarget,
        learning_moment:           teachingCtxRef.current.learningMoment,
        turn_count:                teachingCtxRef.current.sessionTurnCount,
        // Intuition layer
        student_pattern:           useBrainStore.getState().studentPattern,
        hidden_weakness:           useBrainStore.getState().hiddenWeakness,
        comprehension_confidence:  useBrainStore.getState().comprehensionConfidence,
        stress_signals:            useBrainStore.getState().stressSignals,
        // Temporal layer
        session_phase:             useBrainStore.getState().sessionPhase,
        energy_level:              useBrainStore.getState().estimatedEnergyLevel,
        days_to_exam:              useBrainStore.getState().daysToExam,
        // Persuasion layer
        persuasion_mode:           useBrainStore.getState().lastPersuasionMode,
      } : undefined,
      ...(gradeSnapshot ? { grade_result: gradeSnapshot } : {}),
      ...(emotionalCtx.trim() ? { emotional_context: emotionalCtx } : {}),
      ...(fsNow ? { focus_subject: fsNow } : {}),
      ...(coachingOut ? { assessment_coaching: coachingOut } : {}),
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
    const onFocusSubject = (): void => {
      const w = wsRef.current;
      const s = getCogniFocusSubject();
      if (w?.readyState === WebSocket.OPEN && s) {
        try {
          w.send(
            JSON.stringify({
              type: 'set_focus_subject',
              subject: s,
              student_override: true,
              v: 1.1,
            }),
          );
        } catch {
          /* ignore */
        }
      }
    };
    window.addEventListener(COGNI_FOCUS_SUBJECT_EVENT, onFocusSubject);
    return () => window.removeEventListener(COGNI_FOCUS_SUBJECT_EVENT, onFocusSubject);
  }, []);

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
          const raw = typeof window !== 'undefined' ? localStorage.getItem('eduverse-last-grade') : null;
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
      ensureWebSpeechVoicesChangeHook();
      window.addEventListener('cogni:auth-changed', onAuthChanged);
    }

    mountedRef.current = true;

    // Initialise gesture normalizer (idempotent capture-phase listener)
    initGestureNormalizer();
    if (process.env.NODE_ENV === 'development' && typeof window !== 'undefined') {
      (window as unknown as Record<string, unknown>).__cogniGestureEngine = unifiedGestureEngine;
    }

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

      if (keepAliveIntervalRef.current) {
        clearInterval(keepAliveIntervalRef.current);
        keepAliveIntervalRef.current = null;
      }
      if (connectTimeoutRef.current) {
        clearTimeout(connectTimeoutRef.current);
        connectTimeoutRef.current = null;
      }

      if (reconnectTimer.current) {
        clearTimeout(reconnectTimer.current);
        reconnectTimer.current = null;
      }

      try {
        wsRef.current?.close(1000, 'Component unmounting');
      } catch {
        /* ignore */
      }
      wsRef.current = null;

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
