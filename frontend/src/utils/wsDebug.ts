'use client';

import { logStep } from '@/utils/diagnostics';

/**
 * Wrapped WebSocket with step logging. `onerror` receives a DOM Event — no stack trace;
 * we emit a synthetic Error plus log the closing handshake when relevant.
 */
export function connectWebSocketDebug(url: string): WebSocket {
  logStep('WS_CONNECT', 'START', url);

  try {
    const ws = new WebSocket(url);

    ws.onopen = () => {
      logStep('WS_CONNECT', 'SUCCESS', { url, readyState: ws.readyState });
    };

    ws.onerror = () => {
      logStep(
        'WS_CONNECT',
        'FAIL',
        new Error('WebSocket runtime error (see Network tab — browser does not expose a stack here)'),
      );
    };

    ws.onclose = (e: CloseEvent) => {
      const ok =
        e.wasClean && (e.code === 1000 || e.code === 1005);
      if (ok) {
        logStep('WS_CONNECT', 'SUCCESS', {
          phase: 'CLOSED',
          code: e.code,
          reason: e.reason || '(none)',
          wasClean: e.wasClean,
        });
      } else {
        logStep(
          'WS_CONNECT',
          'FAIL',
          new Error(`WebSocket closed abnormally — code=${e.code} reason=${e.reason || ''} wasClean=${e.wasClean}`),
        );
      }
    };

    return ws;
  } catch (err: unknown) {
    logStep('WS_CONNECT', 'FAIL', err instanceof Error ? err : new Error(String(err)));
    throw err;
  }
}

/** Short probe: open, log success/fail, close with 1000. Does not reuse `connectWebSocketDebug` lifecycle (cleaner for runners). */
export function probeWebSocketHandshake(
  url: string,
  timeoutMs = 12_000,
): Promise<{ ok: boolean; url: string }> {
  if (typeof window === 'undefined') {
    return Promise.resolve({ ok: false, url });
  }

  return new Promise((resolve) => {
    logStep('WS_CONNECT', 'START', { url, mode: 'probe', timeoutMs });
    let settled = false;
    const finish = (ok: boolean): void => {
      if (settled) return;
      settled = true;
      resolve({ ok, url });
    };

    let ws: WebSocket | null = null;

    const timer = window.setTimeout(() => {
      logStep('WS_CONNECT', 'FAIL', new Error(`probe timeout ${timeoutMs}ms — ${url}`));
      try {
        ws?.close(4999, 'diagnostic-timeout');
      } catch {
        /* ignore */
      }
      finish(false);
    }, timeoutMs);

    try {
      ws = new WebSocket(url);
    } catch (err) {
      window.clearTimeout(timer);
      logStep('WS_CONNECT', 'FAIL', err instanceof Error ? err : new Error(String(err)));
      finish(false);
      return;
    }

    ws.onopen = () => {
      window.clearTimeout(timer);
      logStep('WS_CONNECT', 'SUCCESS', { url, mode: 'probe' });
      try {
        ws.close(1000, 'diagnostic-probe-complete');
      } catch {
        /* ignore */
      }
      finish(true);
    };

    ws.onerror = () => {
      window.clearTimeout(timer);
      logStep(
        'WS_CONNECT',
        'FAIL',
        new Error(`WebSocket error during probe — ${url}`),
      );
      finish(false);
    };

    ws.onclose = (e: CloseEvent) => {
      if (settled) return;
      window.clearTimeout(timer);
      logStep(
        'WS_CONNECT',
        'FAIL',
        new Error(`closed before OPEN — code=${e.code} reason=${e.reason || ''}`),
      );
      finish(false);
    };
  });
}
