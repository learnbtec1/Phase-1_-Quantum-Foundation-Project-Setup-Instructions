'use client';
/**
 * OfficeDebugHUD — small overlay shown for 6 seconds after mount.
 * Confirms whether the GLB loaded successfully or fell back to placeholder.
 * Automatically hides after 6 s. Does NOT render inside <Canvas>.
 */
import React, { useEffect, useState } from 'react';

type Props = {
  okOffice: boolean;
  url:      string;
  pos:      [number, number, number];
};

export function OfficeDebugHUD({ okOffice, url, pos }: Props) {
  const [visible, setVisible] = useState(true);

  useEffect(() => {
    const t = setTimeout(() => setVisible(false), 6000);
    return () => clearTimeout(t);
  }, []);

  if (!visible) return null;

  return (
    <div
      style={{
        position:   'absolute',
        top:        8,
        left:       8,
        padding:    '8px 10px',
        background: 'rgba(13,17,23,0.75)',
        color:      '#dbe5ff',
        font:       '11px/1.5 monospace',
        border:     '1px solid #243042',
        borderRadius: 6,
        pointerEvents: 'none',
        zIndex:     100,
        maxWidth:   320,
      }}
    >
      <div><b>Office GLB:</b> {url}</div>
      <div>
        <b>Status:</b>{' '}
        {okOffice
          ? <span style={{ color: '#4aed88' }}>✓ loaded</span>
          : <span style={{ color: '#f0a04b' }}>⚠ fallback placeholder</span>}
      </div>
      <div><b>Target&nbsp;Z:</b> {pos[2].toFixed(2)}</div>
      {!okOffice && (
        <div style={{ marginTop: 4, color: '#94aabf' }}>
          Place your GLB at <code>/public{url}</code> and reload.
          Open Console → <em>[OfficeSetLoader]</em> to see discovered node names.
        </div>
      )}
    </div>
  );
}
