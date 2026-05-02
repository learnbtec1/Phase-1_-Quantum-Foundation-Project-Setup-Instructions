/**
 * useAgentAgent.ts — Phase 4 Multi-Modal Autonomous Agent Hook
 *
 * Orchestrates the complete Phase 4 pipeline:
 *
 *   [Microphone] → useVAD → WebSocket → [Backend]
 *       → JSON AgentFrame → BrainStore.processFrame()
 *       → AgentDirector (gestures, expressions, head, voice)
 *       → AgentDirector → HTTP `/api/tts-with-timing` (`speakWithTTS`; WS speech_data MP3 intentionally ignored).
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
  useLayoutEffect,
  useRef,
  useState,
} from 'react';
import { useVAD }                          from '@/hooks/useVAD';
import { useBrainStore }                   from '@/store/useBrainStore';
import { agentDirector }                   from '@/ai/avatar/AgentDirector';
import { unifiedGestureEngine, initGestureNormalizer } from '@/ai/cognitive/UnifiedGestureEngine';
import { emitUserSpeechTickForAnticipation } from '@/lib/behavior/anticipationLayer';
import { PRIORITY } from '@/constants/gestures';
import { PROACTIVE_QUESTION_MS } from '@/config/avatar';
import { fireMentorSilenceCheckInMotion } from '@/lib/avatar/motionIntentContinuity';
import { emotionalMemoryManager }          from '@/ai/avatar/EmotionalMemoryManager';
import type { EmotionLabel, AgentFrame } from '@/types/ai';
import { COGNI_PERSONA, COGNI_JSON_BRAIN_SYSTEM_APPEND } from '@/config/personality';
import { buildDeviceContextPayload }       from '@/lib/deviceContext';
import { resetSpeechIntentHints } from '@/lib/avatar/speechIntentHints';
import { automaticGestureInjectorsDisabled } from '@/lib/avatar/automaticGestureInjectors';
import {
  COGNI_VAD_AUDIO_STABILITY_RETRY_DELAY_MS,
  COGNI_VAD_AUDIO_STABILITY_RETRY_MAX,
  dispatchAvatarSpeakEndForTtsPlayback,
  getTtsPlaybackElementForVadGate,
  isOutboundTtsAudioStableForMic,
  stopTTSGlobally,
} from '@/ai/io/tts';
import {
  cogniMetricsRecordWsRtt,
  cogniMetricsSetWsConnected,
} from '@/lib/observability/cogniMetrics';
import { getAccessToken, getPublicDevOpaqueToken, hasStoredAccessToken } from '@/lib/auth';
import { handleUserMessage } from '@/lib/ai/handleUserMessage';
import { microExprBargeInPulse } from '@/ai/avatar/microExpressionLayer';
import { inferUserMirrorEmotion, inferUserSpeechRhythm } from '@/lib/avatar/userEmotionMirror';
import { getProfile, recordInteractionTick, recordUserEmotionalSnapshot } from '@/lib/avatar/emotionalMemory';
import { tickPersonalityFromInteraction } from '@/lib/avatar/personalityEvolution';
import { mergeOpinionIntoEmotionalContext, recordOpinionTopicSnapshot } from '@/lib/avatar/opinionEngine';
import { mergeCompanionshipIntoEmotionalContext } from '@/lib/avatar/companionship';
import { ensureWebSpeechVoicesChangeHook } from '@/ai/io/webSpeechVoice';
import {
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
import { intuitionEngine } from '@/ai/cognitive/IntuitionEngine';
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
import { nowMs as masterClockNowMs } from '@/lib/avatar/masterClock';
import {
  ipv4LoopbackWsUrl,
  buildDefaultWsAgentUrl,
  agentApiHealthUrlFromWsAgentUrl,
} from '@/lib/wsAgentUrl';
import { traceCogniIntegration } from '@/lib/integrationTrace';
import {
  cogniDuplexBlocksUserBargeIn,
  cogniDuplexIsSpeaking,
  cogniDuplexIsWithinPostTtsVadCooldown,
  cogniDuplexMarkSpeakingEnded,
  cogniDuplexSyncListeningUi,
  cogniDuplexTryInit,
  COGNI_duplex_POST_TTS_VAD_COOLDOWN_MS,
} from '@/lib/audio/cogniDuplexGate';
import { COGNI_STT_WEBSPEECH_LANG, COGNI_STT_WHISPER_LANG } from '@/lib/audio/sttLocale';

/** When true (and backend `COGNI_WS_ALLOW_ANONYMOUS=true`), open `/ws/agent` without JWT subprotocol if no valid token. */
function wsGuestModeEnabled(): boolean {
  return (
    process.env.NEXT_PUBLIC_COGNI_WS_ALLOW_ANONYMOUS === 'true' ||
    process.env.NEXT_PUBLIC_COGNI_WS_GUEST_OK === 'true'
  );
}

/**
 * When not false (default): GET /api/health before opening WebSocket on initial mount.
 * Avoids Chromium's native "WebSocket connection … failed" when nothing listens on the port.
 * Set `NEXT_PUBLIC_WS_PREFLIGHT_HEALTH=false` if /api/health is blocked by a proxy.
 */
function wsPreflightHealthEnabled(): boolean {
  if (typeof process === 'undefined') return true;
  return process.env.NEXT_PUBLIC_WS_PREFLIGHT_HEALTH !== 'false';
}

/** Trim + strip whitespace — JWT in Sec-WebSocket-Protocol must be a single opaque token string. */
function sanitizeTokenForWsHandshake(raw: string): string {
  return raw.replace(/\s+/g, '').trim();
}

/** True if string looks like a standard JWT (three base64url segments; header usually starts with eyJ). */
function tokenLooksLikeJwtForWsSubprotocol(t: string): boolean {
  if (t.length < 20 || !t.startsWith('eyJ')) return false;
  const parts = t.split('.');
  return parts.length === 3 && parts.every((p) => p.length > 0);
}

/**
 * Opaque / dev placeholder tokens must NOT be sent in Sec-WebSocket-Protocol (can break handshake).
 * Use plain `new WebSocket(url)` + first-frame `{ type: "auth", token }` instead.
 */
function shouldAvoidJwtSubprotocolInHandshake(raw: string): boolean {
  const t = sanitizeTokenForWsHandshake(raw);
  if (!t) return true;
  if (t === 'test-token-123') return true;
  const dev = getPublicDevOpaqueToken();
  if (dev && t === dev) return true;
  if (!tokenLooksLikeJwtForWsSubprotocol(t)) return true;
  return false;
}

// ─── Public hook interface ────────────────────────────────────────────────────

/** Optional flags for Phase B adaptive practice (`type: text` + practice). */
export interface SendTextOptions {
  practice?: boolean;
  topicId?:  number;
  /** Internal: avoid infinite loop when marketing RAG path retries normal chat. */
  skipAssignmentRag?: boolean;
}

export interface AgentAgentOptions {
  /** WebSocket endpoint URL. Default: `buildDefaultWsAgentUrl()` — `NEXT_PUBLIC_WS_URL` → `NEXT_PUBLIC_AGENT_WS` → من `NEXT_PUBLIC_API_URL`. */
  wsUrl?:         string;
  /** Attempt automatic reconnect after disconnect. Default: true */
  autoReconnect?: boolean;
  /** BCP-47 language tag for TTS / VAD. Default: 'ar-JO' (Jordanian) */
  lang?:          string;
}

