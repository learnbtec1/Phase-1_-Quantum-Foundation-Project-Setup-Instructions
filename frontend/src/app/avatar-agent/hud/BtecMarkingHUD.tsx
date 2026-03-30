'use client';

import React from 'react';
import { Html } from '@react-three/drei';

export type BtecCriterion = { id: string; status: 'done' | 'pending' | 'missing' };
/** Alias for API / state wiring (same shape as `BtecCriterion`). */
export type MarkingCriteria = BtecCriterion;

const hudShell = 'pointer-events-none max-w-[280px]';

export function BtecMarkingHUD({
  criteria,
  assignmentId,
}: {
  /** `null` = not loaded yet; `[]` = loaded empty; otherwise rows to show. */
  criteria?: BtecCriterion[] | null;
  /** When missing or whitespace-only, no API fetch should run; show waiting UI. */
  assignmentId?: string | null;
}) {
  const id = assignmentId?.trim() ?? '';

  if (!id) {
    return (
      <Html transform distanceFactor={1.0} occlude={false} style={{ pointerEvents: 'none' }}>
        <div
          className={`${hudShell} text-gray-400 text-sm p-4 border border-dashed border-gray-600 rounded bg-black/30`}
        >
          Waiting for assignment context...
        </div>
      </Html>
    );
  }

  if (criteria == null) {
    return (
      <Html transform distanceFactor={1.0} occlude={false} style={{ pointerEvents: 'none' }}>
        <div
          className={`${hudShell} text-gray-400 text-sm p-4 rounded border border-white/20 bg-white/10 backdrop-blur-md`}
        >
          Loading marking criteria…
        </div>
      </Html>
    );
  }

  if (criteria.length === 0) {
    return (
      <Html transform distanceFactor={1.0} occlude={false} style={{ pointerEvents: 'none' }}>
        <div
          className={`${hudShell} text-gray-400 text-sm p-4 rounded border border-dashed border-gray-600 bg-black/20`}
        >
          No marking criteria returned for this assignment.
        </div>
      </Html>
    );
  }

  return (
    <Html transform distanceFactor={1.0} occlude={false} style={{ pointerEvents: 'none' }}>
      <div
        style={{
          display: 'flex',
          flexDirection: 'column',
          gap: 6,
          background: 'rgba(255,255,255,0.1)',
          backdropFilter: 'blur(8px)',
          padding: '10px',
          borderRadius: '12px',
          border: '1px solid rgba(255,255,255,0.2)',
        }}
      >
        {criteria.map((c) => (
          <div
            key={c.id}
            style={{
              color: 'white',
              fontSize: '12px',
              display: 'flex',
              alignItems: 'center',
              gap: '8px',
            }}
          >
            <span
              style={{
                width: 8,
                height: 8,
                borderRadius: '50%',
                background:
                  c.status === 'done' ? '#2ecc71' : c.status === 'pending' ? '#f1c40f' : '#e74c3c',
              }}
            />
            {c.id}
          </div>
        ))}
      </div>
    </Html>
  );
}

export default BtecMarkingHUD;
