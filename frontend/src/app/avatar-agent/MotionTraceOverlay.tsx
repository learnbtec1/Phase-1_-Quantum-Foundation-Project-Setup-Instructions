'use client';

/**
 * Dev-only HUD for motion diagnostics (no behavior changes).
 */
import React, { useEffect, useState } from 'react';
import { getMotionTraceOverlayState } from '@/lib/avatar/motionDiagnostics';

export function MotionTraceOverlay(): React.ReactNode {
  const [text, setText] = useState('');
  useEffect(() => {
    if (process.env.NODE_ENV !== 'development') return;
    if (typeof window === 'undefined') return;
    const tick = () => {
      try {
        setText(JSON.stringify(getMotionTraceOverlayState(), null, 2));
      } catch {
        setText('{}');
      }
    };
    tick();
    const id = window.setInterval(tick, 500);
    return () => window.clearInterval(id);
  }, []);
  if (process.env.NODE_ENV !== 'development') return null;
  return (
    <pre
      style={{
        position: 'fixed',
        right: 8,
        bottom: 8,
        zIndex: 99999,
        margin: 0,
        padding: '8px 10px',
        maxWidth: 320,
        maxHeight: '42vh',
        overflow: 'auto',
        fontSize: 11,
        lineHeight: 1.35,
        fontFamily: 'ui-monospace, monospace',
        color: '#e8e8e8',
        background: 'rgba(12,12,18,0.88)',
        border: '1px solid rgba(255,255,255,0.12)',
        borderRadius: 6,
        pointerEvents: 'none',
        whiteSpace: 'pre-wrap',
      }}
    >
      {text}
    </pre>
  );
}
