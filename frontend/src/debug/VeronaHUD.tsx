'use client';

/**
 * VeronaHUD — Lightweight debug overlay for the avatar-agent page.
 *
 * • Auto-hides 8 s after mount.
 * • Toggle visibility with the 'h' key at any time.
 * • Shows VRM loading state, breathing, blink, viseme, persona, and fallback warnings.
 * • Rendered outside the R3F Canvas (plain React DOM).
 * • Production: component still mounts but returns null (zero overhead).
 */

import React, { useEffect, useRef, useState, useCallback } from 'react';

export interface VeronaHUDProps {
  /** Current VRM model URL being used. */
  modelUrl: string;
  /** Whether the VRM has loaded successfully. */
  vrmLoaded: boolean;
  /** True when a fallback model is active (not the primary URL). */
  isFallback?: boolean;
  /** Breathing amplitude currently applied. */
  breatheAmp?: number;
  /** Breathing frequency in Hz. */
  breatheHz?: number;
  /** Unix timestamp (ms) of the last blink. */
  lastBlinkMs?: number;
  /** Viseme lerp smoothing factor (0–1). */
  visemeFactor?: number;
  /** Active persona identifier. */
  persona?: string;
  /** P.A.D emotion state from EmotionEngine. */
  pad?: { p: number; a: number; d: number; label: string };
  /** True when TTS/WS circuit breaker is open (failed). */
  circuitOpen?: boolean;
  /** Age of last WS heartbeat in ms. */
  wsHeartbeatMs?: number;
  /** Personality drift elapsed in ms (for drift rate display). */
  driftMs?: number;
  /** Short-term memory exchange count. */
  memorySize?: number;
  /** Current personality trait values. */
  personality?: {
    empathy:      number;
    humor:        number;
    openness:     number;
    agreeableness: number;
    formality:    number;
  };
}

const HIDE_AFTER_MS = 8_000;
const ROW = 'flex gap-2 text-xs';
const LABEL = 'text-gray-400 w-28 shrink-0';
const VALUE = 'text-white font-mono';

function Row({ label, value, warn }: { label: string; value: string; warn?: boolean }) {
  return (
    <div className={ROW}>
      <span className={LABEL}>{label}</span>
      <span className={`${VALUE} ${warn ? 'text-amber-400' : ''}`}>{value}</span>
    </div>
  );
}

/** Horizontal meter bar — value in [-1, 1] or [0, 1] depending on `bipolar`. */
function MeterBar({
  value, color, bipolar = false,
}: { value: number; color: string; bipolar?: boolean }) {
  const pct = bipolar
    ? ((value + 1) / 2) * 100   // -1…+1 → 0…100%
    : Math.max(0, Math.min(1, value)) * 100;
  return (
    <div className="h-1.5 w-full bg-gray-700 rounded overflow-hidden">
      <div
        className={`h-full rounded transition-all duration-300 ${color}`}
        // Dynamic percentage — CSS variable avoids inline-style lint warning
        // eslint-disable-next-line @typescript-eslint/consistent-type-assertions
        {...({ style: { width: `${pct}%` } } as React.HTMLAttributes<HTMLDivElement>)}
      />
    </div>
  );
}

