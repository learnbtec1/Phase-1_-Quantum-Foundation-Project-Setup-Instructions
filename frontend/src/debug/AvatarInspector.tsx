'use client';

/**
 * AvatarInspector — Real-time animation state inspector.
 * Development-only. Returns null in production.
 *
 * Mount at the bottom of AvatarCanvas JSX (outside Canvas):
 *   {isDev && <AvatarInspector stateRef={inspectorRef} />}
 *
 * Populate `stateRef.current` from useFrame (zero extra renders):
 *   inspectorRef.current.emotionWeights = { happy: 0.7, ... };
 */

import React, { useEffect, useRef, useState } from 'react';

export interface InspectorState {
  emotionWeights:   Record<string, number>;
  saccadeTarget:    { x: number; y: number };
  lastGesture:      string;
  thinkingTimeMs:   number;       // ms remaining in thinking pose
  recentFrameTypes: string[];     // last 5 WS frame types received
  fps:              number;
}

export interface AvatarInspectorProps {
  stateRef: React.MutableRefObject<Partial<InspectorState>>;
}

const DEF: InspectorState = {
  emotionWeights:   {},
  saccadeTarget:    { x: 0, y: 0 },
  lastGesture:      '—',
  thinkingTimeMs:   0,
  recentFrameTypes: [],
  fps:              0,
};

export function AvatarInspector({ stateRef }: AvatarInspectorProps) {
  if (process.env.NODE_ENV !== 'development') return null;

  const [snap, setSnap] = useState<InspectorState>(DEF);

  // Poll stateRef every 200 ms (5 fps is enough for debug text)
  useEffect(() => {
    const iv = setInterval(() => {
      setSnap({ ...DEF, ...stateRef.current });
    }, 200);
    return () => clearInterval(iv);
  }, [stateRef]);

  const emotions = Object.entries(snap.emotionWeights).filter(([, v]) => v > 0.01);

  return (
    <div className="absolute bottom-2 left-2 z-50 bg-black/75 backdrop-blur-sm rounded-lg p-3 text-xs font-mono text-white border border-gray-700 min-w-[200px] max-w-[260px] select-none">
      <div className="text-gray-400 font-semibold mb-1">Avatar Inspector</div>

      <div className="text-gray-500 mb-0.5">Emotions</div>
      {emotions.length === 0
        ? <div className="text-gray-600">neutral</div>
        : emotions.map(([k, v]) => (
          <div key={k} className="flex gap-1 items-center">
            <span className="text-gray-400 w-20">{k}</span>
            <div className="flex-1 bg-gray-800 rounded h-1.5">
              <div className="bg-blue-400 h-full rounded" style={{ width: `${(v * 100).toFixed(0)}%` }} />
            </div>
            <span className="text-gray-500 w-8 text-right">{(v * 100).toFixed(0)}</span>
          </div>
        ))
      }

      <div className="text-gray-500 mt-1.5 mb-0.5">Saccade</div>
      <div className="text-gray-300">
        x {snap.saccadeTarget.x.toFixed(3)} &nbsp; y {snap.saccadeTarget.y.toFixed(3)}
      </div>

      <div className="text-gray-500 mt-1.5 mb-0.5">Last Gesture</div>
      <div className="text-gray-300">{snap.lastGesture}</div>

      {snap.thinkingTimeMs > 0 && (
        <>
          <div className="text-gray-500 mt-1.5 mb-0.5">Thinking</div>
          <div className="text-yellow-400">{snap.thinkingTimeMs.toFixed(0)} ms left</div>
        </>
      )}

      <div className="text-gray-500 mt-1.5 mb-0.5">WS frames (last 5)</div>
      <div className="flex flex-wrap gap-1">
        {snap.recentFrameTypes.map((t, i) => (
          <span key={i} className="bg-gray-800 rounded px-1 text-gray-300">{t}</span>
        ))}
      </div>

      <div className="text-gray-500 mt-1.5 flex justify-between">
        <span>FPS</span>
        <span className={snap.fps < 45 ? 'text-amber-400' : 'text-green-400'}>
          {snap.fps.toFixed(0)}
        </span>
      </div>
    </div>
  );
}
