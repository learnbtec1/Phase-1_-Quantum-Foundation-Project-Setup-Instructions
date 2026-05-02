'use client';

/**
 * جسر مستقبلي لإيماءات توليدية (MIBURI / RIDGE / API خارجية).
 * يعيد إرسال الرسائل كـ `avatar:generative:gesture` — لا يحرك العظام هنا.
 *
 * WebSocket معطّل ما لم يُضبط `wsUrl` أو NEXT_PUBLIC_GENERATIVE_GESTURE_WS.
 * إعادة اتصال تلقائية بتأخير أسي (1s → مضاعفة حتى أقصى 10s) عند انقطاع الشبكة.
 */

import React, { useEffect, useRef, useCallback, type MutableRefObject } from 'react';

/** Exponential backoff: 1s base, ×2 per attempt, cap 10s (SRE Phase 7). */
const RECONNECT_BASE_MS = 1000;
const RECONNECT_MAX_MS = 10_000;

function nextReconnectDelayMs(attemptIndex: number): number {
  return Math.min(RECONNECT_MAX_MS, RECONNECT_BASE_MS * 2 ** Math.min(attemptIndex, 20));
}

export type GenerativeBoneRot = {
  x?: number;
  y?: number;
  z?: number;
};

export type GenerativeGestureDetail = {
  bones?: Record<string, GenerativeBoneRot>;
  /** When true, bone `x`/`y`/`z` are treated as degrees and converted to radians in the skeleton. */
  assumeEulerDegrees?: boolean;
  /** 0..1 — قوة الدمج في VRMSkeletonManager */
  blend?: number;
  /** مدة الإمساك بالهدف (ms) — informational; hold persists until `avatar:generative:reset` unless you replace bones. */
  durationMs?: number;
  /** When true, clears all generative targets before applying `bones` (default: merge into existing locks). */
  replaceAll?: boolean;
  /** مصدر اختياري للتتبع */
  source?: string;
  [key: string]: unknown;
};

const DEFAULT_WS =
  typeof process !== 'undefined'
    ? String(process.env.NEXT_PUBLIC_GENERATIVE_GESTURE_WS ?? '').trim()
    : '';

/** Explicitly `false` / `0` / `off` / `no` → do not open the gesture WS (even if URL is set). */
function isGenerativeGesturesExplicitlyDisabled(): boolean {
  if (typeof process === 'undefined') return false;
  const v = String(process.env.NEXT_PUBLIC_ENABLE_GENERATIVE_GESTURES ?? '')
    .trim()
    .toLowerCase();
  return v === 'false' || v === '0' || v === 'off' || v === 'no';
}

/**
 * Reconnect attempts without a successful `onopen` before we stop (optional service down).
 * Override with NEXT_PUBLIC_GENERATIVE_GESTURE_MAX_RECONNECTS (1–20).
 */
const MAX_FAILS_WITHOUT_OPEN: number = (() => {
  if (typeof process === 'undefined') return 8;
  const n = Number(String(process.env.NEXT_PUBLIC_GENERATIVE_GESTURE_MAX_RECONNECTS ?? '').trim());
  if (Number.isFinite(n) && n >= 1) return Math.min(20, Math.floor(n));
  return 8;
})();

function parseGenerativePayload(raw: unknown): GenerativeGestureDetail | null {
  if (raw == null || typeof raw !== 'object') return null;
  const o = raw as Record<string, unknown>;
  if (o.bones && typeof o.bones === 'object') {
    return o as GenerativeGestureDetail;
  }
  if (o.type === 'generative:gesture' && o.payload && typeof o.payload === 'object') {
    return o.payload as GenerativeGestureDetail;
  }
  return o as GenerativeGestureDetail;
}

type GenerativeGestureManagerProps = {
  vrm: unknown;
  isTalkingRef?: MutableRefObject<boolean>;
  /** إن وُجد يُفتح WebSocket؛ وإلا لا اتصال (آمن افتراضياً) */
  wsUrl?: string;
  /**
   * When `false`, never opens the gesture WebSocket (overrides URL / env).
   * When omitted, uses `NEXT_PUBLIC_ENABLE_GENERATIVE_GESTURES` (must not be explicitly disabled).
   */
  enabled?: boolean;
  /** تفعيل الاستماع لحدث النافذة للاختبار */
  listenWindowEvent?: boolean;
  windowEventName?: string;
};

