/**
 * useAgentAgent.ts — Phase 4 Multi-Modal Autonomous Agent Hook
 *
 * Orchestrates the complete Phase 4 pipeline:
 *
 *   [Microphone] → useVAD (armed after session + scene; closed on cold load) → WebSocket → [Backend]
 *       → JSON AgentFrame → BrainStore.processFrame()
 *       → AgentDirector (gestures, expressions, head, voice)
 *       → WebSocket `speech_data` + `playWsAgentTtsAudio` when enabled (single audio authority),
 *         else fallback to AgentDirector → /api/tts-with-timing
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
import { trackGestureDispatch } from '@/app/avatar-agent/motion/__boneAuthority';
import { emitUserSpeechTickForAnticipation } from '@/lib/behavior/anticipationLayer';
import { PRIORITY } from '@/constants/gestures';
import { PROACTIVE_QUESTION_MS } from '@/config/avatar';
import { fireMentorSilenceCheckInMotion } from '@/lib/avatar/motionIntentContinuity';
import { emotionalMemoryManager }          from '@/ai/avatar/EmotionalMemoryManager';
import type { EmotionLabel, AgentFrame } from '@/types/ai';
import { COGNI_PERSONA, COGNI_JSON_BRAIN_SYSTEM_APPEND } from '@/config/personality';
import { buildDeviceContextPayload }       from '@/lib/deviceContext';
import { resetSpeechIntentHints, setSpeechIntentHintsFromText } from '@/lib/avatar/speechIntentHints';
import { automaticGestureInjectorsDisabled } from '@/lib/avatar/automaticGestureInjectors';
import {
  getClientTtsAudioElement,
  isElevenLabsTtsProvider,
  playWsAgentTtsAudio,
  stopTTSGlobally,
} from '@/ai/io/tts';
import { setSpeechEmotionBridge } from '@/ai/voice/speechEmotionBridge';
import { getAccessToken, hasStoredAccessToken } from '@/lib/auth';
import { handleUserMessage } from '@/lib/ai/handleUserMessage';
import { microExprBargeInPulse } from '@/ai/avatar/microExpressionLayer';
import { inferUserMirrorEmotion, inferUserSpeechRhythm } from '@/lib/avatar/userEmotionMirror';
import { getProfile, recordInteractionTick, recordUserEmotionalSnapshot } from '@/lib/avatar/emotionalMemory';
import { tickPersonalityFromInteraction } from '@/lib/avatar/personalityEvolution';
import { mergeOpinionIntoEmotionalContext, recordOpinionTopicSnapshot } from '@/lib/avatar/opinionEngine';
import { mergeCompanionshipIntoEmotionalContext } from '@/lib/avatar/companionship';
import {
  getStableWebSpeechVoice,
  ensureWebSpeechVoicesChangeHook,
} from '@/ai/io/webSpeechVoice';
import {
  estimateDialogueDurationMs,
  planCoSpeechGestures,
} from '@/ai/avatar/coSpeechPlanner';
import { normalizeSpeechFrame, toAgentFrame } from '@/lib/frameNormalizer';
import { dispatchAvatar } from '@/utils/events/normalizeAvatarEvents';
import { diagVad } from '@/utils/diagnostics';
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
import { nowMs as masterClockNowMs } from '@/lib/avatar/masterClock';
import {
  ipv4LoopbackWsUrl,
  buildDefaultWsAgentUrl,
  agentApiHealthUrlFromWsAgentUrl,
  readWsConnectTimeoutMs,
  agentWsSkippedByEnv,
  WS_CLIENT_OPEN_TIMEOUT_CODE,
} from '@/lib/wsAgentUrl';
import { traceCogniIntegration } from '@/lib/integrationTrace';
import { resumeSharedAudioContext } from '@/lib/audio/avatarAudioContext';

/** Keep-alive ping period (ms); stay below typical proxy idle timeouts. */
const WS_KEEPALIVE_PING_MS = 28_000;
/** Close and reconnect when no pong arrives within this window while the socket reports OPEN (zombie TCP). */
const WS_STALE_NO_PONG_MS = 60_000;
/** Application-defined WebSocket close code for stale keep-alive (see RFC close codes 4000–4999). */
const WS_STALE_KEEPALIVE_CLOSE_CODE = 4409;
/** Expected inbound `speech_data` payloads stopped while WS TTS timeline is active (transport vs decoder freeze). */
const WS_AUDIO_STALL_CLOSE_CODE = 4410;
/** If no streamed audio chunk/time activity for this long while WS TTS timeline is armed, reconnect. */
const WS_AUDIO_STALL_MS = 10_000;

