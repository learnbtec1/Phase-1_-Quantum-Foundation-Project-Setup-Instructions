'use client';

import React, { useCallback, useEffect, useRef, useState } from 'react';

// ── Emotion colour palette ────────────────────────────────────────────────────
const EMOTION_PALETTE: Record<string, { bg: string; glow: string }> = {
  happy:            { bg: 'radial-gradient(circle, #fde68a, #f59e0b)', glow: '#fbbf24' },
  excited:          { bg: 'radial-gradient(circle, #fdba74, #ea580c)', glow: '#fb923c' },
  angry:            { bg: 'radial-gradient(circle, #fca5a5, #dc2626)', glow: '#ef4444' },
  sad:              { bg: 'radial-gradient(circle, #93c5fd, #1d4ed8)', glow: '#3b82f6' },
  surprised:        { bg: 'radial-gradient(circle, #c4b5fd, #7c3aed)', glow: '#a78bfa' },
  blush:            { bg: 'radial-gradient(circle, #fda4af, #be185d)', glow: '#f472b6' },
  sleepy:           { bg: 'radial-gradient(circle, #a5b4fc, #4338ca)', glow: '#818cf8' },
  thinking:         { bg: 'radial-gradient(circle, #6ee7b7, #059669)', glow: '#34d399' },
  relax:            { bg: 'radial-gradient(circle, #67e8f9, #0284c7)', glow: '#22d3ee' },
  celebration:      { bg: 'radial-gradient(circle, #fde68a, #d97706)', glow: '#fbbf24' },
  encouraging:      { bg: 'radial-gradient(circle, #86efac, #16a34a)', glow: '#4ade80' },
  strictEvaluation: { bg: 'radial-gradient(circle, #fca5a5, #b91c1c)', glow: '#ef4444' },
  friendly:         { bg: 'radial-gradient(circle, #fde68a, #f59e0b)', glow: '#fbbf24' },
  neutral:          { bg: 'radial-gradient(circle, #cbd5e1, #475569)', glow: '#94a3b8' },
  normal:           { bg: 'radial-gradient(circle, #cbd5e1, #475569)', glow: '#94a3b8' },
};

const IDLE_PALETTE   = { bg: 'radial-gradient(circle, #ffaa00, #ff5500)', glow: '#ffaa00' };
const SPEAK_PALETTE  = { bg: 'radial-gradient(circle, #86efac, #0ea5e9)', glow: '#38bdf8' };
const LISTEN_PALETTE = { bg: 'radial-gradient(circle, #c4b5fd, #7c3aed)', glow: '#a78bfa' };

// ── Arabic emotion labels shown in the orb ────────────────────────────────────
const EMOTION_LABEL: Record<string, string> = {
  happy: 'سعيد', excited: 'متحمس', angry: 'غاضب', sad: 'حزين',
  surprised: 'مندهش', blush: 'خجول', sleepy: 'نعسان', thinking: 'يفكر',
  relax: 'مرتاح', celebration: 'يحتفل', encouraging: 'يشجع',
  strictEvaluation: 'صارم', friendly: 'ودود', neutral: 'محايد', normal: 'جاهز',
};

type Props = {
  label?: string;
};

