'use client';

import React, { useEffect, useState } from 'react';

export interface XRStoreLike {
  enterAR: () => Promise<unknown>;
}

export interface MRToggleProps {
  onStart?: () => void;
  store?: XRStoreLike | null;
  getOrCreateStore?: () => Promise<XRStoreLike | null>;
}

export default function MRToggle({ onStart, store, getOrCreateStore }: MRToggleProps) {
  const [supported, setSupported] = useState(false);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (typeof navigator === 'undefined' || !navigator.xr) {
      setSupported(false);
      return;
    }
    navigator.xr.isSessionSupported('immersive-ar').then(setSupported).catch(() => setSupported(false));
  }, []);

  const handleClick = async () => {
    try {
      setLoading(true);
      const s = store ?? (getOrCreateStore ? await getOrCreateStore() : null);
      if (!s?.enterAR) return;
      await s.enterAR();
      onStart?.();
      if (typeof window !== 'undefined') window.dispatchEvent(new Event('mr:start'));
    } catch (err) {
      console.warn('MR start failed', err);
    } finally {
      setLoading(false);
    }
  };

  if (!supported) return null;

  return (
    <button
      type="button"
      onClick={handleClick}
      disabled={loading}
      className="fixed top-4 left-4 z-20 px-3 py-1.5 rounded-lg border border-cyan-500/50 bg-slate-900/80 backdrop-blur-sm text-cyan-400 text-xs font-medium hover:bg-cyan-500/20 transition disabled:opacity-60 disabled:pointer-events-none"
      aria-label="Enter Mixed Reality"
    >
      {loading ? 'Loading…' : 'Enter MR'}
    </button>
  );
}
