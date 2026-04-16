/**
 * Secondary mouth-shape hints from cognitive state + emotion — blended under lip sync (30%).
 * Does not replace visemes; primary speech shapes stay at 70%.
 */
'use client';

export type MouthShape = { aa: number; ih: number; oh: number; ou: number; ee: number };

const ZERO: MouthShape = { aa: 0, ih: 0, oh: 0, ou: 0, ee: 0 };

/** States aligned with interaction intent + emotion (subtle, capped). */
export function getCognitiveMouthOverlay(params: {
  interactionIntent: string;
  emotion: string;
  emotionIntensity: number;
  /** 0–1 from co-speech emphasis events (decayed in LipSync). */
  speechEmphasis?: number;
}): MouthShape {
  const { interactionIntent, emotion, emotionIntensity, speechEmphasis = 0 } = params;
  const ei = Math.min(1, Math.max(0, emotionIntensity));
  const emBoost = Math.min(1, Math.max(0, speechEmphasis));
  const o: MouthShape = { ...ZERO };

  switch (interactionIntent) {
    case 'explaining':
      o.aa = 0.014;
      o.ee = 0.01;
      break;
    case 'emphasizing':
      o.aa = 0.022;
      o.ee = 0.018;
      o.ih = 0.008;
      break;
    case 'thinking':
      o.ih = 0.018;
      o.oh = 0.006;
      break;
    case 'listening':
      o.ih = 0.008;
      break;
    case 'idle':
    default:
      break;
  }

  const em = emotion.toLowerCase();
  if (em === 'happy' || em === 'friendly' || em === 'encouraging') {
    o.ee += 0.06 * ei;
    o.ih += 0.04 * ei;
  } else if (em === 'excited' || em === 'celebrate' || em === 'celebration') {
    o.aa += 0.055 * ei;
    o.ee += 0.05 * ei;
  } else if (em === 'serious' || em === 'strict') {
    o.ih += 0.035 * ei;
    o.ee *= 0.88;
  } else if (em === 'calm' || em === 'relax') {
    o.oh += 0.025 * ei;
    o.ee += 0.02 * ei;
  } else if (em === 'thinking') {
    o.ih += 0.055 * ei;
    o.aa += 0.02 * ei;
  } else if (em === 'surprised' || em === 'curious') {
    o.aa += 0.05 * ei;
    o.ih += 0.03 * ei;
  } else if (em === 'sad' || em === 'concerned') {
    o.ih += 0.02 * ei;
    o.oh += 0.04 * ei;
  }

  if (emBoost > 0.04) {
    o.ee += 0.07 * emBoost;
    o.aa += 0.045 * emBoost;
    o.ih += 0.025 * emBoost;
  }

  const cap = 0.22;
  o.aa = Math.min(cap, o.aa);
  o.ih = Math.min(cap, o.ih);
  o.oh = Math.min(cap, o.oh);
  o.ou = Math.min(cap, o.ou);
  o.ee = Math.min(cap, o.ee);
  return o;
}

export const VISEME_PRIMARY = 0.7;
export const EXPRESSION_MOUTH_SECONDARY = 0.3;

export function blendVisemeWithExpression(vis: MouthShape, expr: MouthShape): MouthShape {
  const p = VISEME_PRIMARY;
  const s = EXPRESSION_MOUTH_SECONDARY;
  return {
    aa: vis.aa * p + expr.aa * s,
    ih: vis.ih * p + expr.ih * s,
    oh: vis.oh * p + expr.oh * s,
    ou: vis.ou * p + expr.ou * s,
    ee: vis.ee * p + expr.ee * s,
  };
}
