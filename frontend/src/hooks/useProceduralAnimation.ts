/**
 * useProceduralAnimation
 * ─────────────────────────────────────────────────────────────────────────────
 * Pure math/timing hook for VRM avatar humanization. Computes additive offsets
 * for breathing, random blinking, and micro-saccadic eye movement. Designed to
 * live outside the R3F Canvas component tree (zero Three.js imports) so it can
 * be tree-shaken when not needed and tested in a plain Node environment.
 *
 * Usage:
 *   const anim = useProceduralAnimation({ breatheHz: 0.22 });
 *
 *   // Inside useFrame:
 *   const { breatheY, blinkWeight, saccadeX, saccadeY } = anim.tick(delta);
 *   // Apply values to VRM bones / expression manager …
 *
 * Guarantee: ALL returned values are additive — add them on top of existing
 * bone rotations / blend-shape weights, never replace them.
 */
'use client';

import { useRef, useCallback } from 'react';

// ─────────────────────────────────────────────────────────────────────────────
// Public types
// ─────────────────────────────────────────────────────────────────────────────

export interface ProceduralAnimationOptions {
  /** Breathing frequency in Hz. Default 0.22 (~13 breaths/min — resting adult). */
  breatheHz?: number;
  /** Amplitude of the chest rise Y-offset (metres). Default 0.02. */
  breatheAmpY?: number;
  /** Secondary costal amplitude for spine expansion X-offset. Default 0.008. */
  breatheAmpX?: number;
  /** Minimum seconds between blinks. Default 2.2. */
  blinkMinSec?: number;
  /** Maximum seconds between blinks. Default 5.0. */
  blinkMaxSec?: number;
  /** Blink animation duration (ms). Default 160 (open→close→open). */
  blinkDurationMs?: number;
  /** Maximum micro-saccade displacement (metres, ±). Default 0.012. */
  saccadeAmp?: number;
  /** Target update interval for micro-saccades (seconds, randomised). Default 0.5. */
  saccadeUpdateHz?: number;
}

export interface ProceduralFrame {
  /** Additive Y-offset for chest/spine bone. Positive = rise. */
  breatheY: number;
  /** Additive X-rotation for spine (chest expansion, radians). */
  breatheX: number;
  /** Blink blend-shape weight [0 … 1]. Max at eye-close apex. */
  blinkWeight: number;
  /** True exactly on the frame the blink starts (useful for debug). */
  blinkStarted: boolean;
  /** Additive X-offset for look-at target (micro-saccade, metres). */
  saccadeX: number;
  /** Additive Y-offset for look-at target (micro-saccade, metres). */
  saccadeY: number;
}

// ─────────────────────────────────────────────────────────────────────────────
// Internal helpers
// ─────────────────────────────────────────────────────────────────────────────

function randBetween(lo: number, hi: number): number {
  return lo + Math.random() * (hi - lo);
}

/** Smooth ease: 0→1→0 over [0..1] — easeInOutSine */
function blinkCurve(t: number): number {
  return Math.sin(t * Math.PI);
}

// ─────────────────────────────────────────────────────────────────────────────
// Hook
// ─────────────────────────────────────────────────────────────────────────────

export function useProceduralAnimation({
  breatheHz       = 0.22,
  breatheAmpY     = 0.020,
  breatheAmpX     = 0.008,
  blinkMinSec     = 2.2,
  blinkMaxSec     = 5.0,
  blinkDurationMs = 160,
  saccadeAmp      = 0.012,
  saccadeUpdateHz = 0.5,
}: ProceduralAnimationOptions = {}) {

  // ── Breathing ──
  const breathePhaseRef = useRef(0); // radians, accumulated

  // ── Blink ──
  const blinkCountdownRef = useRef(randBetween(blinkMinSec, blinkMaxSec));
  const blinkProgressRef  = useRef(-1); // -1 = idle, 0..1 = animating
  const blinkWeightRef    = useRef(0);

  // ── Micro-saccades ──
  const saccadeXRef        = useRef(0);
  const saccadeYRef        = useRef(0);
  const saccadeTargetXRef  = useRef(0);
  const saccadeTargetYRef  = useRef(0);
  const saccadeCountdownRef = useRef(randBetween(0.3, 1 / saccadeUpdateHz));

  /**
   * Call once per frame (inside R3F useFrame or requestAnimationFrame).
   * Returns additive values ready to apply to VRM bones/expressions.
   */
  const tick = useCallback((delta: number): ProceduralFrame => {
    // ── Breathing ─────────────────────────────────────────────────────────
    breathePhaseRef.current += delta * breatheHz * 2 * Math.PI;
    // Two-frequency model for organic feel: primary + costal harmonic
    const primary = Math.sin(breathePhaseRef.current);
    const costal  = Math.sin(breathePhaseRef.current * 1.6 + 0.4) * 0.35;
    const breatheY = (primary + costal) * breatheAmpY * 0.5;
    const breatheX = primary * breatheAmpX;

    // ── Blink ──────────────────────────────────────────────────────────────
    let blinkWeight  = 0;
    let blinkStarted = false;

    blinkCountdownRef.current -= delta;
    if (blinkCountdownRef.current <= 0 && blinkProgressRef.current < 0) {
      // Start blink
      blinkProgressRef.current = 0;
      blinkStarted = true;
      // Schedule next blink
      blinkCountdownRef.current = randBetween(blinkMinSec, blinkMaxSec);
    }

    if (blinkProgressRef.current >= 0) {
      blinkProgressRef.current += delta / (blinkDurationMs / 1000);
      if (blinkProgressRef.current >= 1) {
        blinkProgressRef.current = -1; // blink finished
        blinkWeight = 0;
      } else {
        blinkWeight = blinkCurve(blinkProgressRef.current);
      }
    }

    blinkWeightRef.current = blinkWeight;

    // ── Micro-saccades ─────────────────────────────────────────────────────
    saccadeCountdownRef.current -= delta;
    if (saccadeCountdownRef.current <= 0) {
      // Pick a new random target within ±saccadeAmp
      saccadeTargetXRef.current  = randBetween(-saccadeAmp, saccadeAmp);
      saccadeTargetYRef.current  = randBetween(-saccadeAmp * 0.6, saccadeAmp * 0.6);
      saccadeCountdownRef.current = randBetween(0.25, 0.85);
    }

    // Smooth lerp toward target (fast saccade-like snap with velocity smoothing)
    const saccadeSpeed = delta * 14; // ~70 ms to 90 % of target
    saccadeXRef.current += (saccadeTargetXRef.current - saccadeXRef.current) * Math.min(1, saccadeSpeed);
    saccadeYRef.current += (saccadeTargetYRef.current - saccadeYRef.current) * Math.min(1, saccadeSpeed);

    return {
      breatheY,
      breatheX,
      blinkWeight,
      blinkStarted,
      saccadeX: saccadeXRef.current,
      saccadeY: saccadeYRef.current,
    };
  }, [breatheHz, breatheAmpY, breatheAmpX, blinkMinSec, blinkMaxSec, blinkDurationMs, saccadeAmp, saccadeUpdateHz]);

  /** Force an immediate blink (e.g. triggered by a startled emotion). */
  const triggerBlink = useCallback(() => {
    if (blinkProgressRef.current < 0) {
      blinkProgressRef.current = 0;
    }
  }, []);

  /** Reset breathing phase (e.g. on avatar load). */
  const resetBreathing = useCallback(() => {
    breathePhaseRef.current = 0;
  }, []);

  return { tick, triggerBlink, resetBreathing };
}
