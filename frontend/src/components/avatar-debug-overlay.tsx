'use client';
/**
 * AvatarDebugOverlay
 * ─────────────────────────────────────────────────────────────────────────
 * Lightweight, fixed top-right HUD that exposes the avatar pose pipeline's
 * runtime health.  Activated by setting `window.__AVATAR_DEBUG_OVERLAY = true`
 * in the console — completely off by default (no DOM mounted).
 *
 * Surfaces:
 *   • Per-bone authority for the current frame
 *   • Frozen bone list (red dot indicator — Part 6)
 *   • Conflict / rejection counts
 *   • Auto-detected root cause + confidence
 *
 * Polls the diagnostic module every 500 ms (no per-frame work).  Reads pure
 * snapshots — never mutates state.  Safe to ship: production users never see
 * it unless the flag is flipped manually.
 */

import React, { useEffect, useState } from 'react';
import {
  getFrameDiagnosticSummary,
  detectRootCause,
  type BoneAuthority,
  type FrameDiagnosticSummary,
  type RootCause,
} from '@/app/avatar-agent/motion/__boneAuthority';

const EMPTY_SUMMARY: FrameDiagnosticSummary = {
  frame:                0,
  conflicts:            0,
  rejections:           0,
  cooperativeBlends:    0,
  frozenBones:          [],
  overrides:            [],
  missingPose:          [],
  rootMotion:           false,
  hasExternalRoot:      false,
  locomotionDeadFrames: 0,
};

const EMPTY_CAUSE: RootCause = { cause: 'No issues detected', confidence: 'high' };

interface AuthorityReportShape {
  framesObserved:   number;
  perBoneThisFrame: Record<string, BoneAuthority>;
  health:           'OK' | 'DEGRADED' | 'BROKEN';
}

const POLL_INTERVAL_MS = 500;

