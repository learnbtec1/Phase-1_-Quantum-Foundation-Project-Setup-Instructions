'use client';

import React, { useEffect, useState } from 'react';

/**
 * Lightweight HUD — reads `window.__DIAGNOSTICS` on an interval (not every React frame).
 * Enable via `NEXT_PUBLIC_DIAGNOSTICS_OVERLAY=true`.
 */
export function DiagnosticsOverlay(): null | React.ReactElement {
  const [snap, setSnap] = useState<{
    health: number;
    gesture: string;
    motionSource: string;
    failures: string;
    fps: number;
  } | null>(null);

  useEffect(() => {
    let id: ReturnType<typeof setInterval>;
    const tick = () => {
      if (typeof window === 'undefined') return;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const d = (window as any).__DIAGNOSTICS as
        | {
            runtimeHealthScore?: number;
            motion?: { gestureState?: string; motionSource?: string };
            activeFailures?: string[];
            execution?: { measuredFps?: number };
          }
        | undefined;
      if (!d) return;
      setSnap({
        health: d.runtimeHealthScore ?? 0,
        gesture: d.motion?.gestureState ?? '',
        motionSource: d.motion?.motionSource ?? '',
        failures: (d.activeFailures ?? []).join(','),
        fps: d.execution?.measuredFps ?? 0,
      });
    };
    tick();
    id = setInterval(tick, 480);
    return () => clearInterval(id);
  }, []);

  if (!snap) return null;

  return (
    <div
      style={{
        position: 'fixed',
        left: 8,
        bottom: 8,
        zIndex: 99999,
        fontFamily: 'ui-monospace, monospace',
        fontSize: 11,
        lineHeight: 1.35,
        padding: '8px 10px',
        borderRadius: 6,
        background: 'rgba(12,14,20,0.82)',
        color: '#e8edf7',
        pointerEvents: 'none',
        maxWidth: 420,
      }}
    >
      <div>health {snap.health}</div>
      <div>fps {snap.fps}</div>
      <div>
        {snap.motionSource} / {snap.gesture}
      </div>
      <div style={{ opacity: 0.85 }}>{snap.failures || '—'}</div>
    </div>
  );
}
