'use client';

import { useSyncExternalStore, useState, type JSX } from 'react';
import { isObservabilityEnabled } from './config';
import {
  subscribeObservability,
  getObservabilitySnapshot,
  getObservabilityServerSnapshot,
} from './observabilityHub';

/**
 * Dev / diagnostic HUD: FPS, drift, lip sync, alerts. Pointer-events-none by default.
 */
export function ObservabilityOverlay(): JSX.Element | null {
  const enabled = isObservabilityEnabled();
  const [collapsed, setCollapsed] = useState(false);

  const snap = useSyncExternalStore(
    subscribeObservability,
    getObservabilitySnapshot,
    getObservabilityServerSnapshot,
  );

  if (!enabled) return null;

  const lipColor =
    snap.lipDriftLevel === 'critical'
      ? 'text-red-400'
      : snap.lipDriftLevel === 'warning'
        ? 'text-amber-400'
        : 'text-emerald-400';

  return (
    <div className="pointer-events-none absolute bottom-3 left-3 z-[60] max-w-[min(100%,22rem)] select-none font-mono text-[10px] leading-snug text-gray-200">
      <button
        type="button"
        className="pointer-events-auto mb-1 rounded border border-white/20 bg-black/75 px-2 py-0.5 text-[10px] text-white/80 hover:bg-black/90"
        onClick={() => setCollapsed((c) => !c)}
      >
        {collapsed ? 'Show Cogni observability' : 'Hide'}
      </button>
      {!collapsed && (
        <div className="rounded-lg border border-white/15 bg-black/80 px-2.5 py-2 shadow-lg backdrop-blur-sm">
          <div className="mb-1 text-[11px] font-semibold text-sky-300/95">Cogni observability</div>
          <div className="grid grid-cols-[7rem_1fr] gap-x-2 gap-y-0.5">
            <span className="text-gray-500">FPS</span>
            <span>{snap.fps.toFixed(0)}</span>
            <span className="text-gray-500">Frame ms</span>
            <span>{snap.frameTimeMs.toFixed(2)}</span>
            <span className="text-gray-500">Spike</span>
            <span className={snap.frameSpike ? 'text-amber-400' : ''}>{snap.frameSpike ? 'yes' : 'no'}</span>
            <span className="text-gray-500">Heap MB</span>
            <span>{snap.heapUsedMb != null ? snap.heapUsedMb.toFixed(1) : '—'}</span>
            <span className="text-gray-500">Heap trend</span>
            <span>{snap.heapTrend}</span>
            <span className="text-gray-500">Root drift m</span>
            <span className={snap.rootDriftWarn ? 'text-amber-400' : ''}>{snap.rootDriftM.toFixed(4)}</span>
            <span className="text-gray-500">Lip Δ ms</span>
            <span className={lipColor}>{snap.lipDriftMs.toFixed(1)}</span>
            <span className="text-gray-500">Motion silent</span>
            <span className={snap.motionFreezeSuspect ? 'text-amber-400' : ''}>
              {snap.motionSilentSec.toFixed(1)} s
            </span>
            <span className="text-gray-500">Brain churn/s</span>
            <span className={snap.stateChurnWarn ? 'text-amber-400' : ''}>{snap.brainChurnPerSec.toFixed(1)}</span>
            <span className="text-gray-500">Gesture repeat</span>
            <span>{(snap.gestureRepeatRatio * 100).toFixed(0)}%</span>
            <span className="text-gray-500">Three geo/tex</span>
            <span>
              {snap.threeGeometries} / {snap.threeTextures}
            </span>
            <span className="text-gray-500">Events</span>
            <span>{snap.eventStreamLen}</span>
          </div>
          {snap.activeInsights.length > 0 && (
            <div className="mt-2 border-t border-white/10 pt-2">
              <div className="mb-0.5 text-[9px] uppercase tracking-wide text-gray-500">Insights</div>
              {snap.activeInsights.map((i) => (
                <div key={i.id} className="mb-1.5 text-[9px] text-gray-300">
                  <span
                    className={
                      i.severity === 'CRITICAL'
                        ? 'text-red-400'
                        : i.severity === 'WARNING'
                          ? 'text-amber-400'
                          : 'text-gray-400'
                    }
                  >
                    [{i.severity}]
                  </span>{' '}
                  {i.title}: {i.summary}
                </div>
              ))}
            </div>
          )}
          {snap.recentAlerts.length > 0 && (
            <div className="mt-2 max-h-28 overflow-y-auto border-t border-white/10 pt-2">
              <div className="mb-0.5 text-[9px] uppercase tracking-wide text-gray-500">Alerts</div>
              {snap.recentAlerts.map((a) => (
                <div key={a.id} className="mb-1 text-[9px] text-gray-400">
                  {a.message}
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