export function GenerativeGestureManager({
  vrm,
  isTalkingRef: _isTalkingRef,
  wsUrl: wsUrlProp,
  enabled: enabledProp,
  listenWindowEvent = true,
  windowEventName = 'cogni-generative-gesture:ingest',
}: GenerativeGestureManagerProps): null {
  void _isTalkingRef;
  const wsRef = useRef<WebSocket | null>(null);
  const reconnectTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const attemptRef = useRef(0);
  const mountedRef = useRef(true);
  const hasEverOpenedRef = useRef(false);
  const failsWithoutOpenRef = useRef(0);
  const abandonLoggedRef = useRef(false);
  const devMode =
    typeof process !== 'undefined' && process.env.NODE_ENV === 'development';

  const dispatchGenerative = useCallback((detail: GenerativeGestureDetail) => {
    if (typeof window === 'undefined') return;
    window.dispatchEvent(
      new CustomEvent('avatar:generative:gesture', {
        detail,
      }),
    );
  }, []);

  const handlePayload = useCallback(
    (raw: unknown) => {
      try {
        const parsed = parseGenerativePayload(raw);
        if (parsed?.bones && typeof parsed.bones === 'object') {
          dispatchGenerative(parsed);
        }
      } catch (err) {
        console.warn('[GenerativeGestureManager] Invalid generative payload (skipped):', err);
      }
    },
    [dispatchGenerative],
  );

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      if (reconnectTimerRef.current) clearTimeout(reconnectTimerRef.current);
      wsRef.current?.close();
      wsRef.current = null;
    };
  }, []);

  useEffect(() => {
    if (!vrm || !listenWindowEvent || typeof window === 'undefined') return;
    const onWin = (e: Event) => {
      try {
        const d = (e as CustomEvent<unknown>).detail;
        handlePayload(d);
      } catch (err) {
        console.warn('[GenerativeGestureManager] Window ingest event failed (skipped):', err);
      }
    };
    window.addEventListener(windowEventName, onWin as EventListener);
    return () => window.removeEventListener(windowEventName, onWin as EventListener);
  }, [vrm, listenWindowEvent, windowEventName, handlePayload]);

  useEffect(() => {
    const url = (wsUrlProp ?? DEFAULT_WS).trim();
    const envDisabled = isGenerativeGesturesExplicitlyDisabled();
    const propDisabled = enabledProp === false;
    const allowConnect =
      Boolean(vrm && url && typeof WebSocket !== 'undefined') &&
      !envDisabled &&
      !propDisabled;

    if (!allowConnect) {
      if (reconnectTimerRef.current) {
        clearTimeout(reconnectTimerRef.current);
        reconnectTimerRef.current = null;
      }
      wsRef.current?.close();
      wsRef.current = null;
      return;
    }

    let cancelled = false;

    const clearReconnectTimer = () => {
      if (reconnectTimerRef.current) {
        clearTimeout(reconnectTimerRef.current);
        reconnectTimerRef.current = null;
      }
    };

    /** One scheduled reconnect per disconnect cycle (avoids double schedule from onerror + onclose). */
    const scheduleReconnect = () => {
      if (cancelled || !mountedRef.current) return;
      if (reconnectTimerRef.current != null) return;
      if (!hasEverOpenedRef.current && failsWithoutOpenRef.current >= MAX_FAILS_WITHOUT_OPEN) {
        if (!abandonLoggedRef.current) {
          abandonLoggedRef.current = true;
          console.info(
            `[GenerativeGestureManager] Optional gesture service not available after ${MAX_FAILS_WITHOUT_OPEN} attempts (${url}). Reconnects stopped. ` +
              'Run the service on that port, or set NEXT_PUBLIC_ENABLE_GENERATIVE_GESTURES=false and/or clear NEXT_PUBLIC_GENERATIVE_GESTURE_WS.',
          );
        }
        return;
      }
      const attempt = attemptRef.current++;
      const delay = nextReconnectDelayMs(attempt);
      reconnectTimerRef.current = setTimeout(() => {
        reconnectTimerRef.current = null;
        connect();
      }, delay);
    };

    const connect = () => {
      if (cancelled) return;
      if (!hasEverOpenedRef.current && failsWithoutOpenRef.current >= MAX_FAILS_WITHOUT_OPEN) {
        return;
      }
      clearReconnectTimer();
      wsRef.current?.close();
      try {
        const ws = new WebSocket(url);
        wsRef.current = ws;
        ws.onopen = () => {
          hasEverOpenedRef.current = true;
          failsWithoutOpenRef.current = 0;
          attemptRef.current = 0;
          abandonLoggedRef.current = false;
        };
        ws.onerror = () => {
          if (devMode) {
            console.warn('[GenerativeGestureManager] WebSocket error:', url);
          }
          scheduleReconnect();
        };
        ws.onmessage = (ev) => {
          try {
            const text = String(ev.data);
            let parsedJson: unknown;
            try {
              parsedJson = JSON.parse(text) as unknown;
            } catch (parseErr) {
              console.warn('[GenerativeGestureManager] Malformed JSON from WebSocket (skipped):', parseErr);
              return;
            }
            handlePayload(parsedJson);
          } catch (err) {
            console.warn('[GenerativeGestureManager] Message handling failed (skipped):', err);
          }
        };
        ws.onclose = () => {
          if (!hasEverOpenedRef.current) {
            failsWithoutOpenRef.current += 1;
            if (failsWithoutOpenRef.current >= MAX_FAILS_WITHOUT_OPEN && !abandonLoggedRef.current) {
              abandonLoggedRef.current = true;
              console.info(
                `[GenerativeGestureManager] Optional gesture service unreachable (${url}). Stopping reconnects after ${MAX_FAILS_WITHOUT_OPEN} closes without a successful open.`,
              );
              return;
            }
          }
          scheduleReconnect();
        };
      } catch (err) {
        if (devMode) {
          console.warn('[GenerativeGestureManager] WebSocket construct failed:', err);
        }
        if (!hasEverOpenedRef.current) {
          failsWithoutOpenRef.current += 1;
        }
        if (!cancelled && mountedRef.current) {
          if (
            !hasEverOpenedRef.current &&
            failsWithoutOpenRef.current >= MAX_FAILS_WITHOUT_OPEN
          ) {
            if (!abandonLoggedRef.current) {
              abandonLoggedRef.current = true;
              console.info(
                `[GenerativeGestureManager] Giving up on gesture WebSocket (${url}) after repeated failures.`,
              );
            }
            return;
          }
          const attempt = attemptRef.current++;
          const delay = nextReconnectDelayMs(attempt);
          reconnectTimerRef.current = setTimeout(() => {
            reconnectTimerRef.current = null;
            connect();
          }, delay);
        }
      }
    };

    hasEverOpenedRef.current = false;
    failsWithoutOpenRef.current = 0;
    abandonLoggedRef.current = false;
    attemptRef.current = 0;
    connect();

    return () => {
      cancelled = true;
      clearReconnectTimer();
      wsRef.current?.close();
      wsRef.current = null;
    };
  }, [vrm, wsUrlProp, enabledProp, handlePayload, devMode]);

  return null;
}