export function AvatarDebugOverlay(): React.JSX.Element | null {
  const [enabled, setEnabled] = useState(false);
  const [summary, setSummary] = useState<FrameDiagnosticSummary>(EMPTY_SUMMARY);
  const [cause,   setCause]   = useState<RootCause>(EMPTY_CAUSE);
  const [perBone, setPerBone] = useState<Record<string, BoneAuthority>>({});
  const [health,  setHealth]  = useState<'OK' | 'DEGRADED' | 'BROKEN'>('OK');

  // ── Watch the debug flag — toggling in console flips the overlay live ────
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const check = () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const flag = Boolean((window as any).__AVATAR_DEBUG_OVERLAY);
      setEnabled((prev) => (prev === flag ? prev : flag));
    };
    check();
    const id = window.setInterval(check, 1000);
    return () => window.clearInterval(id);
  }, []);

  // ── Poll diagnostic state while enabled ─────────────────────────────────
  useEffect(() => {
    if (!enabled) return;
    if (typeof window === 'undefined') return;
    let cancelled = false;
    const tick = () => {
      if (cancelled) return;
      try {
        const s = getFrameDiagnosticSummary();
        setSummary(s);
        setCause(detectRootCause(s));
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const report = (window as any).__avatarAuthorityReport?.() as
          | AuthorityReportShape
          | undefined;
        if (report) {
          setPerBone(report.perBoneThisFrame);
          setHealth(report.health);
        }
      } catch {
        /* never let the overlay crash the page */
      }
    };
    tick();
    const id = window.setInterval(tick, POLL_INTERVAL_MS);
    return () => {
      cancelled = true;
      window.clearInterval(id);
    };
  }, [enabled]);

  if (!enabled) return null;

  const conflictTotal = summary.conflicts + summary.rejections;

  return (
    <div
      style={{
        position:        'fixed',
        top:             8,
        right:           8,
        zIndex:          99999,
        width:           320,
        maxHeight:       '70vh',
        overflowY:       'auto',
        padding:         '10px 12px',
        background:      'rgba(8, 10, 14, 0.92)',
        border:          '1px solid #2c3242',
        borderRadius:    8,
        color:           '#dde4ee',
        fontFamily:      'ui-monospace, "JetBrains Mono", Menlo, monospace',
        fontSize:        11,
        lineHeight:      1.45,
        boxShadow:       '0 8px 24px rgba(0,0,0,0.45)',
        pointerEvents:   'auto',
      }}
    >
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
        <strong style={{ fontSize: 12, color: '#7eb8ff' }}>AVATAR DEBUG</strong>
        <HealthBadge health={health} />
      </div>

      <div style={{ color: '#7d8896', marginBottom: 8 }}>
        frame <strong style={{ color: '#dde4ee' }}>{summary.frame}</strong> · conflicts{' '}
        <strong style={{ color: conflictTotal > 0 ? '#ffcf66' : '#dde4ee' }}>{summary.conflicts}</strong>{' '}
        · rejections <strong style={{ color: summary.rejections > 0 ? '#ffcf66' : '#dde4ee' }}>{summary.rejections}</strong>{' '}
        · blends <strong style={{ color: '#dde4ee' }}>{summary.cooperativeBlends}</strong>
      </div>

      <Section label="ROOT CAUSE">
        <div
          style={{
            color: cause.confidence === 'high' && cause.cause !== 'No issues detected' ? '#ff8d8d' : '#bfd6f6',
            wordBreak: 'break-word',
          }}
        >
          {cause.cause}
        </div>
        <div style={{ color: '#7d8896', marginTop: 2 }}>confidence: {cause.confidence}</div>
      </Section>

      <Section label={`FROZEN BONES (${summary.frozenBones.length})`}>
        {summary.frozenBones.length === 0 ? (
          <div style={{ color: '#7d8896' }}>none</div>
        ) : (
          <ul style={listStyle}>
            {summary.frozenBones.map((b) => (
              <li key={b} style={listItemStyle}>
                <span style={{ color: '#ff5151', marginRight: 6 }}>●</span>
                {b}
              </li>
            ))}
          </ul>
        )}
      </Section>

      <Section label={`OVERRIDES (${summary.overrides.length})`}>
        {summary.overrides.length === 0 ? (
          <div style={{ color: '#7d8896' }}>none</div>
        ) : (
          <ul style={listStyle}>
            {summary.overrides.map((b) => (
              <li key={b} style={listItemStyle}>
                <span style={{ color: '#ffaf3d', marginRight: 6 }}>◆</span>
                {b}
              </li>
            ))}
          </ul>
        )}
      </Section>

      <Section label={`MISSING POSE (${summary.missingPose.length})`}>
        {summary.missingPose.length === 0 ? (
          <div style={{ color: '#7d8896' }}>none</div>
        ) : (
          <ul style={listStyle}>
            {summary.missingPose.map((b) => (
              <li key={b} style={listItemStyle}>
                <span style={{ color: '#ff5151', marginRight: 6 }}>!</span>
                {b}
              </li>
            ))}
          </ul>
        )}
      </Section>

      <Section label="ROOT MOTION">
        <div style={{ color: summary.rootMotion ? '#7fffaf' : '#7d8896' }}>
          {summary.hasExternalRoot
            ? summary.rootMotion
              ? 'YES — AvatarRoot translating'
              : 'no — AvatarRoot stationary'
            : 'unknown — root not yet sampled'}
        </div>
        {summary.locomotionDeadFrames > 0 && (
          <div style={{ color: summary.locomotionDeadFrames >= 240 ? '#ff8d8d' : '#7d8896', marginTop: 2 }}>
            idle frames: {summary.locomotionDeadFrames}
            {summary.locomotionDeadFrames >= 240 && ' — DEAD (set window.__INJECT_LOCOMOTION_FALLBACK = true)'}
          </div>
        )}
      </Section>

      <Section label={`PER-BONE AUTHORITY (${Object.keys(perBone).length})`}>
        {Object.keys(perBone).length === 0 ? (
          <div style={{ color: '#7d8896' }}>no claims yet</div>
        ) : (
          <ul style={listStyle}>
            {Object.entries(perBone)
              .sort(([a], [b]) => a.localeCompare(b))
              .map(([bone, auth]) => {
                const frozen = summary.frozenBones.includes(bone);
                return (
                  <li key={bone} style={listItemStyle}>
                    {frozen && <span style={{ color: '#ff5151', marginRight: 6 }}>●</span>}
                    <span style={{ color: '#bfd6f6' }}>{bone}</span>
                    <span style={{ color: '#7d8896' }}> → </span>
                    <strong style={{ color: AUTHORITY_COLOURS[auth] ?? '#dde4ee' }}>{auth}</strong>
                  </li>
                );
              })}
          </ul>
        )}
      </Section>

      <div style={{ marginTop: 10, paddingTop: 6, borderTop: '1px solid #20242e', color: '#7d8896' }}>
        toggle: <code style={{ color: '#bfd6f6' }}>window.__AVATAR_DEBUG_OVERLAY = false</code>
      </div>
    </div>
  );
}

// ── Inline style + helpers ─────────────────────────────────────────────────

const AUTHORITY_COLOURS: Readonly<Record<string, string>> = {
  NONE:    '#7d8896',
  MICRO:   '#7fffaf',
  INTENT:  '#7eb8ff',
  GESTURE: '#ffcf66',
  VRMA:    '#c290ff',
  PHYSICS: '#ff8d8d',
};

const listStyle: React.CSSProperties = {
  listStyle:   'none',
  margin:      0,
  padding:     0,
};

const listItemStyle: React.CSSProperties = {
  padding:    '1px 0',
  whiteSpace: 'nowrap',
};

function Section({ label, children }: { label: string; children: React.ReactNode }): React.JSX.Element {
  return (
    <div style={{ marginTop: 8 }}>
      <div style={{ color: '#7d8896', fontSize: 10, letterSpacing: 0.4, marginBottom: 2 }}>{label}</div>
      {children}
    </div>
  );
}

function HealthBadge({ health }: { health: 'OK' | 'DEGRADED' | 'BROKEN' }): React.JSX.Element {
  const colour =
    health === 'OK'       ? '#7fffaf' :
    health === 'DEGRADED' ? '#ffcf66' :
                            '#ff5151';
  return (
    <span
      style={{
        color:        colour,
        border:       `1px solid ${colour}`,
        borderRadius: 999,
        padding:      '1px 8px',
        fontSize:     10,
        letterSpacing: 0.5,
      }}
    >
      {health}
    </span>
  );
}

export default AvatarDebugOverlay;
