'use client';

/**
 * AvatarEventBridge — ربط رسائل الوكيل (WebSocket / JSON) بأحداث DOM التي يستهلكها
 * AvatarCanvas والمدراء (avatar:speak:*, avatar:gesture, avatar:emotion, …).
 *
 * لا يعدّل العظام أو التعبيرات مباشرة؛ فقط جدولة + dispatchEvent.
 */

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type MutableRefObject,
  type RefObject,
} from 'react';
import { dispatchAvatar } from '@/utils/events/normalizeAvatarEvents';
import type { VisemeCue } from '@/app/avatar-agent/LipSyncManager';
import { resetSpeechIntentHints, setSpeechIntentHintsFromText } from '@/lib/avatar/speechIntentHints';

// ─── Incoming message types (عقد JSON من الخادم أو اختبار) ───────────────────

export type AgentSpeakMessage = {
  type: 'agent:speak';
  text?: string;
  /** Base64 audio (مثلاً MP3) */
  audio?: string;
  audio_mime?: string;
  /** مصفوفة [وقت بالثواني، معرف Azure أو حرف تقريبي] */
  visemes?: Array<[number, string | number] | { t: number; id?: number; viseme?: string }>;
};

export type AgentGestureMessage = {
  type: 'agent:gesture';
  gesture?: string;
  /** اسم إيماءة قديم متوافق مع normalizeAvatarEvents */
  name?: string;
  duration?: number;
  side?: 'left' | 'right' | 'both';
  /** 0..1 — عند ≥ 0.85 يقطع الإيماءة الحالية */
  urgency?: number;
};

export type AgentEmotionMessage = {
  type: 'agent:emotion';
  name?: string;
  emotion?: string;
  intensity?: number;
  strength?: number;
  duration?: number;
};

export type AgentGazeMessage = {
  type: 'agent:gaze';
  target?: 'camera' | 'board' | 'student' | string;
  yaw?: number;
  pitch?: number;
};

export type AgentBridgeMessage =
  | AgentSpeakMessage
  | AgentGestureMessage
  | AgentEmotionMessage
  | AgentGazeMessage
  | { type: string; [k: string]: unknown };

export type UseAvatarEventBridgeOptions = {
  enabled?: boolean;
  connectWebSocket?: boolean;
  wsUrl?: string;
  isTalkingRef: MutableRefObject<boolean>;
  visemeCueQueueRef: MutableRefObject<VisemeCue[]>;
  audioElementRef: RefObject<HTMLAudioElement | null>;
  /** محجوز لربط AnalyserNode لاحقاً من مسار الصوت */
  analyserRef?: MutableRefObject<AnalyserNode | null>;
  neckGazeYawRef?: MutableRefObject<number>;
  neckGazePitchRef?: MutableRefObject<number>;
  getSharedWebSocket?: () => WebSocket | null;
  listenWindowEvent?: boolean;
  windowEventName?: string;
};

export type UseAvatarEventBridgeResult = {
  ingest: (raw: unknown) => void;
  socketReadyState: number | null;
  reconnect: () => void;
};

const DEFAULT_WS =
  typeof process !== 'undefined'
    ? process.env.NEXT_PUBLIC_AGENT_WS ?? process.env.NEXT_PUBLIC_WS_URL ?? ''
    : '';

const LETTER_TO_AZURE: Record<string, number> = {
  sil: 0,
  x: 0,
  _: 0,
  A: 2,
  a: 2,
  E: 4,
  e: 4,
  I: 6,
  i: 6,
  O: 8,
  o: 8,
  U: 7,
  u: 7,
  M: 21,
  m: 21,
  F: 18,
  f: 18,
  TH: 17,
  S: 15,
  s: 15,
};

function visemeEntryToCue(
  row: [number, string | number] | { t: number; id?: number; viseme?: string },
): VisemeCue | null {
  if (Array.isArray(row)) {
    const t = row[0];
    const v = row[1];
    if (typeof t !== 'number' || !Number.isFinite(t)) return null;
    if (typeof v === 'number' && Number.isFinite(v)) return { t, id: Math.max(0, Math.floor(v)) };
    if (typeof v === 'string') {
      const id = LETTER_TO_AZURE[v] ?? LETTER_TO_AZURE[v.charAt(0)] ?? 0;
      return { t, id };
    }
    return null;
  }
  const t = row.t;
  if (typeof t !== 'number' || !Number.isFinite(t)) return null;
  if (typeof row.id === 'number') return { t, id: row.id };
  if (typeof row.viseme === 'string') {
    const id = LETTER_TO_AZURE[row.viseme] ?? 0;
    return { t, id };
  }
  return { t, id: 0 };
}