const DrHamzaOrb: React.FC<Props> = ({ label = 'د. حمزة' }) => {
  const [isSpeaking, setIsSpeaking]   = useState(false);
  const [isListening, setIsListening] = useState(false);
  const [isHovering, setIsHovering]   = useState(false);
  const [emotion, setEmotion]         = useState<string>('normal');
  const [pulseScale, setPulseScale]   = useState(1);
  const pulseRaf = useRef<number | null>(null);
  const pulsePhase = useRef(0);

  // ── Live pulse animation while speaking ──────────────────────────────────
  useEffect(() => {
    if (!isSpeaking) {
      setPulseScale(1);
      if (pulseRaf.current) cancelAnimationFrame(pulseRaf.current);
      return;
    }
    let last = performance.now();
    const tick = (now: number) => {
      const dt = (now - last) / 1000;
      last = now;
      pulsePhase.current += dt * 6.5;
      setPulseScale(1 + Math.sin(pulsePhase.current) * 0.055);
      pulseRaf.current = requestAnimationFrame(tick);
    };
    pulseRaf.current = requestAnimationFrame(tick);
    return () => { if (pulseRaf.current) cancelAnimationFrame(pulseRaf.current); };
  }, [isSpeaking]);

  // ── Subscribe to avatar event bus ─────────────────────────────────────────
  useEffect(() => {
    const onStart    = () => setIsSpeaking(true);
    const onEnd      = () => setIsSpeaking(false);
    const onEmot  = (e: Event) => {
      const detail = (e as CustomEvent<{ emotion?: string } | string>).detail;
      const name   = typeof detail === 'string' ? detail : detail?.emotion ?? 'normal';
      setEmotion(name);
    };
    const onListen = (e: Event) => {
      setIsListening((e as CustomEvent<{ active?: boolean }>).detail?.active ?? false);
    };

    window.addEventListener('avatar:speak:start', onStart);
    window.addEventListener('avatar:speak:end',   onEnd);
    window.addEventListener('avatar:emotion',     onEmot);
    window.addEventListener('avatar:listening',   onListen);
    return () => {
      window.removeEventListener('avatar:speak:start', onStart);
      window.removeEventListener('avatar:speak:end',   onEnd);
      window.removeEventListener('avatar:emotion',     onEmot);
      window.removeEventListener('avatar:listening',   onListen);
    };
  }, []);

  // ── Click: wave greeting + set emotion ───────────────────────────────────
  const handleClick = useCallback(() => {
    window.dispatchEvent(new CustomEvent('avatar:gesture', {
      detail: { type: 'wave', side: 'right', duration: 2.5, intensity: 1, variance: Math.random() },
    }));
    window.dispatchEvent(new CustomEvent('avatar:emotion', { detail: { emotion: 'friendly' } }));
  }, []);

  const palette = isListening
    ? LISTEN_PALETTE
    : isSpeaking
      ? SPEAK_PALETTE
      : (EMOTION_PALETTE[emotion] ?? IDLE_PALETTE);

  const orbScale = (isHovering ? 1.08 : 1) * pulseScale;

  // ── Speaking ring indicator ───────────────────────────────────────────────
  const ringOpacity = isSpeaking ? 0.7 : 0;

  return (
    <div
      style={{ position: 'fixed', bottom: 20, right: 20, zIndex: 9999 }}
      aria-live="polite"
    >
      {/* outer glow ring — pulses while speaking */}
      <div
        style={{
          position: 'absolute',
          inset: -8,
          borderRadius: '50%',
          border: `3px solid ${palette.glow}`,
          opacity: ringOpacity,
          transform: `scale(${pulseScale * 1.12})`,
          transition: 'opacity 300ms ease',
          pointerEvents: 'none',
        }}
      />

      <div
        data-testid="avatar-orb"
        data-speaking={isSpeaking ? 'true' : 'false'}
        data-emotion={emotion}
        role="button"
        tabIndex={0}
        aria-label="Dr Hamza interactive avatar"
        aria-pressed={isSpeaking ? 'true' : 'false'}
        onClick={handleClick}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); handleClick(); }
        }}
        onMouseEnter={() => setIsHovering(true)}
        onMouseLeave={() => setIsHovering(false)}
        title="انقر للتفاعل مع الدكتور حمزة"
        style={{
          width: 90,
          height: 90,
          borderRadius: '50%',
          background: palette.bg,
          boxShadow: `0 0 ${isSpeaking ? 32 : 18}px ${palette.glow}`,
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          color: '#fff',
          fontWeight: 700,
          cursor: 'pointer',
          userSelect: 'none',
          transform: `scale(${orbScale})`,
          transition: 'background 400ms ease, box-shadow 400ms ease, transform 80ms ease',
          fontSize: 11,
          gap: 2,
          textAlign: 'center',
          lineHeight: 1.3,
        }}
      >
        <span style={{ fontSize: 22 }}>
          {isListening ? '🎧' : isSpeaking ? '🎙️' : '🧑‍🏫'}
        </span>
        <span>
          {isListening ? 'يستمع…' : isSpeaking ? 'يتحدث…' : (EMOTION_LABEL[emotion] ?? label)}
        </span>
      </div>
    </div>
  );
};

export default DrHamzaOrb;