/** Mic / Whisper pipeline phase for conversational UI status lines. */
export type SttUiPhase = 'idle' | 'listening' | 'converting';

export interface AgentAgentState {
  /** True while the microphone / VAD is actively recording */
  isListening:     boolean;
  /** True while the WebSocket is in OPEN state */
  isConnected:     boolean;
  /** True while waiting for a backend reply */
  isProcessing:    boolean;
  /** VAD / backend STT status for user-facing indicators */
  sttUiPhase:      SttUiPhase;
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

// ─── Constants ─────────────────────────────────────────────────────────────────

/**
 * Milliseconds of silence (after the scene is ready) before the avatar
 * proactively greets the student.  16 s gives the user time to orient
 * themselves in the 3-D room before any greeting fires.
 */
const IDLE_TIMEOUT = 16_000;

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
/** BrainPersist / initBrainPersistence — optional returning-student opener for first WS prompt. */
function _readResumeSessionForProactiveGreeting(): { lastTopic: string; lastMood: string } | null {
  if (typeof window === 'undefined') return null;
  const w = (window as unknown as {
    __cogniLastSession?: { lastTopic?: string; lastMood?: string; lastSeen?: string };
  }).__cogniLastSession;
  const topic = String(w?.lastTopic ?? '').trim();
  if (!topic) return null;
  const seen = w?.lastSeen ? new Date(w.lastSeen).getTime() : NaN;
  const ageMs = Number.isFinite(seen) ? Date.now() - seen : 0;
  if (ageMs > 14 * 86_400_000) return null;
  return { lastTopic: topic.slice(0, 200), lastMood: String(w?.lastMood ?? 'neutral').slice(0, 48) };
}

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

export function useAgentAgent({
  wsUrl: wsUrlProp,
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
  const [sttUiPhase,     setSttUiPhase]     = useState<SttUiPhase>('idle');
  const sttUiPhaseDedupRef = useRef<SttUiPhase>('idle');
  const bumpSttUiPhase = useCallback((next: SttUiPhase) => {
    if (sttUiPhaseDedupRef.current === next) return;
    sttUiPhaseDedupRef.current = next;
    setSttUiPhase(next);
  }, []);
  /** True after the one-time proactive greeting has been sent this session. */
  const [hasInitiated,   setHasInitiated]   = useState(false);

  // ── Refs ─────────────────────────────────────────────────────────────────
  /** Set when an audio segment is sent; cleared when `speech` includes `transcript` (voice turn). */
  const pendingUserSttRef  = useRef(false);
  const wsRef              = useRef<WebSocket | null>(null);
  const reconnectTimer     = useRef<ReturnType<typeof setTimeout> | null>(null);
  const mountedRef         = useRef(true);
  const isListeningRef     = useRef(false);
  const idleTimerRef       = useRef<ReturnType<typeof setTimeout> | null>(null);
  /** Tracks avatar-speaking state via window events — kept as a ref to avoid re-renders. */
  const isSpeakingRef      = useRef(false);
  /** Cleared on explicit stop / unmount (legacy half-duplex auto-resume disabled — mic is manual-only). */
  const vadResumeTimerRef  = useRef<number | null>(null);
  /** Timestamp (ms) of the last empty_transcript warn — used to rate-limit console spam. */
  const lastEmptyErrorRef  = useRef(0);
  /** V31 — suppress duplicate client-side TTS fallback when backend repeats tts_unavailable for same text */
  const lastTtsFallbackTextRef = useRef('');
  const lastTtsFallbackAtRef   = useRef(0);
  /** Last streamed dialogue — Web Speech escalation / autonomous recovery binder */
  const recoverySpeakTextRef   = useRef('');
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
  /** Last inferred user mood for emotional memory (not avatar reply emotion). */
  const lastUserMoodRef = useRef<EmotionLabel>('neutral');
  /** VAD segment timing — used with transcript length for speech rhythm mirroring */
  const vadSpeechStartMsRef = useRef(0);
  const lastUtteranceDurationMsRef = useRef(2400);
  /** Matches backend ``speech_start`` / ``speech`` ``turn_id`` for stale-frame drops */
  const currentSpeechTurnIdRef = useRef<string | null>(null);
  /** Segments captured while WS is CONNECTING/CLOSED — sent after OPEN (see flush effect). */
  const pendingAudioBlobsRef = useRef<Blob[]>([]);
  const MAX_PENDING_AUDIO_BLOBS = 5;

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
  /** Retries GET /api/health when preflight fails (backend down). Cleared on success or unmount. */
  const wsPreflightRetryRef = useRef<ReturnType<typeof setInterval> | null>(null);
  /** Latest preflight runner — interval always calls this ref (avoids stale connect). */
  const runHealthPreflightOnceRef = useRef<() => Promise<void>>(async () => {});
  /** Consecutive abnormal closes (1006) — stop reconnect after threshold. */
  const ws1006StreakRef = useRef(0);
  /** Set true after repeated 1006; cleared on auth-changed or successful open. */
  const wsReconnectStoppedRef = useRef(false);
  /** After 1006 with JWT subprotocol, retry once with plain handshake (auth frame only). */
  const wsSkipSubprotocolOnceRef = useRef(false);
  const lastConnectUsedJwtSubprotocolRef = useRef(false);
  /** Reset to `true` on each successful `onopen` so one fallback remains available per connection cycle. */
  const ws1006FallbackPendingRef = useRef(true);
  /** Monotonic ping send time (`performance.now()`) — paired with inbound `pong` for WS RTT EWMA */
  const wsPingSentPerfRef = useRef<number | null>(null);

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
    if (automaticGestureInjectorsDisabled()) return;
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

  // ── Audio: WebSocket carries agent frames only — all TTS playback is AgentDirector → HTTP `/api/tts-with-timing`; stopTTSGlobally on interrupt ──

  const stopAllAudio = useCallback((): void => {
    clearCoSpeechTimers();
    clearPerformanceTimers();
    stopTTSGlobally();
    if (typeof window !== 'undefined' && window.speechSynthesis) {
      try {
        window.speechSynthesis.cancel();
      } catch { /* ignore */ }
    }
  }, [clearCoSpeechTimers, clearPerformanceTimers]);

  /**
   * User took the floor while the avatar was mid-TTS, mid-gesture queue, or processing a reply.
   * Smooth TTS fade (via cogni:avatar:interrupt), VRMA crossfade to idle, cancel queued gestures,
   * clear lip timeline, subtle head + micro-expression, then brain listening hints.
   */
  const runAvatarBargeIn = useCallback((): void => {
    if (typeof window === 'undefined') return;
    if (cogniDuplexBlocksUserBargeIn()) {
      const kill = (
        window as Window & {
          __cogniDisableBargeIn?: boolean;
        }
      ).__cogniDisableBargeIn;
      if (kill === true) {
        // eslint-disable-next-line no-console
        console.log('[BARGE-IN BLOCKED]', '__cogniDisableBargeIn');
      } else {
        // eslint-disable-next-line no-console
        console.log('[BARGE-IN BLOCKED DURING SPEAKING]');
      }
      return;
    }

    const brain = useBrainStore.getState();
    const busy = isSpeakingRef.current || brain.talking || isProcessingRef.current;
    if (!busy) return;

    clearCoSpeechTimers();
    clearPerformanceTimers();

    unifiedGestureEngine.cancelAll();
    unifiedGestureEngine.cancelScheduledBehavior();

    try {
      window.dispatchEvent(new CustomEvent('cogni:avatar:interrupt'));
    } catch {
      /* ignore */
    }

    try {
      window.dispatchEvent(new CustomEvent('avatar:visemes:clear'));
    } catch {
      /* ignore */
    }
    try {
      window.dispatchEvent(new CustomEvent('avatar:vrma:barge-in'));
    } catch {
      /* ignore */
    }
    try {
      window.dispatchEvent(new CustomEvent('avatar:blink', { detail: { style: 'normal' } }));
    } catch {
      /* ignore */
    }
    try {
      window.dispatchEvent(
        new CustomEvent('avatar:headpose', {
          detail: { yaw: 0, pitch: 0.016, duration: 320 },
        }),
      );
    } catch {
      /* ignore */
    }
    try {
      microExprBargeInPulse();
    } catch {
      /* ignore */
    }

    try {
      if (window.speechSynthesis) window.speechSynthesis.cancel();
    } catch {
      /* ignore */
    }

    useBrainStore.getState().setTalking(false);
    useBrainStore.getState().setThinking(false);
    resetSpeechIntentHints();
  }, [clearCoSpeechTimers, clearPerformanceTimers]);

  const onVadSpeechStart = useCallback((): void => {
    if (typeof window !== 'undefined') {
      cogniDuplexTryInit();
      const st = window.__cogniState;
      if (st?.speaking) {
        // eslint-disable-next-line no-console
        console.log('[BARGE-IN BLOCKED]', 'onSpeechStart — speaking');
        return;
      }
      const audioEl = getTtsPlaybackElementForVadGate();
      const endWall = st?.lastOutboundTtsEndWallMs ?? 0;
      const inCooldown =
        typeof endWall === 'number' &&
        endWall > 0 &&
        cogniDuplexIsWithinPostTtsVadCooldown();
      const stable = isOutboundTtsAudioStableForMic(audioEl);
      // eslint-disable-next-line no-console
      console.log('[AUDIO STABILITY]', {
        ended: audioEl?.ended,
        paused: audioEl?.paused,
        currentTime: audioEl?.currentTime,
      });
      // eslint-disable-next-line no-console
      console.log('[COOLDOWN CHECK]', {
        delta: endWall > 0 ? Date.now() - endWall : null,
        limitMs: COGNI_duplex_POST_TTS_VAD_COOLDOWN_MS,
      });
      if (inCooldown || !stable) {
        console.warn('[BARGE-IN BLOCKED — COOLDOWN OR UNSTABLE]', 'onSpeechStart', {
          inCooldown,
          stable,
        });
        return;
      }
      if (cogniDuplexBlocksUserBargeIn()) {
        const kill = (window as Window & { __cogniDisableBargeIn?: boolean }).__cogniDisableBargeIn;
        if (kill === true) {
          // eslint-disable-next-line no-console
          console.log('[BARGE-IN BLOCKED]', 'onSpeechStart — __cogniDisableBargeIn');
        } else {
          // eslint-disable-next-line no-console
          console.log('[BARGE-IN BLOCKED DURING SPEAKING]', 'onSpeechStart');
        }
        return;
      }
    }
    vadSpeechStartMsRef.current = masterClockNowMs();
    runAvatarBargeIn();
    useBrainStore.getState().setUserSpeaking(true);
    bumpSttUiPhase('listening');
    if (typeof window === 'undefined') return;
    window.dispatchEvent(new CustomEvent('cogni:user:speaking'));
  }, [runAvatarBargeIn, bumpSttUiPhase]);

  // ── WebSocket frame handler ──────────────────────────────────────────────

  const handleFrame = useCallback((raw: unknown): void => {
    if (!mountedRef.current) return;
    const frame = raw as Record<string, unknown>;
    const type  = (frame.type ?? '') as string;

    // pong: keep silent — avoid console spam from 28s keep-alive
    if (type !== 'pong') {
      traceCogniIntegration('ws_inbound', {
        type,
        id: frame.id,
        turn_id: frame.turn_id,
        v: frame.v,
      });
      console.log(`[useAgentAgent] 📨 Received:`, type, frame);
    }

    switch (type) {

      case 'transcribing': {
        bumpSttUiPhase('converting');
        setIsProcessing(true);
        break;
      }

      // ── STT transcript ────────────────────────────────────────────────
      case 'transcript': {
        const transcript = ((frame.text ?? frame.transcript ?? '') as string).trim();
        if (!transcript) break;
        pendingUserSttRef.current = false;
        bumpSttUiPhase('idle');
        setLastTranscript(transcript);
        useBrainStore.getState().pushTurn({ role: 'user', text: transcript });
        useBrainStore.getState().setUserSpeaking(true);
        setTimeout(() => useBrainStore.getState().setUserSpeaking(false), 800);
        emitUserSpeechTickForAnticipation();
        const um = (frame.user_mood ?? frame.userMood) as string | undefined;
        lastUserMoodRef.current = um?.trim() ? toEmotionLabel(um.trim()) : 'neutral';

        const wordCount = transcript.split(/\s+/).filter(Boolean).length;
        const rhythm = inferUserSpeechRhythm({
          utteranceDurationMs: lastUtteranceDurationMsRef.current,
          charCount: transcript.length,
          wordCount,
        });
        const mirrorEm = inferUserMirrorEmotion({
          text: transcript,
          userMood: lastUserMoodRef.current,
          stressSignals: useBrainStore.getState().stressSignals,
        });
        useBrainStore.getState().setUserMirrorState({
          userMirrorEmotion: mirrorEm,
          userSpeechRhythm: rhythm,
        });
        recordUserEmotionalSnapshot(mirrorEm, { topicSnippet: transcript.slice(0, 80) });
        tickPersonalityFromInteraction({
          text: transcript,
          engagement: getProfile().engagement,
          mirrorEmotion: mirrorEm,
        });

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
          void unifiedGestureEngine.play(avatarBehavior.gesture, {
            priority: PRIORITY.NORMAL,
            replyText: transcript,
          });
          // Extra: if hidden weakness detected, trigger concerned look
          if (
            intuitionReading.hiddenWeakness &&
            typeof window !== 'undefined' &&
            !automaticGestureInjectorsDisabled()
          ) {
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

          // 2. Strategy gesture: unifiedGestureEngine.play above
          // 3. Intent gesture hint
          if (gestureHint && !automaticGestureInjectorsDisabled()) {
            setTimeout(() => {
              void unifiedGestureEngine.play(gestureHint, {
                priority: PRIORITY.NORMAL,
                durationMs: 2200,
                replyText: transcript,
              });
            }, 80);
          }

          // 4. Acknowledging nod — delayed further to sequence correctly
          //    Uses avatar:nod (now wired in VRMSkeletonManager) for micro nod
          if (!automaticGestureInjectorsDisabled()) {
            setTimeout(() => {
              window.dispatchEvent(new CustomEvent('avatar:nod', {
                detail: { intensity: 0.12, duration: 0.5 },
              }));
            }, 200);
          }

          window.dispatchEvent(new CustomEvent('agent:user-activity'));
        }
        break;
      }

      // ── Backend asked to stop TTS immediately (barge-in / turn cancelled) ───
      case 'stop_speech': {
        const stopTid =
          typeof (frame as { turn_id?: string }).turn_id === 'string'
            ? (frame as { turn_id?: string }).turn_id
            : undefined;
        if (
          stopTid &&
          currentSpeechTurnIdRef.current &&
          stopTid !== currentSpeechTurnIdRef.current
        ) {
          break;
        }
        currentSpeechTurnIdRef.current = null;
        clearCoSpeechTimers();
        stopAllAudio();
        useBrainStore.getState().setThinking(false);
        useBrainStore.getState().setTalking(false);
        setIsProcessing(false);
        if (typeof window !== 'undefined') {
          cogniDuplexMarkSpeakingEnded();
          window.dispatchEvent(new CustomEvent('avatar:visemes:clear'));
          resetSpeechIntentHints();
          dispatchAvatarSpeakEndForTtsPlayback();
        }
        console.log('[useAgentAgent] stop_speech — playback halted', frame);
        break;
      }

      case 'speech_start': {
        const tid = typeof (frame as { turn_id?: string }).turn_id === 'string' ? (frame as { turn_id?: string }).turn_id : undefined;
        const dur = typeof (frame as { duration_ms?: number }).duration_ms === 'number' ? (frame as { duration_ms?: number }).duration_ms : undefined;
        if (tid) {
          currentSpeechTurnIdRef.current = tid;
        }
        if (typeof window !== 'undefined') {
          window.dispatchEvent(
            new CustomEvent('avatar:speak:timeline-start', {
              detail: { turnId: tid, durationMs: dur, id: frame.id },
            }),
          );
        }
        break;
      }

      case 'speech_data': {
        const sdTurn =
          typeof (frame as { turn_id?: string }).turn_id === 'string'
            ? (frame as { turn_id?: string }).turn_id
            : undefined;
        if (
          sdTurn &&
          currentSpeechTurnIdRef.current &&
          sdTurn !== currentSpeechTurnIdRef.current
        ) {
          break;
        }
        const b64 = (frame as { audio_base64?: string }).audio_base64;
        const visRaw = (frame as { viseme_cues?: unknown }).viseme_cues;
        if (typeof window !== 'undefined') {
          window.dispatchEvent(
            new CustomEvent('avatar:speak:timeline-data', {
              detail: {
                turnId: sdTurn,
                audioBase64: b64,
                visemeCues: visRaw,
                wordCues: (frame as { word_cues?: unknown }).word_cues,
              },
            }),
          );
        }
        if (
          typeof b64 === 'string'
          && b64.replace(/\s/g, '').length > 32
        ) {
          // Timeline events still fire for tooling; playback is ElevenLabs HTTP only.
          // eslint-disable-next-line no-console -- product invariant
          console.warn('[useAgentAgent] WS speech_data base64 discarded (ElevenLabs HTTP-only audio policy)');
        }
        break;
      }

      case 'speech_end': {
        const eid = typeof (frame as { turn_id?: string }).turn_id === 'string' ? (frame as { turn_id?: string }).turn_id : undefined;
        if (eid && currentSpeechTurnIdRef.current && eid !== currentSpeechTurnIdRef.current) {
          break;
        }
        if (eid && currentSpeechTurnIdRef.current === eid) {
          currentSpeechTurnIdRef.current = null;
        }
        if (typeof window !== 'undefined') {
          window.dispatchEvent(
            new CustomEvent('avatar:speak:timeline-end', { detail: { turnId: eid } }),
          );
        }
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
          void unifiedGestureEngine.play('Thinking', {
            priority: PRIORITY.HIGH,
            responseClass: 'thinking',
          });
        }
        break;
      }

      // ── Speech (with or without PCM audio) ───────────────────────────
      case 'speech':
      case 'tts_unavailable': {
        const userTranscript = ((frame as { transcript?: string }).transcript ?? '').trim();
        if (userTranscript && pendingUserSttRef.current) {
          pendingUserSttRef.current = false;
          setLastTranscript(userTranscript);
        }
        bumpSttUiPhase('idle');

        const dialogueRaw = (frame.dialogue ?? frame.text ?? '') as string;
        const dialogue   = stripInternalSystemEvents(dialogueRaw.trim());
        const norm       = normalizeSpeechFrame({ ...frame, dialogue });
        if (!norm) {
          setIsProcessing(false);
          useBrainStore.getState().setThinking(false);
          break;
        }

        const ftid =
          typeof (frame as { turn_id?: string }).turn_id === 'string'
            ? (frame as { turn_id?: string }).turn_id
            : undefined;
        if (ftid) {
          if (
            currentSpeechTurnIdRef.current &&
            ftid !== currentSpeechTurnIdRef.current
          ) {
            if (process.env.NODE_ENV === 'development') {
              console.warn('[useAgentAgent] Ignoring stale speech frame', {
                frameTurnId: ftid,
                expectedTurnId: currentSpeechTurnIdRef.current,
              });
            }
            setIsProcessing(false);
            useBrainStore.getState().setThinking(false);
            break;
          }
          currentSpeechTurnIdRef.current = ftid;
        }

        stopAllAudio();

        const rawEmotion = norm.emotionRaw;

        const tsNow = Date.now();
        if (
          dialogue === lastTtsFallbackTextRef.current
          && tsNow - lastTtsFallbackAtRef.current < 10_000
        ) {
          console.warn('[useAgentAgent] Skipping duplicate TTS fallback (same text within 10s — likely quota loop)');
          setIsProcessing(false);
          useBrainStore.getState().setThinking(false);
          break;
        }

        setIsProcessing(false);
        setLastReply(dialogue);
        setLastDialogue(dialogue);
        recoverySpeakTextRef.current = dialogue;
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
        recordInteractionTick();
        lastUserMoodRef.current = userMoodLabel;

        // 3. Store avatar turn in short-term memory
        useBrainStore.getState().pushTurn({
          role:    'avatar',
          text:    dialogue,
          emotion: emotionLabel,
        });

        // 3b. Performance word-sync — فوراً (تزامن مع تقدير مدة الحوار؛ الصوت من speakWithTTS).
        clearPerformanceTimers();
        const wcRawForPerf = (frame as { word_cues?: unknown }).word_cues;
        const wcForPerf = Array.isArray(wcRawForPerf)
          ? wcRawForPerf.filter(
              (x): x is { t: number; w?: string } =>
                !!x && typeof x === 'object' && typeof (x as { t?: unknown }).t === 'number',
            )
          : undefined;

        // 3c. Co-speech يُقدَّر من نص الحوار (client TTS).
        clearCoSpeechTimers();

        // 4. Audio — مصدر واحد: AgentDirector.scheduleTTS → speakWithTTS (`/api/tts-with-timing`).
        //    لا تُستدعِ speakWithTTS هنا (ازدواجية). `speech_data` MP3 لا يُشغَّل مهما كان env؛ الليب مع HTMLAudioElement من HTTP TTS.
        //    NEXT_PUBLIC_USE_AGENT_MESSAGE_AZURE_TTS → مسار Canvas Azure SDK بدلاً من speakWithTTS.
        const contagion = frame.contagion as
          | { emotion?: string; intensity?: number; note?: string }
          | undefined;
        if (contagion?.emotion && typeof window !== 'undefined') {
          window.dispatchEvent(new CustomEvent('cogni:student_contagion', { detail: contagion }));
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

        agentDirector.scheduleTTS(dialogue, emotionLabel, 0);

        console.log(
          `[useAgentAgent] Speech frame — emotion="${rawEmotion}" len=${dialogue.length} tts=http`,
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
          pendingUserSttRef.current = false;
          bumpSttUiPhase('idle');
          setIsProcessing(false);
          break;
        }

        pendingUserSttRef.current = false;
        bumpSttUiPhase('idle');
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

      case 'pong': {
        const t0 = wsPingSentPerfRef.current;
        if (
          typeof performance !== 'undefined' &&
          t0 != null &&
          typeof performance.now === 'function'
        ) {
          const rtt = performance.now() - t0;
          cogniMetricsRecordWsRtt(rtt);
        }
        wsPingSentPerfRef.current = null;
        break;
      }

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

      case 'session_ack':
        // Backend session handshake — benign; avoids console noise
        break;

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
  }, [stopAllAudio, clearCoSpeechTimers, clearPerformanceTimers, scheduleCoSpeechForDialogue, bumpSttUiPhase]);

  const handleFrameRef = useRef<(raw: unknown) => void>(() => {});
  useLayoutEffect(() => {
    handleFrameRef.current = handleFrame;
  }, [handleFrame]);

  // ── WebSocket connection ───────────────────────────────────────────────────

  const connect = useCallback((): void => {
    const existing = wsRef.current;
    if (existing?.readyState === WebSocket.OPEN) return;
    if (existing?.readyState === WebSocket.CONNECTING) {
      console.warn('[useAgentAgent] WS already CONNECTING — skipping duplicate connect()');
      return;
    }
    if (typeof window === 'undefined') return;

    if (wsReconnectStoppedRef.current) {
      console.warn('[WS] Reconnect disabled — fix auth or refresh after repeated failures');
      return;
    }

    const allowGuestWs = wsGuestModeEnabled();

    /** Single read — avoids duplicate JWT parse + duplicate empty-token logs from getAccessToken(). */
    const trimmed = getAccessToken();

    if (!allowGuestWs) {
      if (!trimmed) {
        if (!hasStoredAccessToken()) {
          console.error(
            '[useAgentAgent] ❌ No JWT in localStorage (cogni_access_token / token) — aborting WebSocket. ' +
              'Server treats this as guest → tts_unavailable. Sign in first.',
          );
          setError('WebSocket: sign in required (no JWT in localStorage)');
        } else {
          console.error(
            '[useAgentAgent] ❌ JWT in localStorage failed validation (expired or malformed) — aborting WebSocket. Sign in again.',
          );
          setError('WebSocket: JWT invalid or expired — sign in again');
        }
        return;
      }
    }

    /** Base64url-safe single token — whitespace breaks Sec-WebSocket-Protocol on some stacks. */
    const tokenForWs = sanitizeTokenForWsHandshake(trimmed ?? '');

    const forcePlainHandshake = wsSkipSubprotocolOnceRef.current;
    if (forcePlainHandshake) {
      wsSkipSubprotocolOnceRef.current = false;
    }

    const useJwtSubprotocol =
      tokenForWs.length > 0 &&
      !shouldAvoidJwtSubprotocolInHandshake(tokenForWs) &&
      !forcePlainHandshake;

    if (!allowGuestWs && !tokenForWs) {
      console.error('[WS] ❌ No token after normalize');
      return;
    }

    if (allowGuestWs && !useJwtSubprotocol && !tokenForWs) {
      console.warn(
        '[useAgentAgent] Guest WebSocket (anonymous — no token in auth frame). Set NEXT_PUBLIC_COGNI_WS_ALLOW_ANONYMOUS=false when using real auth.',
      );
    }

    if (process.env.NODE_ENV === 'development' && tokenForWs && !useJwtSubprotocol && !forcePlainHandshake) {
      // eslint-disable-next-line no-console
      console.log(
        '[WS] Using plain WebSocket + auth frame (opaque or non-JWT token — not sent in Sec-WebSocket-Protocol)',
      );
    }

    if (process.env.NODE_ENV === 'development' && useJwtSubprotocol) {
      // eslint-disable-next-line no-console
      console.log('[AUTH] token preview:', tokenForWs.slice(0, 12));
    }

    const resolvedWs = wsUrlProp ?? buildDefaultWsAgentUrl();
    const url = ipv4LoopbackWsUrl(resolvedWs);
    if (process.env.NODE_ENV === 'development') {
      // eslint-disable-next-line no-console
      console.log(
        `[WS] Resolved agent URL (${wsUrlProp ? 'from prop' : 'NEXT_PUBLIC_WS_URL / NEXT_PUBLIC_API_URL'}) → ${url}`,
      );
    }
    console.log(`[useAgentAgent] Connecting → ${url}`);
    // Backend `agent_ws`: JWT via Sec-WebSocket-Protocol (`cogni-auth-v1`, token) and/or first text frame
    // `{ type: "auth", token }`. Query `?token=` is explicitly rejected (close 1008) — do not use URL params.
    if (typeof WebSocket === 'undefined') return;

    const protocolsExact: string[] = useJwtSubprotocol ? ['cogni-auth-v1', tokenForWs] : [];
    // eslint-disable-next-line no-console
    console.log(
      '[WS] handshake subprotocols (exact count):',
      useJwtSubprotocol
        ? JSON.stringify(['cogni-auth-v1', `${tokenForWs.slice(0, 12)}…len=${tokenForWs.length}`])
        : '[] (plain — auth via first frame if token present)',
    );

    let ws: WebSocket;
    try {
      if (useJwtSubprotocol) {
        // eslint-disable-next-line no-console
        console.log('[Network] 🔌 Opening WS with JWT Auth');
        // eslint-disable-next-line no-console
        console.log('[Network] (subprotocol: cogni-auth-v1 + JWT — not HTTP Authorization header)');
        ws = new WebSocket(url, protocolsExact);
      } else {
        // eslint-disable-next-line no-console
        console.log('[Network] 🔌 Opening WS without subprotocol (guest / opaque token / 1006 fallback)');
        ws = new WebSocket(url);
      }
    } catch (e) {
      console.error('[WS] new WebSocket threw (invalid URL or protocol list):', e);
      return;
    }

    lastConnectUsedJwtSubprotocolRef.current = useJwtSubprotocol;
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
      ws1006StreakRef.current = 0;
      wsReconnectStoppedRef.current = false;
      ws1006FallbackPendingRef.current = true;
      cogniMetricsSetWsConnected(true);
      setIsConnected(true);
      setError(null);
      // eslint-disable-next-line no-console
      console.log('[WS] ✅ CONNECTED');
      if (tokenForWs) {
        try {
          ws.send(JSON.stringify({ type: 'auth', token: tokenForWs, v: 1.1 }));
          console.log('[useAgentAgent] ✅ Auth frame sent (first text frame, v=1.1)');
        } catch (e) {
          console.warn('[useAgentAgent] auth frame send failed:', e);
        }
      } else {
        console.log('[useAgentAgent] Skipping auth frame (guest / anonymous session)');
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
            if (typeof performance !== 'undefined' && typeof performance.now === 'function') {
              wsPingSentPerfRef.current = performance.now();
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
        handleFrameRef.current(data);
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
      cogniMetricsSetWsConnected(false, true);
      setIsConnected(false);

      const reason = (event.reason || '').trim() || '(no reason)';
      console.warn('[WS] ❌ CLOSED', { code: event.code, reason, clean: event.wasClean });

      if (event.code === 1006) {
        ws1006StreakRef.current += 1;
        if (ws1006StreakRef.current >= 3) {
          wsReconnectStoppedRef.current = true;
          console.warn(
            '[WS] Repeated abnormal close (1006) — stopping reconnect (check JWT / backend / proxy)',
          );
        }
      } else {
        ws1006StreakRef.current = 0;
      }

      // One-shot: 1006 after JWT subprotocol often means proxy/stack rejection — try plain WS + auth frame.
      if (
        event.code === 1006 &&
        lastConnectUsedJwtSubprotocolRef.current &&
        ws1006FallbackPendingRef.current &&
        !allowGuestWs &&
        autoReconnect &&
        mountedRef.current &&
        !wsReconnectStoppedRef.current
      ) {
        ws1006FallbackPendingRef.current = false;
        wsSkipSubprotocolOnceRef.current = true;
        console.warn(
          '[WS] 1006 after Sec-WebSocket-Protocol JWT — retrying once without subprotocol (auth via first frame)',
        );
        if (reconnectTimer.current) clearTimeout(reconnectTimer.current);
        reconnectTimer.current = setTimeout(() => connect(), 150);
        return;
      }

      if (!autoReconnect || !mountedRef.current) return;

      if (event.wasClean && event.code === 1000) {
        console.log('[useAgentAgent] Clean closure (1000), not scheduling reconnect');
        return;
      }

      if (wsReconnectStoppedRef.current) return;

      let hasToken = false;
      try {
        hasToken = !!getAccessToken();
      } catch {
        hasToken = false;
      }
      if (!allowGuestWs && !hasToken) {
        console.error('[WS] ❌ Missing JWT');
        return;
      }

      const delay = 3000;
      console.log(`[useAgentAgent] Reconnecting in ${delay / 1000}s...`);
      reconnectTimer.current = setTimeout(connect, delay);
    };

    ws.onerror = (event: Event) => {
      // Browser Event has no useful enumerable fields — logging it shows "{}" in the console.
      const rs = ws.readyState;
      const stateStr =
        rs === WebSocket.CONNECTING
          ? 'CONNECTING'
          : rs === WebSocket.OPEN
            ? 'OPEN'
            : rs === WebSocket.CLOSING
              ? 'CLOSING'
              : rs === WebSocket.CLOSED
                ? 'CLOSED'
                : String(rs);

      setError('WebSocket connection error');

      // Failed handshake / connection refused: socket is often already CLOSED; `onclose` follows with code (e.g. 1006).
      // Do not use console.error here — it looks like an app bug; the situation is usually "backend down or wrong URL".
      if (rs === WebSocket.CLOSED || rs === WebSocket.CLOSING) {
        if (process.env.NODE_ENV === 'development') {
          console.warn(
            `[WS] connection failed (${stateStr}) url=${url} — ` +
              'ensure FastAPI is running and reachable (e.g. uvicorn on :8000). Close code/reason: next [WS] CLOSED log.',
          );
        }
        return;
      }

      if (rs === WebSocket.CONNECTING) {
        console.warn(
          `[WS] error during CONNECTING type=${event.type} url=${url} — see following [WS] CLOSED for code/reason`,
        );
        try {
          ws.close();
        } catch {
          /* ignore */
        }
        return;
      }

      // Rare: error while OPEN — worth a visible error.
      console.error(
        `[WS] ❌ ERROR type=${event.type} readyState=${stateStr} url=${url}`,
      );
      console.warn(
        '[useAgentAgent] WS error:',
        event.type,
        'readyState=',
        stateStr,
        'url=',
        url,
        '(see onclose for code/reason)',
      );
    };
  }, [wsUrlProp, autoReconnect]);

  const connectWsForRecoveryRef = useRef<(() => void) | undefined>(undefined);
  useLayoutEffect(() => {
    connectWsForRecoveryRef.current = connect;
  }, [connect]);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    type WRecover = Window & {
      __cogniRequestWsReconnect?: () => void;
    };
    const handler = (): void => {
      connectWsForRecoveryRef.current?.();
    };
    (window as WRecover).__cogniRequestWsReconnect = handler;
    return (): void => {
      delete (window as WRecover).__cogniRequestWsReconnect;
    };
  }, []);

  /**
   * Initial mount only: optional HTTP preflight so we do not call `new WebSocket` when the API host is down
   * (Chromium always logs that as a red "WebSocket connection failed" — cannot be suppressed in JS).
   */
  const runHealthPreflightOnce = useCallback(async (): Promise<void> => {
    if (!wsPreflightHealthEnabled()) {
      connect();
      return;
    }
    const resolvedWs = ipv4LoopbackWsUrl(wsUrlProp ?? buildDefaultWsAgentUrl());
    const healthUrl = agentApiHealthUrlFromWsAgentUrl(resolvedWs);
    const ac = new AbortController();
    const tmo = window.setTimeout(() => ac.abort(), 3000);
    try {
      const r = await fetch(healthUrl, { method: 'GET', cache: 'no-store', signal: ac.signal });
      clearTimeout(tmo);
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
    } catch (e) {
      clearTimeout(tmo);
      if (!mountedRef.current) return;
      if (!wsPreflightRetryRef.current) {
        console.warn(
          '[WS] Preflight GET',
          healthUrl,
          'failed — API not reachable; skipping WebSocket open (avoids Chromium "WebSocket connection failed").',
          'Start FastAPI (e.g. uvicorn :8000) or set NEXT_PUBLIC_WS_PREFLIGHT_HEALTH=false.',
          e,
        );
      }
      setError('Backend unreachable — is the API running?');
      if (!wsPreflightRetryRef.current) {
        wsPreflightRetryRef.current = setInterval(() => {
          void runHealthPreflightOnceRef.current();
        }, 5000);
      }
      return;
    }
    if (wsPreflightRetryRef.current) {
      clearInterval(wsPreflightRetryRef.current);
      wsPreflightRetryRef.current = null;
    }
    if (!mountedRef.current) return;
    connect();
  }, [connect, wsUrlProp]);

  runHealthPreflightOnceRef.current = runHealthPreflightOnce;

  const sendWsPayload = useCallback((payload: Record<string, unknown>) => {
    const ws = wsRef.current;
    if (!ws || ws.readyState !== WebSocket.OPEN) return;
    try {
      ws.send(JSON.stringify({ v: 1.1, ...payload }));
    } catch {
      /* ignore */
    }
  }, []);

  /** Poll until WebSocket is OPEN or closed / timeout (user may speak before handshake finishes). */
  const waitForWsReady = useCallback(async (maxMs: number): Promise<boolean> => {
    const start = typeof performance !== 'undefined' ? performance.now() : Date.now();
    while (true) {
      const w = wsRef.current;
      if (w?.readyState === WebSocket.OPEN) return true;
      if (w == null || w.readyState === WebSocket.CLOSED) return false;
      const now = typeof performance !== 'undefined' ? performance.now() : Date.now();
      if (now - start >= maxMs) {
        return wsRef.current != null && wsRef.current.readyState === WebSocket.OPEN;
      }
      await new Promise<void>((r) => setTimeout(r, 50));
    }
  }, []);

  /** Encode + send one mic segment to /ws/agent (shared by VAD and pending-audio flush). */
  const sendAudioBlobNow = useCallback(async (blob: Blob): Promise<void> => {
    const ws = wsRef.current;
    if (!ws || ws.readyState !== WebSocket.OPEN) {
      return;
    }
    setIsProcessing(true);
    try {
      console.log(
        `[Agent] Sending audio frame, size: ${blob.size} type=${blob.type || 'unknown'}`,
      );
      const audioBase64 = await audioInputToBase64(blob);
      const bsAudio = useBrainStore.getState();
      const emotionalCtx = mergeCompanionshipIntoEmotionalContext(
        mergeOpinionIntoEmotionalContext(
          emotionalMemoryManager.getContextSummary(),
          {
            userText: '',
            comprehensionConfidence: bsAudio.comprehensionConfidence,
            isAudioTurn: true,
          },
        ),
      );
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
        /** Backend Whisper: Arabic-only transcription (never auto English). Mirrors server default. */
        stt_language: COGNI_STT_WHISPER_LANG,
        ...(emotionalCtx.trim() ? { emotional_context: emotionalCtx } : {}),
        ...(fsAudio ? { focus_subject: fsAudio } : {}),
        ...(coachingOut ? { assessment_coaching: coachingOut } : {}),
      };
      ws.send(JSON.stringify(payload));
      pendingUserSttRef.current = true;
      bumpSttUiPhase('converting');
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
  }, [bumpSttUiPhase]);

  /** Higher floor reduces speaker bleed / room noise false triggers vs 0.045. */
  const vadSilenceThreshold = 0.08;

  useEffect(() => {
    console.log('[VAD CONFIG]', { threshold: vadSilenceThreshold });
  }, [vadSilenceThreshold]);

  const vadSpeechPipelineRef = useRef<(blob: Blob) => Promise<void>>(
    async function placeholderVadSpeechEnd(blob: Blob) {
      void blob;
      await Promise.resolve();
    },
  );

  vadSpeechPipelineRef.current = async (blob: Blob) => {
    const now = typeof performance !== 'undefined' ? performance.now() : Date.now();
    lastUtteranceDurationMsRef.current = Math.max(380, now - vadSpeechStartMsRef.current);
    console.log(
      '[useAgentAgent] VAD onSpeechEnd — blob',
      blob.size,
      'bytes',
      blob.type || '(no type)',
    );

    /** Upload path: Crosier duplex + Sonnet gate — honor only explicit automation kill; duplex speaking/reserved must not drop a finished segment. */
    if (typeof window !== 'undefined') {
      const kill = (window as Window & { __cogniDisableBargeIn?: boolean }).__cogniDisableBargeIn;
      if (kill === true) {
        // eslint-disable-next-line no-console
        console.log('[BARGE-IN BLOCKED]', 'onSpeechEnd discarded — __cogniDisableBargeIn');
        return;
      }
    }

    await waitForWsReady(12_000);

    // Guard: re-check connection after await (Sonnet's safety net)
    if (!wsRef.current || wsRef.current.readyState !== WebSocket.OPEN) {
      console.warn('[useAgentAgent] WS not ready after wait — blob dropped');
      return;
    }

    await sendAudioBlobNow(blob);
  };

  const vadOnSpeechEndStable = useCallback(async (blob: Blob): Promise<void> => {
    await vadSpeechPipelineRef.current(blob);
  }, []);

  const { isRecording, startListening: vadStart, stopListening: vadStop } = useVAD({
    lang: COGNI_STT_WEBSPEECH_LANG,
    // Less sensitive RMS + longer silence tail + min vocal span — fewer breath/keyboard/echo false STT sends.
    silenceThreshold:     vadSilenceThreshold,
    silenceGapMs:         1300,
    minSpeechDurationMs: 280,
    onSpeechStart: onVadSpeechStart,
    onSpeechEnd: vadOnSpeechEndStable,
  });

  useLayoutEffect(() => {
    if (!isConnected) return;
    const blobs = pendingAudioBlobsRef.current.splice(0);
    if (blobs.length === 0) return;
    console.log(
      '[useAgentAgent] Flushing',
      blobs.length,
      'queued audio blob(s) after WebSocket ready',
    );
    for (const b of blobs) {
      void sendAudioBlobNow(b);
    }
  }, [isConnected, sendAudioBlobNow]);

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

  /** VAD / useVAD silence segment — keep brain `isUserSpeaking` aligned with intent + gaze. */
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const onSilent = (): void => {
      useBrainStore.getState().setUserSpeaking(false);
    };
    window.addEventListener('cogni:user:silent', onSilent);
    return () => window.removeEventListener('cogni:user:silent', onSilent);
  }, []);

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
    cogniDuplexTryInit();
    if (typeof window !== 'undefined') {
      if (cogniDuplexIsSpeaking()) {
        // eslint-disable-next-line no-console
        console.warn('[useAgentAgent] startListening blocked — avatar is speaking (strict half-duplex)');
        console.log('[VAD BLOCKED]', true);
        return;
      }
      const audioGate = getTtsPlaybackElementForVadGate();
      let stabilityAttempt = 0;
      while (true) {
        const endMs = window.__cogniState?.lastOutboundTtsEndWallMs ?? 0;
        const inCooldown =
          typeof endMs === 'number' && endMs > 0 && cogniDuplexIsWithinPostTtsVadCooldown();
        const stable = isOutboundTtsAudioStableForMic(audioGate);
        // eslint-disable-next-line no-console
        console.log('[AUDIO STABILITY]', {
          ended: audioGate?.ended,
          paused: audioGate?.paused,
          currentTime: audioGate?.currentTime,
        });
        // eslint-disable-next-line no-console
        console.log('[COOLDOWN CHECK]', {
          delta: endMs > 0 ? Date.now() - endMs : null,
          limitMs: COGNI_duplex_POST_TTS_VAD_COOLDOWN_MS,
        });
        if (inCooldown || !stable) {
          console.warn('[VAD BLOCKED — COOLDOWN OR UNSTABLE]', { inCooldown, stable });
          if (inCooldown) {
            console.warn('[VAD BLOCKED — COOLDOWN]');
            return;
          }
          console.warn('[VAD BLOCKED — AUDIO NOT STABLE]');
          if (stabilityAttempt < COGNI_VAD_AUDIO_STABILITY_RETRY_MAX) {
            stabilityAttempt += 1;
            await new Promise<void>((resolve) =>
              setTimeout(resolve, COGNI_VAD_AUDIO_STABILITY_RETRY_DELAY_MS),
            );
            if (cogniDuplexIsSpeaking()) return;
            continue;
          }
          return;
        }
        break;
      }
    }
    if (isListeningRef.current) return;
    isListeningRef.current = true;

    // Interrupt any ongoing speech before listening (prevents echo)
    stopAllAudio();
    agentDirector.interruptSpeech();
    useBrainStore.getState().setPhysical({ isListening: true });
    emitListeningEvent(true);

    await vadStart();
    cogniDuplexSyncListeningUi(true);
    console.log('[useAgentAgent] Listening started');
  }, [vadStart, stopAllAudio]);

  const stopListening = useCallback((): void => {
    if (!isListeningRef.current) return;
    isListeningRef.current = false;
    if (vadResumeTimerRef.current) {
      clearTimeout(vadResumeTimerRef.current);
      vadResumeTimerRef.current = null;
    }

    vadStop();
    cogniDuplexSyncListeningUi(false);
    useBrainStore.getState().setPhysical({ isListening: false });
    emitListeningEvent(false);
    bumpSttUiPhase('idle');
    if (typeof window !== 'undefined') {
      window.dispatchEvent(new CustomEvent('cogni:user:silent'));
    }
    console.log('[useAgentAgent] Listening stopped');
  }, [vadStop, bumpSttUiPhase]);

  const stopListeningRef = useRef(stopListening);
  useLayoutEffect(() => {
    stopListeningRef.current = stopListening;
  }, [stopListening]);

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

    if (!opts?.skipAssignmentRag && !opts?.practice && trimmed.length > 0) {
      void (async () => {
        const ragHandled = await handleUserMessage(trimmed);
        if (ragHandled) {
          setIsProcessing(false);
          return;
        }
        sendText(trimmed, { ...opts, skipAssignmentRag: true });
      })();
      return;
    }

    /** لا تُسجَّل في BrainStore كرسالة مستخدم — تبقى تعليماً داخلياً للـ LLM فقط */
    const isInternalProactive = INTERNAL_SYSTEM_EVENT_PREFIX.test(trimmed);
    if (!isInternalProactive) {
      lastUserMoodRef.current = 'neutral';
    }
    if (!isInternalProactive && trimmed.length > 0) {
      const wc = trimmed.split(/\s+/).filter(Boolean).length;
      const estDur = Math.max(450, trimmed.length * 68);
      const st = useBrainStore.getState();
      const mirrorTx = inferUserMirrorEmotion({
        text: trimmed,
        userMood: lastUserMoodRef.current,
        stressSignals: st.stressSignals,
      });
      st.setUserMirrorState({
        userMirrorEmotion: mirrorTx,
        userSpeechRhythm: inferUserSpeechRhythm({
          utteranceDurationMs: estDur,
          charCount: trimmed.length,
          wordCount: wc,
        }),
      });
      recordUserEmotionalSnapshot(mirrorTx, { topicSnippet: trimmed.slice(0, 80) });
      tickPersonalityFromInteraction({
        text: trimmed,
        engagement: getProfile().engagement,
        mirrorEmotion: mirrorTx,
      });
    }

    // One-shot: attach the BTEC grade snapshot from the assessment page (if any).
    // The backend's process_text() injects it as a Debrief Context block so
    // the avatar can say "أرى إنك حصلت على Merit في موضوع X…" naturally.
    const gradeSnapshot = _consumeLastGrade();
    const bsSend = useBrainStore.getState();
    const emotionalCtx = mergeCompanionshipIntoEmotionalContext(
      mergeOpinionIntoEmotionalContext(
        emotionalMemoryManager.getContextSummary(),
        {
          userText: trimmed,
          comprehensionConfidence: bsSend.comprehensionConfidence,
          isAudioTurn: false,
        },
      ),
    );
    if (!isInternalProactive && trimmed.length > 0) {
      recordOpinionTopicSnapshot(trimmed);
    }
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
        '[SYSTEM_EVENT: يبدو أنك تفكّر بعمق أو متوقف. بلهجة أردنية دافئة اسأل جملة واحدة قصيرة: هل في نقطة مش واضحة أو بدك نرجع خطوة؟ لا تكرر عبارات الجلسة السابقة.]';
      fireMentorSilenceCheckInMotion();
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
    pendingUserSttRef.current = false;
    bumpSttUiPhase('idle');
    setHasInitiated(false); // Allow one new proactive greeting after history reset
    if (proactiveSilenceTimerRef.current) {
      clearTimeout(proactiveSilenceTimerRef.current);
      proactiveSilenceTimerRef.current = null;
    }
    console.log('[useAgentAgent] History cleared');
  }, [stopAllAudio, bumpSttUiPhase]);
  useEffect(() => {
    if (typeof window === 'undefined') return;
    cogniDuplexTryInit();

    /**
     * While the avatar speaks, tear down mic capture entirely and sync listening UI off.
     * Mic does NOT reopen after TTS — user must tap the mic button again (strict manual UX).
     */
    const pauseListeningDuringOutboundSpeech = (): void => {
      if (!isListeningRef.current) return;
      stopListeningRef.current();
      if (typeof process !== 'undefined' && process.env.NODE_ENV === 'development') {
        console.log('[useAgentAgent] Half-duplex: mic stopped during avatar speech (manual-only — no auto-resume)');
      }
    };

    const scheduleListeningResumeAfterOutboundSpeech = (): void => {
      isSpeakingRef.current = false;
    };

    const onDuplexPauseMic = (): void => {
      isSpeakingRef.current = true;
      pauseListeningDuringOutboundSpeech();
    };

    const onTtsAborted = (): void => {
      scheduleListeningResumeAfterOutboundSpeech();
    };

    const onSpeakStartDuplex = (): void => {
      isSpeakingRef.current = true;
      pauseListeningDuringOutboundSpeech();
    };

    const onSpeakEndDuplex = (): void => {
      scheduleListeningResumeAfterOutboundSpeech();
    };

    window.addEventListener('cogni:duplex:pause_mic', onDuplexPauseMic as EventListener);
    window.addEventListener('cogni:duplex:tts_aborted', onTtsAborted as EventListener);
    window.addEventListener('avatar:speak:start', onSpeakStartDuplex);
    window.addEventListener('avatar:speak:end', onSpeakEndDuplex);
    return () => {
      if (vadResumeTimerRef.current) {
        clearTimeout(vadResumeTimerRef.current);
        vadResumeTimerRef.current = null;
      }
      window.removeEventListener('cogni:duplex:pause_mic', onDuplexPauseMic as EventListener);
      window.removeEventListener('cogni:duplex:tts_aborted', onTtsAborted as EventListener);
      window.removeEventListener('avatar:speak:start', onSpeakStartDuplex);
      window.removeEventListener('avatar:speak:end', onSpeakEndDuplex);
    };
  }, []); // reads _vad*Ref — empty deps intentional

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
      if (waitTimer) {
        clearTimeout(waitTimer);
        waitTimer = null;
      }
    };
    window.addEventListener('avatar:thinking', onThinkingStart);
    window.addEventListener('avatar:speak:start', onThinkingEnd);
    window.addEventListener('avatar:speak:end', onThinkingEnd);
    return () => {
      if (waitTimer) clearTimeout(waitTimer);
      window.removeEventListener('avatar:thinking', onThinkingStart);
      window.removeEventListener('avatar:speak:start', onThinkingEnd);
      window.removeEventListener('avatar:speak:end', onThinkingEnd);
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

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

      const resume = _readResumeSessionForProactiveGreeting();
      const prompt = pendingGrade
        ? `[SYSTEM_EVENT: الطالب عاد للتو من صفحة التقييم. درجته: ${pendingGrade.final_grade ?? ''}، المادة: ${pendingGrade.subject ?? ''}. قدّم له تغذية راجعة تشجيعية باللهجة الأردنية — اذكر الدرجة بشكل طبيعي في حديثك ثم اسأله عن نقطة يريد تحسينها.]`
        : resume
          ? `[SYSTEM_EVENT: طالب عائد. آخر موضوع اشتغلنا عليه: "${resume.lastTopic}". آخر مزاج مسجّل: ${resume.lastMood}. رحّب بلهجة أردنية دافئة واسأل بلطف إذا بده يكمّل على هالموضوع — جملة أو جملتين بس، بدون تكرار نمطي.]`
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
      ws1006StreakRef.current = 0;
      wsReconnectStoppedRef.current = false;
      ws1006FallbackPendingRef.current = true;
      wsSkipSubprotocolOnceRef.current = false;
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

    // WebSocket: guest mode (no JWT) or valid token — optional GET /api/health before new WebSocket (see runHealthPreflightOnce).
    if (wsGuestModeEnabled() || getAccessToken()) {
      void runHealthPreflightOnce();
    }

    return () => {
      mountedRef.current = false;
      if (wsPreflightRetryRef.current) {
        clearInterval(wsPreflightRetryRef.current);
        wsPreflightRetryRef.current = null;
      }
      if (vadResumeTimerRef.current) {
        clearTimeout(vadResumeTimerRef.current);
        vadResumeTimerRef.current = null;
      }

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
    sttUiPhase,
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
