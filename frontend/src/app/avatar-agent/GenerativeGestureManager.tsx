'use client';

/**
 * جسر مستقبلي لإيماءات توليدية (MIBURI / RIDGE / API خارجية).
 * يعيد إرسال الرسائل كـ `avatar:generative:gesture` — لا يحرك العظام هنا.
 *
 * WebSocket معطّل ما لم يُضبط `wsUrl` أو NEXT_PUBLIC_GENERATIVE_GESTURE_WS.
 * بدون خادم نموذج: يمكن لاحقاً ربط استدلال نصّي (سؤال/أمر/شرح) أو كلمات مفتاحية بإيماءات ثابتة.
 */

import React, { useEffect, useRef, useCallback, type MutableRefObject } from 'react';

export type GenerativeBoneRot = {
  x?: number;
  y?: number;
  z?: number;
};

export type GenerativeGestureDetail = {
  bones?: Record<string, GenerativeBoneRot>;
  /** 0..1 — قوة الدمج في VRMSkeletonManager */
  blend?: number;
  /** مدة الإمساك بالهدف (ms) */
  durationMs?: number;
  /** مصدر اختياري للتتبع */
  source?: string;
  [key: string]: unknown;
};

const DEFAULT_WS =
  typeof process !== 'undefined'
    ? String(process.env.NEXT_PUBLIC_GENERATIVE_GESTURE_WS ?? '').trim()
    : '';

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
  /** تفعيل الاستماع لحدث النافذة للاختبار */
  listenWindowEvent?: boolean;
  windowEventName?: string;
};

export function GenerativeGestureManager({
  vrm,
  isTalkingRef: _isTalkingRef,
  wsUrl: wsUrlProp,
  listenWindowEvent = true,
  windowEventName = 'cogni-generative-gesture:ingest',
}: GenerativeGestureManagerProps): null {
  void _isTalkingRef;
  const wsRef = useRef<WebSocket | null>(null);
  const reconnectTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const attemptRef = useRef(0);
  const mountedRef = useRef(true);

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
      const parsed = parseGenerativePayload(raw);
      if (parsed?.bones && typeof parsed.bones === 'object') {
        dispatchGenerative(parsed);
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
      const d = (e as CustomEvent<unknown>).detail;
      handlePayload(d);
    };
    window.addEventListener(windowEventName, onWin as EventListener);
    return () => window.removeEventListener(windowEventName, onWin as EventListener);
  }, [vrm, listenWindowEvent, windowEventName, handlePayload]);

  useEffect(() => {
    const url = (wsUrlProp ?? DEFAULT_WS).trim();
    if (!vrm || !url || typeof WebSocket === 'undefined') return;

    let cancelled = false;

    const connect = () => {
      if (cancelled) return;
      wsRef.current?.close();
      try {
        const ws = new WebSocket(url);
        wsRef.current = ws;
        ws.onopen = () => {
          attemptRef.current = 0;
        };
        ws.onmessage = (ev) => {
          try {
            handlePayload(JSON.parse(String(ev.data)) as unknown);
          } catch {
            /* non-JSON */
          }
        };
        ws.onclose = () => {
          if (cancelled || !mountedRef.current) return;
          const attempt = attemptRef.current++;
          const delay = Math.min(30_000, 800 * 2 ** Math.min(attempt, 6));
          reconnectTimerRef.current = setTimeout(() => {
            reconnectTimerRef.current = null;
            connect();
          }, delay);
        };
      } catch {
        if (cancelled || !mountedRef.current) return;
        const attempt = attemptRef.current++;
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
  }, [vrm, wsUrlProp, handlePayload]);

  return null;
}