/** Exponential backoff (ms), capped at 10s — pass `attempts` after increment (first reconnect → 2000 ms). */
function wsReconnectBackoffMs(attempts: number): number {
  return Math.min(1000 * 2 ** attempts, 10_000);
}

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
  const dev = (process.env.NEXT_PUBLIC_DEV_AUTH_TOKEN ?? '').trim();
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
  /**
   * After the user starts the session (e.g. «ابدأ الآن»), arms hands-free VAD when WS is open and the scene is ready.
   * Keeps the mic closed on initial page load. Default false.
   */
  sessionActive?: boolean;
}

/** Mic / Whisper pipeline phase for conversational UI status lines. */
export type SttUiPhase = 'idle' | 'listening' | 'converting';

export interface AgentAgentState {
  /** True while the VAD session is armed (stream + segment detector); not toggled manually when using hands-free mode */
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
  sendText:        (text: string, opts?: SendTextOptions) => Promise<void>;
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
  // Phase 6: Debug guard — warn if the LLM response contains a leaked SYSTEM_EVENT tag.
  // This should NEVER fire in normal operation.
  if (raw && /\[SYSTEM_EVENT:/i.test(raw)) {
    console.warn('[SYSTEM_EVENT_LEAK] Backend allowed tag through to frontend. Stripping now.', raw.slice(0, 120));
  }
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

/**
 * Default off: mic arms only when the user toggles listening.
 * Set `NEXT_PUBLIC_VAD_AUTO_ARM=true` to restore “hands-free” arm on session + scene ready.
 */
function isNextPublicVadAutoArmEnabled(): boolean {
  if (typeof process === 'undefined') return false;
  const v = (process.env.NEXT_PUBLIC_VAD_AUTO_ARM ?? '').trim().toLowerCase();
  return v === '1' || v === 'true' || v === 'yes';
}

// ─── Hook ─────────────────────────────────────────────────────────────────────

export function useAgentAgent({
  wsUrl: wsUrlProp,
  autoReconnect = true,
  lang          = 'ar-JO',   // Jordanian Arabic dialect — Dr. Hamza
  sessionActive = false,
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
  /** True after the one-time proactive greeting has been sent this session. */
  const [hasInitiated,   setHasInitiated]   = useState(false);

  // ── Refs ─────────────────────────────────────────────────────────────────
  /** Set when an audio segment is sent; cleared when `speech` includes `transcript` (voice turn). */
  const pendingUserSttRef  = useRef(false);
  const wsRef              = useRef<WebSocket | null>(null);
  const reconnectTimer     = useRef<ReturnType<typeof setTimeout> | null>(null);
  /** Counts disconnect→reconnect cycles; reset on successful <code>onopen</code> (used for exponential backoff). */
  const wsReconnectAttemptsRef = useRef(0);
  const mountedRef         = useRef(true);
  const isListeningRef     = useRef(false);
  /** Prevents concurrent startListening() double getUserMedia before isListeningRef is set. */
  const listeningStartInFlightRef = useRef(false);
  const idleTimerRef       = useRef<ReturnType<typeof setTimeout> | null>(null);
  /** Tracks avatar-speaking state via window events — kept as a ref to avoid re-renders. */
  const isSpeakingRef      = useRef(false);
  /** Latest `sessionActive` prop — half-duplex resume only while the user session is active */
  const sessionActiveRef   = useRef(sessionActive);
  /** Cleared on new utterance / unmount — avoids resuming VAD while a later TTS clip is already playing. */
  const vadResumeTimerRef  = useRef<ReturnType<typeof setTimeout> | null>(null);
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
  const sendTextRef = useRef<(t: string, opts?: SendTextOptions) => Promise<void>>(
    async () => {},
  );
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
  /** Turn id for which ``speech_data`` successfully started ``playWsAgentTtsAudio`` */
  const wsPlaybackTurnIdRef = useRef<string | null>(null);

  const useWsAgentAudio = useCallback((): boolean => {
    return false;
  }, []);
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
  /** Last `pong` from server in reply to our `ping`; used to detect half-open sockets. */
  const lastWsPongAtMsRef = useRef<number>(0);
  /** Timeline expecting WS `speech_data` payloads when WS agent audio is enabled; arms stalled-stream watchdog. */
  const wsAudioTimelineActiveRef = useRef(false);
  /** Last inbound WS audio activity (`speech_start` / substantive `speech_data`) while timeline armed. */
  const lastWsInboundAudioActivityAtMsRef = useRef(0);
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
  /** Client handshake timeouts (see WS_CLIENT_OPEN_TIMEOUT_CODE); capped to avoid reconnect storms when API is down. */
  const wsOpenTimeoutStreakRef = useRef(0);
  /** Max consecutive handshake timeouts before disabling auto-reconnect (backend likely down). */
  const WS_OPEN_TIMEOUT_MAX_STREAK = 8;

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
        // Bone-authority duplicate detector: same gesture key inside a small
        // time window logs [GESTURE_DUPLICATION] (does not block).
        trackGestureDispatch(`coSpeech:${pl.gesture}`);
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

  // ── Audio: WS `speech_data` + playWsAgentTtsAudio (default), or AgentDirector → /api/tts-with-timing; stopTTSGlobally on interrupt ──

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
    vadSpeechStartMsRef.current = masterClockNowMs();
    runAvatarBargeIn();
    useBrainStore.getState().setUserSpeaking(true);
    setSttUiPhase('listening');
    if (typeof window === 'undefined') return;
    window.dispatchEvent(new CustomEvent('cogni:user:speaking'));
  }, [runAvatarBargeIn]);

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
        setSttUiPhase('converting');
        setIsProcessing(true);
        break;
      }