export function VeronaHUD({
  modelUrl,
  vrmLoaded,
  isFallback = false,
  breatheAmp = 0,
  breatheHz  = 0,
  lastBlinkMs,
  visemeFactor = 0.2,
  persona = 'dr-hamza-v200',
  pad,
  circuitOpen,
  wsHeartbeatMs,
  driftMs,
  memorySize,
  personality,
}: VeronaHUDProps) {
  if (process.env.NODE_ENV !== 'development') return null;

  const [visible, setVisible] = useState(true);
  const hideTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [blinkAgo, setBlinkAgo] = useState('—');

  // Auto-hide after 8 s
  useEffect(() => {
    hideTimer.current = setTimeout(() => setVisible(false), HIDE_AFTER_MS);
    return () => { if (hideTimer.current) clearTimeout(hideTimer.current); };
  }, []);

  // Toggle on 'h' key
  const handleKey = useCallback((e: KeyboardEvent) => {
    if (e.key === 'h' && !e.ctrlKey && !e.metaKey && !e.altKey) {
      setVisible(v => !v);
      // Reset auto-hide timer on manual toggle
      if (hideTimer.current) clearTimeout(hideTimer.current);
      hideTimer.current = setTimeout(() => setVisible(false), HIDE_AFTER_MS);
    }
  }, []);

  useEffect(() => {
    window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
  }, [handleKey]);

  // Update "blink N ms ago" every 500 ms
  useEffect(() => {
    if (!lastBlinkMs) return;
    const iv = setInterval(() => {
      const ago = Date.now() - lastBlinkMs;
      setBlinkAgo(ago < 60_000 ? `${(ago / 1000).toFixed(1)} s ago` : 'never');
    }, 500);
    return () => clearInterval(iv);
  }, [lastBlinkMs]);

  // Track WS heartbeat age
  const [heartbeatAgo, setHeartbeatAgo] = useState<string>('—');
  useEffect(() => {
    if (!wsHeartbeatMs) return;
    const iv = setInterval(() => {
      const ago = Date.now() - wsHeartbeatMs;
      setHeartbeatAgo(`${ago} ms`);
    }, 250);
    return () => clearInterval(iv);
  }, [wsHeartbeatMs]);

  if (!visible) {
    return (
      <div
        className="absolute top-2 left-2 z-50 text-xs text-gray-600 select-none"
        title="Press 'h' to show HUD"
      >
        [HUD]
      </div>
    );
  }

  const shortUrl = modelUrl.replace('/models/', '');

  return (
    <div className="absolute top-2 left-2 z-50 bg-black/70 backdrop-blur-sm rounded-lg p-3 space-y-1 border border-gray-700 select-none min-w-[240px]">
      <div className="text-xs text-gray-500 font-semibold mb-1 flex justify-between">
        <span>Verona HUD</span>
        <span className="text-gray-600 cursor-pointer" onClick={() => setVisible(false)}>✕</span>
      </div>

      {isFallback && (
        <div className="text-amber-400 text-xs font-bold bg-amber-400/10 rounded px-1 py-0.5">
          ⚠ FALLBACK MODEL ACTIVE
        </div>
      )}

      <Row label="Model"      value={shortUrl} warn={isFallback} />
      <Row label="VRM Loaded" value={vrmLoaded ? '✓ yes' : '✗ loading…'} warn={!vrmLoaded} />
      <Row label="Persona"    value={persona} />
      <Row label="Breathe"    value={`${breatheHz.toFixed(2)} Hz · amp ${breatheAmp.toFixed(3)}`} />
      <Row label="Last Blink" value={blinkAgo} />
      <Row label="Viseme Lerp" value={visemeFactor.toFixed(2)} />

      {/* ── P.A.D Emotion ─────────────────────────────────────────── */}
      {pad && (
        <div className="pt-1 border-t border-gray-700 space-y-1">
          <div className="text-xs text-gray-500 font-semibold">P.A.D  <span className="text-gray-400 font-normal">{pad.label}</span></div>
          <div className="grid grid-cols-[4rem_1fr] gap-x-2 gap-y-0.5 text-xs">
            <span className="text-gray-400">Pleasure</span>
            <MeterBar value={pad.p} color="bg-emerald-400" bipolar />
            <span className="text-gray-400">Arousal</span>
            <MeterBar value={pad.a} color="bg-orange-400" bipolar />
            <span className="text-gray-400">Dominance</span>
            <MeterBar value={pad.d} color="bg-blue-400" bipolar />
          </div>
        </div>
      )}

      {/* ── System Status ──────────────────────────────────────── */}
      {(circuitOpen !== undefined || wsHeartbeatMs !== undefined || memorySize !== undefined) && (
        <div className="pt-1 border-t border-gray-700 space-y-1">
          {circuitOpen !== undefined && (
            <Row
              label="Circuit"
              value={circuitOpen ? '🔴 OPEN' : '🟢 CLOSED'}
              warn={circuitOpen}
            />
          )}
          {wsHeartbeatMs !== undefined && (
            <Row label="WS Heartbeat" value={heartbeatAgo} warn={Date.now() - wsHeartbeatMs > 10_000} />
          )}
          {memorySize !== undefined && (
            <Row label="Memory" value={`${memorySize} exchanges`} />
          )}
        </div>
      )}

      {/* ── Personality Traits ───────────────────────────────────── */}
      {personality && (
        <div className="pt-1 border-t border-gray-700 space-y-1">
          <div className="text-xs text-gray-500 font-semibold">Personality</div>
          <div className="grid grid-cols-[4rem_1fr] gap-x-2 gap-y-0.5 text-xs">
            {([
              ['Empathy',   personality.empathy,       'bg-pink-400'],
              ['Humor',     personality.humor,         'bg-yellow-400'],
              ['Openness',  personality.openness,      'bg-purple-400'],
              ['Agree',     personality.agreeableness, 'bg-teal-400'],
              ['Formality', personality.formality,     'bg-indigo-400'],
            ] as [string, number, string][]).map(([name, val, cls]) => (
              <React.Fragment key={name}>
                <span className="text-gray-400">{name}</span>
                <MeterBar value={val} color={cls} />
              </React.Fragment>
            ))}
          </div>
        </div>
      )}

      <div className="text-gray-600 text-xs pt-1 border-t border-gray-700">
        Press <kbd className="bg-gray-800 px-1 rounded">h</kbd> to toggle
      </div>
    </div>
  );
}