function parseVisemeCues(raw: AgentSpeakMessage['visemes']): VisemeCue[] {
  if (!raw || !Array.isArray(raw)) return [];
  const out: VisemeCue[] = [];
  for (const row of raw) {
    const c = visemeEntryToCue(row as never);
    if (c) out.push(c);
  }
  out.sort((a, b) => a.t - b.t);
  return out;
}

function durationToMs(d: unknown, fallbackMs: number): number {
  if (typeof d !== 'number' || !Number.isFinite(d) || d <= 0) return fallbackMs;
  if (d > 0 && d < 60) return Math.max(1, Math.round(d * 1000));
  return Math.max(1, Math.round(d));
}

type GestureQueueItem = { durationMs: number; detail: Record<string, unknown> };

function base64ToBlob(base64: string, mime: string): Blob {
  const bin = atob(base64.replace(/^data:[^;]+;base64,/, ''));
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return new Blob([bytes], { type: mime || 'audio/mpeg' });
}

export function useAvatarEventBridge({
  enabled = true,
  connectWebSocket = false,
  wsUrl = DEFAULT_WS,
  isTalkingRef,
  visemeCueQueueRef,
  audioElementRef,
  neckGazeYawRef,
  neckGazePitchRef,
  getSharedWebSocket,
  listenWindowEvent = true,
  windowEventName = 'cogni-agent-bridge:message',
}: UseAvatarEventBridgeOptions): UseAvatarEventBridgeResult {
  const wsRef = useRef<WebSocket | null>(null);
  const reconnectAttemptRef = useRef(0);
  const reconnectTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const blobUrlRef = useRef<string | null>(null);
  const gestureQueueRef = useRef<GestureQueueItem[]>([]);
  const gesturePlayingRef = useRef(false);
  const gestureTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const mountedRef = useRef(true);
  const [socketReadyState, setSocketReadyState] = useState<number | null>(null);

  const ingestRef = useRef<(raw: unknown) => void>(() => {});

  const clearGestureTimer = useCallback(() => {
    if (gestureTimerRef.current !== null) {
      clearTimeout(gestureTimerRef.current);
      gestureTimerRef.current = null;
    }
  }, []);

  const processGestureQueue = useCallback(() => {
    const next = gestureQueueRef.current.shift();
    if (!next) {
      gesturePlayingRef.current = false;
      return;
    }
    gesturePlayingRef.current = true;
    window.dispatchEvent(new CustomEvent('avatar:gesture', { detail: next.detail }));
    clearGestureTimer();
    gestureTimerRef.current = setTimeout(() => {
      gestureTimerRef.current = null;
      gesturePlayingRef.current = false;
      processGestureQueue();
    }, next.durationMs);
  }, [clearGestureTimer]);

  const enqueueGesture = useCallback(
    (detail: Record<string, unknown>, durationMs: number, urgency: number) => {
      const item: GestureQueueItem = { durationMs, detail };
      if (urgency >= 0.85) {
        clearGestureTimer();
        gestureQueueRef.current = [];
        gestureQueueRef.current.push(item);
        gesturePlayingRef.current = false;
        processGestureQueue();
        return;
      }
      if (!gesturePlayingRef.current) {
        gestureQueueRef.current.push(item);
        processGestureQueue();
        return;
      }
      gestureQueueRef.current.push(item);
    },
    [clearGestureTimer, processGestureQueue],
  );

  const stopBridgeAudio = useCallback(() => {
    const audio = audioElementRef.current;
    if (audio) {
      audio.pause();
      audio.removeAttribute('src');
      audio.load();
    }
    if (blobUrlRef.current) {
      URL.revokeObjectURL(blobUrlRef.current);
      blobUrlRef.current = null;
    }
    visemeCueQueueRef.current = [];
    isTalkingRef.current = false;
    resetSpeechIntentHints();
    window.dispatchEvent(new CustomEvent('avatar:speak:end'));
  }, [audioElementRef, isTalkingRef, visemeCueQueueRef]);

  const handleSpeak = useCallback(
    (msg: AgentSpeakMessage) => {
      const mime = msg.audio_mime?.trim() || 'audio/mpeg';
      const cues = parseVisemeCues(msg.visemes);

      if (!msg.audio?.trim()) {
        visemeCueQueueRef.current = cues;
        setSpeechIntentHintsFromText((msg.text ?? '').trim());
        window.dispatchEvent(new CustomEvent('avatar:speak:start', { detail: {} }));
        isTalkingRef.current = true;
        return;
      }

      let audio = audioElementRef.current;
      if (!audio) {
        audio = new Audio();
        audio.crossOrigin = 'anonymous';
        (audioElementRef as MutableRefObject<HTMLAudioElement | null>).current = audio;
      }

      stopBridgeAudio();
      visemeCueQueueRef.current = cues;

      const blob = base64ToBlob(msg.audio, mime);
      const url = URL.createObjectURL(blob);
      blobUrlRef.current = url;
      audio.src = url;

      const onEnded = () => {
        audio?.removeEventListener('ended', onEnded);
        stopBridgeAudio();
      };
      audio.addEventListener('ended', onEnded);

      void audio.play().then(
        () => {
          // Dispatch audio:element FIRST so AvatarCanvas wires the analyser
          // before speak:start sets isTalkingRef — matches useAgentAgent ordering
          window.dispatchEvent(new CustomEvent('avatar:audio:element', { detail: { audio } }));
          setSpeechIntentHintsFromText((msg.text ?? '').trim());
          window.dispatchEvent(new CustomEvent('avatar:speak:start', { detail: {} }));
          isTalkingRef.current = true;
        },
        (err) => {
          console.warn('[AvatarEventBridge] audio play failed', err);
          window.dispatchEvent(new CustomEvent('avatar:audio:element', { detail: { audio } }));
          setSpeechIntentHintsFromText((msg.text ?? '').trim());
          window.dispatchEvent(new CustomEvent('avatar:speak:start', { detail: {} }));
          isTalkingRef.current = true;
        },
      );
    },
    [audioElementRef, isTalkingRef, stopBridgeAudio, visemeCueQueueRef],
  );

  const handleGesture = useCallback(
    (msg: AgentGestureMessage) => {
      const raw = (msg.gesture ?? msg.name ?? 'idle').replace(/\s+/g, '').toLowerCase();
      const durationMs = durationToMs(msg.duration, 3000);
      const urgency = typeof msg.urgency === 'number' ? msg.urgency : 0;
      const side = msg.side ?? 'right';
      const detail: Record<string, unknown> = {
        type: raw,
        duration: durationMs,
        side,
      };
      enqueueGesture(detail, durationMs, urgency);
    },
    [enqueueGesture],
  );

  const handleEmotion = useCallback((msg: AgentEmotionMessage) => {
    dispatchAvatar('avatar:emotion', {
      emotion: msg.name ?? msg.emotion ?? 'neutral',
      strength: msg.intensity ?? msg.strength ?? 0.6,
      duration: msg.duration,
    });
  }, []);

  const handleGaze = useCallback(
    (msg: AgentGazeMessage) => {
      window.dispatchEvent(
        new CustomEvent('avatar:gaze', {
          detail: {
            target: msg.target ?? 'camera',
            yaw: msg.yaw,
            pitch: msg.pitch,
          },
        }),
      );
      if (neckGazeYawRef && typeof msg.yaw === 'number') neckGazeYawRef.current = msg.yaw;
      if (neckGazePitchRef && typeof msg.pitch === 'number') neckGazePitchRef.current = msg.pitch;
    },
    [neckGazePitchRef, neckGazeYawRef],
  );

  const ingest = useCallback(
    (raw: unknown) => {
      if (!enabled || raw == null || typeof raw !== 'object') return;
      const msg = raw as AgentBridgeMessage;
      const t = msg.type;
      switch (t) {
        case 'agent:speak':
          handleSpeak(msg as AgentSpeakMessage);
          break;
        case 'agent:gesture':
          handleGesture(msg as AgentGestureMessage);
          break;
        case 'agent:emotion':
          handleEmotion(msg as AgentEmotionMessage);
          break;
        case 'agent:gaze':
          handleGaze(msg as AgentGazeMessage);
          break;
        default:
          break;
      }
    },
    [enabled, handleEmotion, handleGaze, handleGesture, handleSpeak],
  );

  ingestRef.current = ingest;

  const [wsSessionKey, setWsSessionKey] = useState(0);

  const reconnect = useCallback(() => {
    reconnectAttemptRef.current = 0;
    if (reconnectTimerRef.current) {
      clearTimeout(reconnectTimerRef.current);
      reconnectTimerRef.current = null;
    }
    setWsSessionKey((k) => k + 1);
  }, []);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      clearGestureTimer();
      wsRef.current?.close();
      wsRef.current = null;
      if (reconnectTimerRef.current) clearTimeout(reconnectTimerRef.current);
      if (blobUrlRef.current) {
        URL.revokeObjectURL(blobUrlRef.current);
        blobUrlRef.current = null;
      }
    };
  }, [clearGestureTimer]);

  useEffect(() => {
    if (!enabled || !listenWindowEvent || typeof window === 'undefined') return;
    const onWin = (e: Event) => {
      const d = (e as CustomEvent<unknown>).detail;
      ingestRef.current(d);
    };
    window.addEventListener(windowEventName, onWin as EventListener);
    return () => window.removeEventListener(windowEventName, onWin as EventListener);
  }, [enabled, listenWindowEvent, windowEventName]);

  useEffect(() => {
    if (!enabled || !connectWebSocket || !wsUrl || typeof WebSocket === 'undefined') {
      setSocketReadyState(null);
      return;
    }

    let cancelled = false;
    const url = wsUrl;

    const connect = () => {
      if (cancelled) return;
      wsRef.current?.close();
      try {
        const ws = new WebSocket(url);
        wsRef.current = ws;
        ws.onopen = () => {
          reconnectAttemptRef.current = 0;
          setSocketReadyState(ws.readyState);
        };
        ws.onmessage = (ev) => {
          try {
            ingestRef.current(JSON.parse(String(ev.data)) as unknown);
          } catch {
            /* non-JSON */
          }
        };
        ws.onerror = () => setSocketReadyState(ws.readyState);
        ws.onclose = () => {
          setSocketReadyState(WebSocket.CLOSED);
          if (cancelled || !mountedRef.current) return;
          const attempt = reconnectAttemptRef.current++;
          const delay = Math.min(30_000, 800 * 2 ** Math.min(attempt, 6));
          reconnectTimerRef.current = setTimeout(() => {
            reconnectTimerRef.current = null;
            connect();
          }, delay);
        };
      } catch {
        if (cancelled || !mountedRef.current) return;
        const attempt = reconnectAttemptRef.current++;
        const delay = Math.min(30_000, 800 * 2 ** Math.min(attempt, 6));
        reconnectTimerRef.current = setTimeout(() => {
          reconnectTimerRef.current = null;
          connect();
        }, delay);
      }
    };

    connect();

    return () => {
      cancelled = true;
      if (reconnectTimerRef.current) {
        clearTimeout(reconnectTimerRef.current);
        reconnectTimerRef.current = null;
      }
      wsRef.current?.close();
      wsRef.current = null;
    };
  }, [connectWebSocket, enabled, wsUrl, wsSessionKey]);

  useEffect(() => {
    if (!enabled || typeof getSharedWebSocket !== 'function') return;
    const ws = getSharedWebSocket();
    if (!ws || ws.readyState !== WebSocket.OPEN) return;
    const onMessage = (ev: MessageEvent) => {
      try {
        ingestRef.current(JSON.parse(String(ev.data)) as unknown);
      } catch {
        /* */
      }
    };
    ws.addEventListener('message', onMessage);
    return () => ws.removeEventListener('message', onMessage);
  }, [enabled, getSharedWebSocket]);

  useEffect(() => {
    if (!enabled || typeof window === 'undefined') return;
    const onClear = () => {
      visemeCueQueueRef.current = [];
    };
    window.addEventListener('avatar:visemes:clear', onClear);
    return () => window.removeEventListener('avatar:visemes:clear', onClear);
  }, [enabled, visemeCueQueueRef]);

  return {
    ingest,
    socketReadyState,
    reconnect,
  };
}