      // ── STT transcript ────────────────────────────────────────────────
      case 'transcript': {
        const transcript = ((frame.text ?? frame.transcript ?? '') as string).trim();
        if (!transcript) break;
        pendingUserSttRef.current = false;
        setSttUiPhase('idle');
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
          trackGestureDispatch(`brain:${avatarBehavior.gesture}`);
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
              trackGestureDispatch(`intent:${gestureHint}`);
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
        wsAudioTimelineActiveRef.current = false;
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
        wsPlaybackTurnIdRef.current = null;
        clearCoSpeechTimers();
        stopAllAudio();
        useBrainStore.getState().setThinking(false);
        useBrainStore.getState().setTalking(false);
        setIsProcessing(false);
        if (typeof window !== 'undefined') {
          window.dispatchEvent(new CustomEvent('avatar:visemes:clear'));
          resetSpeechIntentHints();
          window.dispatchEvent(new CustomEvent('avatar:speak:end'));
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
        if (useWsAgentAudio()) {
          wsAudioTimelineActiveRef.current = true;
          lastWsInboundAudioActivityAtMsRef.current = Date.now();
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
        if (useWsAgentAudio() && b64 && typeof b64 === 'string' && b64.length > 8) {
          lastWsInboundAudioActivityAtMsRef.current = Date.now();
          if (sdTurn) {
            wsPlaybackTurnIdRef.current = sdTurn;
          }
          void (async () => {
            const el = await playWsAgentTtsAudio({
              audioBase64: b64,
              visemeRaw: visRaw,
              emotion: 'neutral',
              emotionIntensity: 0.55,
              bufferedStartMs: 50,
            });
            if (!el && sdTurn && wsPlaybackTurnIdRef.current === sdTurn) {
              wsPlaybackTurnIdRef.current = null;
            }
          })();
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
          wsPlaybackTurnIdRef.current = null;
          wsAudioTimelineActiveRef.current = false;
        } else if (!eid && wsAudioTimelineActiveRef.current) {
          wsAudioTimelineActiveRef.current = false;
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
        const userTranscript = String(
          (frame as { transcript?: string }).transcript ?? '',
        ).trim();

        // Backend sends user text on `speech` / `tts_unavailable`, not a separate `transcript` frame.
        // Always mirror STT into UI + brain — do not gate on pendingUserSttRef (race / cleared early → silent failure).
        if (userTranscript) {
          pendingUserSttRef.current = false;
          setLastTranscript(userTranscript);
          useBrainStore.getState().pushTurn({ role: 'user', text: userTranscript });
        }
        setSttUiPhase('idle');

        const dialogueRaw = (frame.dialogue ?? frame.text ?? '') as string;
        const dialogue   = stripInternalSystemEvents(dialogueRaw.trim());
        const norm       = normalizeSpeechFrame({ ...frame, dialogue });
        if (!norm) {
          setIsProcessing(false);
          break;
        }

        const ftid =
          typeof (frame as { turn_id?: string }).turn_id === 'string'
            ? (frame as { turn_id?: string }).turn_id
            : undefined;
        if (ftid) {
          currentSpeechTurnIdRef.current = ftid;
        }

        const wsAudioActive =
          type === 'speech' &&
          useWsAgentAudio() &&
          !!ftid &&
          wsPlaybackTurnIdRef.current === ftid;

        if (!wsAudioActive) {
          stopAllAudio();
        }

        const rawEmotion = norm.emotionRaw;
        const action     = norm.actionRaw;

        const tsNow = Date.now();
        if (
          useWsAgentAudio()
          && dialogue === lastTtsFallbackTextRef.current
          && tsNow - lastTtsFallbackAtRef.current < 10_000
        ) {
          console.warn('[useAgentAgent] Skipping duplicate TTS fallback (same text within 10s — likely quota loop)');
          break;
        }

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

        // 4. Audio — مصدر واحد: AgentDirector.scheduleTTS → speakWithTTS (BFF: EL or Edge per NEXT_PUBLIC_TTS_PROVIDER).
        //    لا تُستدعِ speakWithTTS هنا (ازدواجية). audio_base64 من الـWS يُتجاهل؛ الليب يتبع HTMLAudioElement.currentTime.
        //    NEXT_PUBLIC_USE_AGENT_MESSAGE_AZURE_TTS → مسار Canvas Azure SDK بدلاً من speakWithTTS.
        const contagion = frame.contagion as
          | { emotion?: string; intensity?: number; note?: string }
          | undefined;
        if (contagion?.emotion && typeof window !== 'undefined') {
          window.dispatchEvent(new CustomEvent('cogni:student_contagion', { detail: contagion }));
        }

        if (
          type === 'tts_unavailable'
          && typeof window !== 'undefined'
          && !isElevenLabsTtsProvider()
        ) {
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

        const skipHttpTts = wsAudioActive;

        if (type === 'tts_unavailable' || !skipHttpTts) {
          // Backend sends tts_unavailable when WS TTS lacks audio — do NOT force Edge when ElevenLabs
          // is primary: forceEdgeBff disables NEXT_PUBLIC_TTS_PROVIDER=elevenlabs and skips EL rescue.
          const ttsFallbackOpts =
            type === 'tts_unavailable' && !isElevenLabsTtsProvider()
              ? ({ forceEdgeBff: true } as const)
              : undefined;
          // eslint-disable-next-line no-console
          console.log('[TTS_TRIGGER]', dialogue);
          // ── SILENT-SPEAK FALLBACK ──────────────────────────────────────────
          // Even if HTTP TTS is about to fail (no key, blocked Edge, etc.),
          // fire avatar:speak:start NOW so the avatar moves in sync with the
          // estimated dialogue duration. avatar:speak:end auto-fires when the
          // estimated duration elapses. If real audio later arrives, the
          // analyser-driven RMS overlays naturally on top.
          if (typeof window !== 'undefined') {
            const _silentDur = estimateDialogueDurationMs(dialogue);
            setSpeechIntentHintsFromText(dialogue);
            setSpeechEmotionBridge({ emotion: emotionLabel, intensity: 0.55 });
            // Fire the events that AvatarCanvas/LipSyncManager actually listen to.
            window.dispatchEvent(
              new CustomEvent('avatar:speak:start', {
                detail: { text: dialogue, durationMs: _silentDur, silent: true },
              }),
            );
            console.log('[AVATAR_SILENT_SPEAK]', { dialogue: dialogue.slice(0, 60), durationMs: _silentDur });
            // Auto-end the silent-speak so animation state machine returns to idle.
            setTimeout(() => {
              if (mountedRef.current) {
                window.dispatchEvent(new CustomEvent('avatar:speak:end'));
              }
            }, _silentDur + 250);
          }
          void agentDirector.scheduleTTS(dialogue, emotionLabel, 0, ttsFallbackOpts);
        } else if (typeof window !== 'undefined') {
          setSpeechIntentHintsFromText(dialogue);
          setSpeechEmotionBridge({
            emotion: emotionLabel,
            intensity: 0.55,
          });
          window.dispatchEvent(
            new CustomEvent('avatar:speak', {
              detail: {
                text: dialogue,
                timings: wcForPerf ?? [],
                sampleRate: 24000,
                audio: getClientTtsAudioElement() ?? undefined,
              },
            }),
          );
          window.dispatchEvent(
            new CustomEvent('agent:message', {
              detail: {
                text: dialogue,
                emotion: emotionLabel,
                gesture:
                  (
                    {
                      excited: 'openHand',
                      happy: 'openHand',
                      encouraging: 'openHand',
                      proud: 'openHand',
                      surprised: 'openHand',
                      thinking: 'openHand',
                      curious: 'beat',
                      attentive: 'beat',
                      concerned: 'openHand',
                      calm: 'openHand',
                      empathetic: 'openHand',
                      sad: 'beat',
                      anxious: 'beat',
                      bored: 'beat',
                      sleepy: 'beat',
                      neutral: 'beat',
                    } as Partial<Record<EmotionLabel, string>>
                  )[emotionLabel] ?? 'openHand',
              },
            }),
          );
        }

        console.log(
          `[useAgentAgent] Speech frame — emotion="${rawEmotion}" len=${dialogue.length} wsAudio=${skipHttpTts}`,
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
          setSttUiPhase('idle');
          setIsProcessing(false);
          break;
        }

        pendingUserSttRef.current = false;
        setSttUiPhase('idle');
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
        // Never bump lastWsPongAtMsRef here — server heartbeats prove downlink-only; only `pong` validates our pings.
        if (process.env.NODE_ENV === 'development') {
          console.log('[useAgentAgent] Heartbeat frame received');
        }
        break;

      case 'init_ack':
        // Server-side sends this if it implements ack (currently optional in backend).
        console.log('[useAgentAgent] ✅ persona_init acknowledged by server:', frame);
        break;

      case 'connection_ack':
        console.log('[useAgentAgent] ✅ Connection acknowledged by server:', frame);
        break;

      case 'pong': {
        const now = Date.now();
        lastWsPongAtMsRef.current = now;
        if (process.env.NODE_ENV === 'development') {
          let rttLogged = '';
          const tsRaw = frame.timestamp as unknown;
          const tsMs =
            typeof tsRaw === 'number'
              ? tsRaw
              : typeof tsRaw === 'string'
                ? Number(tsRaw)
                : NaN;
          if (
            typeof tsMs === 'number'
            && !Number.isNaN(tsMs)
            && tsMs > 0
            && now >= tsMs
            && now - tsMs < 120_000
          ) {
            const rttMs = Math.round(now - tsMs);
            if (Number.isFinite(rttMs)) {
              rttLogged = ` RTT=${rttMs}ms`;
            }
          }
          console.log('[WS] pong received' + rttLogged);
        }
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
  }, [lang, stopAllAudio, clearCoSpeechTimers, clearPerformanceTimers, scheduleCoSpeechForDialogue]);

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

    if (agentWsSkippedByEnv()) {
      console.warn('[WS] NEXT_PUBLIC_SKIP_AGENT_WS is set — skipping agent WebSocket (no connection attempt)');
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

    if (allowGuestWs && !useJwtSubprotocol) {
      console.warn(
        '[useAgentAgent] Guest WebSocket mode (no JWT). Set NEXT_PUBLIC_COGNI_WS_ALLOW_ANONYMOUS=false when using real auth.',
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

    const resolvedWs = (wsUrlProp ?? buildDefaultWsAgentUrl()).trim();
    if (!resolvedWs) {
      console.warn('[WS] Empty WebSocket URL — skip connection (set NEXT_PUBLIC_WS_URL or NEXT_PUBLIC_API_URL)');
      return;
    }
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

    if (connectTimeoutRef.current) {
      clearTimeout(connectTimeoutRef.current);
      connectTimeoutRef.current = null;
    }

    lastConnectUsedJwtSubprotocolRef.current = useJwtSubprotocol;
    wsRef.current = ws;

    const openTimeoutMs = readWsConnectTimeoutMs();
    // Watchdog: if handshake stays CONNECTING past openTimeoutMs, close with an app close code so onclose can cap retries.
    connectTimeoutRef.current = setTimeout(() => {
      if (ws.readyState !== WebSocket.OPEN) {
        console.warn(`[useAgentAgent] Connection open timeout (${openTimeoutMs}ms) — aborting handshake`);
        try {
          ws.close(
            WS_CLIENT_OPEN_TIMEOUT_CODE,
            'client-handshake-timeout',
          );
        } catch {
          try {
            ws.close();
          } catch {
            /* ignore */
          }
        }
      }
    }, openTimeoutMs);

    ws.onopen = () => {
      // Cancel connection watchdog
      if (connectTimeoutRef.current) {
        clearTimeout(connectTimeoutRef.current);
        connectTimeoutRef.current = null;
      }
      if (!mountedRef.current) return;
      lastWsPongAtMsRef.current = Date.now();
      wsReconnectAttemptsRef.current = 0;
      wsAudioTimelineActiveRef.current = false;
      lastWsInboundAudioActivityAtMsRef.current = 0;
      wsOpenTimeoutStreakRef.current = 0;
      ws1006StreakRef.current = 0;
      wsReconnectStoppedRef.current = false;
      ws1006FallbackPendingRef.current = true;
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

      // Keep-alive ping + stale detection — prevents idle proxy timeouts and half-open/zombie sockets.
      if (keepAliveIntervalRef.current) clearInterval(keepAliveIntervalRef.current);
      keepAliveIntervalRef.current = setInterval(() => {
        if (ws.readyState !== WebSocket.OPEN) return;

        const now = Date.now();
        const sincePong = now - lastWsPongAtMsRef.current;
        if (sincePong > WS_STALE_NO_PONG_MS) {
          console.warn(
            '[WS] stale connection (no pong within',
            WS_STALE_NO_PONG_MS,
            'ms) — closing to reconnect',
          );
          try {
            ws.close(WS_STALE_KEEPALIVE_CLOSE_CODE, 'stale_keepalive');
          } catch {
            /* ignore — onclose clears interval */
          }
          return;
        }

        if (
          useWsAgentAudio() &&
          wsAudioTimelineActiveRef.current &&
          wsRef.current === ws
        ) {
          const stalled = now - lastWsInboundAudioActivityAtMsRef.current;
          if (stalled > WS_AUDIO_STALL_MS) {
            console.warn('[AUDIO] stalled (no streamed audio) → closing WS', { stalledMs: stalled });
            try {
              ws.close(WS_AUDIO_STALL_CLOSE_CODE, 'audio_stall');
            } catch {
              /* ignore — onclose clears interval */
            }
            return;
          }
        }

        try {
          if (process.env.NODE_ENV === 'development') {
            console.log('[WS] ping sent');
          }
          ws.send(JSON.stringify({ type: 'ping', timestamp: now, v: 1.1 }));
        } catch (err) {
          console.error('[WS] ping send error', err);
        }
      }, WS_KEEPALIVE_PING_MS);
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
      wsAudioTimelineActiveRef.current = false;
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

      const reason = (event.reason || '').trim() || '(no reason)';
      console.warn('[WS] ❌ CLOSED', { code: event.code, reason, clean: event.wasClean });

      if (event.code === WS_CLIENT_OPEN_TIMEOUT_CODE) {
        wsOpenTimeoutStreakRef.current += 1;
        if (wsOpenTimeoutStreakRef.current >= WS_OPEN_TIMEOUT_MAX_STREAK) {
          wsReconnectStoppedRef.current = true;
          setError(
            `WebSocket: handshake timed out ${WS_OPEN_TIMEOUT_MAX_STREAK} times — backend may be down or URL is wrong.`,
          );
          console.warn(
            '[WS] Open-timeout streak limit reached — stopping auto-reconnect (set NEXT_PUBLIC_SKIP_AGENT_WS or fix API)',
          );
        }
      }

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
        wsReconnectAttemptsRef.current = 0;
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

      if (reconnectTimer.current) {
        clearTimeout(reconnectTimer.current);
        reconnectTimer.current = null;
      }
      wsReconnectAttemptsRef.current += 1;
      const delay = wsReconnectBackoffMs(wsReconnectAttemptsRef.current);
      console.warn('[WS] reconnect in', delay, 'ms (attempt', wsReconnectAttemptsRef.current, ')');
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
  }, [wsUrlProp, autoReconnect, handleFrame]);

  /**
   * Initial mount only: optional HTTP preflight so we do not call `new WebSocket` when the API host is down
   * (Chromium always logs that as a red "WebSocket connection failed" — cannot be suppressed in JS).
   */
  const runHealthPreflightOnce = useCallback(async (): Promise<void> => {
    if (agentWsSkippedByEnv()) {
      console.warn('[WS] NEXT_PUBLIC_SKIP_AGENT_WS — skipping health preflight and WebSocket');
      return;
    }
    if (!wsPreflightHealthEnabled()) {
      connect();
      return;
    }
    const trimmedWs = (wsUrlProp ?? buildDefaultWsAgentUrl()).trim();
    if (!trimmedWs) {
      console.warn('[WS] Empty WebSocket URL — skipping health preflight');
      return;
    }
    const resolvedWs = ipv4LoopbackWsUrl(trimmedWs);
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
    // Awareness Layer: mic-driven student input is real interaction.
    void import('@/lib/avatar/awareness/studentAwarenessEngine').then(
      (m) => m.registerInteraction(),
    ).catch(() => { /* no-op */ });
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
        ...(emotionalCtx.trim() ? { emotional_context: emotionalCtx } : {}),
        ...(fsAudio ? { focus_subject: fsAudio } : {}),
        ...(coachingOut ? { assessment_coaching: coachingOut } : {}),
      };
      ws.send(JSON.stringify(payload));
      pendingUserSttRef.current = true;
      setSttUiPhase('converting');
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
  }, []);

  // ── VAD integration ──────────────────────────────────────────────────────

  const { isRecording, startListening: vadStart, stopListening: vadStop } = useVAD({
    lang,
    // Less sensitive RMS + longer silence tail + min vocal span — fewer breath/keyboard/echo false STT sends.
    silenceThreshold:     0.045,
    silenceGapMs:         1300,
    minSpeechDurationMs: 280,
    onSpeechStart: onVadSpeechStart,
    onSpeechEnd: async (blob: Blob) => {
      const now = typeof performance !== 'undefined' ? performance.now() : Date.now();
      lastUtteranceDurationMsRef.current = Math.max(380, now - vadSpeechStartMsRef.current);
      console.log(
        '[useAgentAgent] VAD onSpeechEnd — blob',
        blob.size,
        'bytes',
        blob.type || '(no type)',
      );
      // Full-duplex interrupt: send audio even if the avatar was speaking — backend
      // cancels the LLM/TTS turn and replies to the new utterance. Smooth local barge-in
      // first to reduce speaker bleed (headphones recommended).
      if (isSpeakingRef.current) {
        console.log(
          '[useAgentAgent] Interrupt: user spoke during avatar speech — barge-in (fade + VRMA), sending audio',
        );
        runAvatarBargeIn();
      }

      await waitForWsReady(12_000);

      if (wsRef.current?.readyState === WebSocket.OPEN) {
        await sendAudioBlobNow(blob);
        return;
      }

      if (pendingAudioBlobsRef.current.length >= MAX_PENDING_AUDIO_BLOBS) {
        pendingAudioBlobsRef.current.shift();
      }
      pendingAudioBlobsRef.current.push(blob);
      console.warn(
        '[useAgentAgent] WS not ready — queueing audio blob (',
        pendingAudioBlobsRef.current.length,
        'in queue); will send after connection',
      );
    },
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
      setSttUiPhase((p) => (p === 'converting' ? p : 'idle'));
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

  useEffect(() => {
    sessionActiveRef.current = sessionActive;
  }, [sessionActive]);

  // ── Public API ────────────────────────────────────────────────────────────

  const startListening = useCallback(async (): Promise<void> => {
    if (isSpeakingRef.current) {
      // eslint-disable-next-line no-console
      console.log('[MIC] blocked — avatar is speaking');
      return;
    }
    if (isListeningRef.current || listeningStartInFlightRef.current) return;
    listeningStartInFlightRef.current = true;

    // Interrupt any ongoing speech before listening (prevents echo)
    stopAllAudio();
    agentDirector.interruptSpeech();

    try {
      diagVad('START');
      await resumeSharedAudioContext();
      await vadStart();
      isListeningRef.current = true;
      useBrainStore.getState().setPhysical({ isListening: true });
      emitListeningEvent(true);
      console.log('[Agent] Listening started');
      // eslint-disable-next-line no-console
      console.log('[MIC] activated');
      diagVad('SUCCESS');
    } catch (e) {
      console.error('[Agent] vadStart failed', e);
      diagVad('FAIL', e instanceof Error ? e : new Error(String(e)));
      isListeningRef.current = false;
      if (vadResumeTimerRef.current) {
        clearTimeout(vadResumeTimerRef.current);
        vadResumeTimerRef.current = null;
      }
      useBrainStore.getState().setPhysical({ isListening: false });
      emitListeningEvent(false);
      setSttUiPhase('idle');
      if (typeof window !== 'undefined') {
        window.dispatchEvent(new CustomEvent('cogni:user:silent'));
      }
    } finally {
      listeningStartInFlightRef.current = false;
    }
  }, [vadStart, stopAllAudio]);

  const stopListening = useCallback((): void => {
    if (!isListeningRef.current) return;
    isListeningRef.current = false;
    if (vadResumeTimerRef.current) {
      clearTimeout(vadResumeTimerRef.current);
      vadResumeTimerRef.current = null;
    }

    vadStop();
    useBrainStore.getState().setPhysical({ isListening: false });
    emitListeningEvent(false);
    setSttUiPhase('idle');
    if (typeof window !== 'undefined') {
      window.dispatchEvent(new CustomEvent('cogni:user:silent'));
    }
    // eslint-disable-next-line no-console
    console.log('[MIC] stopped');
  }, [vadStop]);

  /** Mic track ended (Bluetooth/USB disconnect) or VAD hard-stop — sync refs + brain so toggles still work. */
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const onVoiceMicStopped = (): void => {
      if (!isListeningRef.current) return;
      console.warn('[Agent] mic stopped → reset');
      stopListening();
    };
    window.addEventListener('voice:mic:stopped', onVoiceMicStopped as EventListener);
    return () =>
      window.removeEventListener('voice:mic:stopped', onVoiceMicStopped as EventListener);
  }, [stopListening]);

  useEffect(() => {
    if (sessionActive) return;
    if (!isListeningRef.current) return;
    stopListening();
  }, [sessionActive, stopListening]);

  // Arm hands-free VAD once session + WebSocket + scene are ready (mic stays closed before that).
  useEffect(() => {
    if (typeof window === 'undefined') return;
    if (!isNextPublicVadAutoArmEnabled()) return;
    if (!sessionActive || !isConnected) return;

    const tryArmVad = (): void => {
      if (!mountedRef.current || !sessionActiveRef.current) return;
      if (wsRef.current?.readyState !== WebSocket.OPEN) return;
      if (!sceneReadyRef.current) return;
      if (isSpeakingRef.current || listeningStartInFlightRef.current) return;
      if (isListeningRef.current) return;
      void startListening().catch((err: unknown) => {
        console.warn('[useAgentAgent] Hands-free VAD arm failed:', err);
      });
    };

    const onScene = (): void => {
      // Let `avatar:scene:ready` handlers that set `sceneReadyRef` run first (listener order).
      queueMicrotask(() => tryArmVad());
    };
    window.addEventListener('avatar:scene:ready', onScene);
    tryArmVad();

    return () => window.removeEventListener('avatar:scene:ready', onScene);
  }, [sessionActive, isConnected, startListening]);

  const toggleListening = useCallback(async (): Promise<void> => {
    if (isListeningRef.current) {
      stopListening();
    } else {
      await startListening();
    }
  }, [startListening, stopListening]);

  const sendText = useCallback(async (text: string, opts?: SendTextOptions): Promise<void> => {
    const practice = opts?.practice === true;
    if (!text?.trim() && !practice) return;
    const ws = wsRef.current;
    if (!ws || ws.readyState !== WebSocket.OPEN) {
      console.warn('[useAgentAgent] WS not open — cannot sendText');
      setError('Not connected to agent');
      return;
    }

    await resumeSharedAudioContext();

    const trimmed = (text || '').trim();

    if (!opts?.skipAssignmentRag && !opts?.practice && trimmed.length > 0) {
      void (async () => {
        const ragHandled = await handleUserMessage(trimmed);
        if (ragHandled) {
          setIsProcessing(false);
          return;
        }
        await sendText(trimmed, { ...opts, skipAssignmentRag: true });
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
      void sendTextRef.current(prompt);
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
    setSttUiPhase('idle');
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
      if (vadResumeTimerRef.current) {
        clearTimeout(vadResumeTimerRef.current);
        vadResumeTimerRef.current = null;
      }
      // Mute VAD the instant TTS playback begins.
      if (isListeningRef.current) {
        _vadStopRef.current();
        console.log('[useAgentAgent] Half-duplex: VAD paused — avatar is speaking');
      }
    };
    const onEnd = (): void => {
      isSpeakingRef.current = false;
      if (vadResumeTimerRef.current) {
        clearTimeout(vadResumeTimerRef.current);
        vadResumeTimerRef.current = null;
      }
      if (!sessionActiveRef.current) return;
      vadResumeTimerRef.current = setTimeout(() => {
        vadResumeTimerRef.current = null;
        if (!mountedRef.current || !sessionActiveRef.current || isSpeakingRef.current) return;
        if (!isListeningRef.current) return;
        if (wsRef.current?.readyState !== WebSocket.OPEN) return;
        _vadStartRef.current().catch((e: unknown) => {
          console.warn('[useAgentAgent] Half-duplex: failed to resume VAD after TTS:', e);
        });
        console.log('[useAgentAgent] Half-duplex: VAD resumed — avatar finished speaking');
      }, 250);
    };
    window.addEventListener('avatar:speak:start', onStart);
    window.addEventListener('avatar:speak:end',   onEnd);
    return () => {
      if (vadResumeTimerRef.current) {
        clearTimeout(vadResumeTimerRef.current);
        vadResumeTimerRef.current = null;
      }
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

    // Block conditions: already greeted, not yet connected, or STT/LLM busy
    if (hasInitiated || !isConnected || isProcessing) return;

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

      void sendText(prompt);
      setHasInitiated(true);
      console.log('[useAgentAgent] Smart heartbeat fired — proactive greeting sent', pendingGrade ? `(debrief: ${pendingGrade.final_grade})` : '');
    }, IDLE_TIMEOUT);

    return () => {
      if (idleTimerRef.current) {
        clearTimeout(idleTimerRef.current);
        idleTimerRef.current = null;
      }
    };
  }, [isConnected, isProcessing, hasInitiated, sendText]);

  // ── Mount / unmount ───────────────────────────────────────────────────────

  useEffect(() => {
    const onAuthChanged = (): void => {
      ws1006StreakRef.current = 0;
      wsReconnectStoppedRef.current = false;
      wsReconnectAttemptsRef.current = 0;
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
