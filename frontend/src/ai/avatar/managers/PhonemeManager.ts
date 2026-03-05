/**
 * PhonemeManager — derived from svelte-vrm-live (dexvdev/svelte-vrm-live)
 * Drives VRM lip-sync from phoneme/word timings produced by the TTS backend.
 *
 * Supports the full ARPAbet phoneme set with blended VRM expressions.
 * Falls back to procedural sine-wave mouth movement when no timings available.
 */
import { VRM, VRMExpressionPresetName } from '@pixiv/three-vrm';
import * as THREE from 'three';
import type { WordTiming } from '@/ai/io/tts';

// ── Types ─────────────────────────────────────────────────────────────────────

interface ExpressionWeight {
  expression: VRMExpressionPresetName;
  weight: number;
}

export interface PhonemeFrame {
  phoneme: string;
  start: number;   // seconds
  end: number;     // seconds
}

// ── Full phoneme → VRM expression mapping (from svelte-vrm-live) ──────────────

const phonemeToVRM: Record<string, ExpressionWeight[]> = {
  // Pure vowels
  A:  [{ expression: VRMExpressionPresetName.Aa, weight: 1.0 }],
  AA: [{ expression: VRMExpressionPresetName.Aa, weight: 1.0 }],
  AH: [{ expression: VRMExpressionPresetName.Aa, weight: 0.8 }],

  // Blended vowels
  AE: [
    { expression: VRMExpressionPresetName.Aa, weight: 0.6 },
    { expression: VRMExpressionPresetName.Ee, weight: 0.4 },
  ],
  AO: [
    { expression: VRMExpressionPresetName.Aa, weight: 0.3 },
    { expression: VRMExpressionPresetName.Oh, weight: 0.7 },
  ],
  AW: [
    { expression: VRMExpressionPresetName.Aa, weight: 0.4 },
    { expression: VRMExpressionPresetName.Oh, weight: 0.6 },
  ],
  AY: [
    { expression: VRMExpressionPresetName.Aa, weight: 0.7 },
    { expression: VRMExpressionPresetName.Ih, weight: 0.3 },
  ],

  // E sounds
  E:  [{ expression: VRMExpressionPresetName.Ee, weight: 1.0 }],
  EH: [
    { expression: VRMExpressionPresetName.Ee, weight: 0.7 },
    { expression: VRMExpressionPresetName.Aa, weight: 0.3 },
  ],
  ER: [
    { expression: VRMExpressionPresetName.Ee, weight: 0.4 },
    { expression: VRMExpressionPresetName.Ih, weight: 0.6 },
  ],
  EY: [{ expression: VRMExpressionPresetName.Ee, weight: 1.0 }],

  // I sounds
  I:  [{ expression: VRMExpressionPresetName.Ih, weight: 1.0 }],
  IH: [{ expression: VRMExpressionPresetName.Ih, weight: 1.0 }],
  IY: [
    { expression: VRMExpressionPresetName.Ih, weight: 0.6 },
    { expression: VRMExpressionPresetName.Ee, weight: 0.4 },
  ],

  // O sounds
  O:  [{ expression: VRMExpressionPresetName.Oh, weight: 1.0 }],
  OH: [{ expression: VRMExpressionPresetName.Oh, weight: 1.0 }],
  OW: [{ expression: VRMExpressionPresetName.Oh, weight: 1.0 }],
  OY: [
    { expression: VRMExpressionPresetName.Oh, weight: 0.8 },
    { expression: VRMExpressionPresetName.Ih, weight: 0.2 },
  ],

  // U sounds
  U:  [{ expression: VRMExpressionPresetName.Ou, weight: 1.0 }],
  UH: [
    { expression: VRMExpressionPresetName.Ou, weight: 0.7 },
    { expression: VRMExpressionPresetName.Aa, weight: 0.3 },
  ],
  UW: [{ expression: VRMExpressionPresetName.Ou, weight: 1.0 }],

  // Consonants — slight mouth movements
  M:  [{ expression: VRMExpressionPresetName.Neutral, weight: 1.0 }],
  B:  [{ expression: VRMExpressionPresetName.Neutral, weight: 1.0 }],
  P:  [{ expression: VRMExpressionPresetName.Neutral, weight: 1.0 }],
  F:  [
    { expression: VRMExpressionPresetName.Neutral, weight: 0.8 },
    { expression: VRMExpressionPresetName.Ou,     weight: 0.2 },
  ],
  V:  [
    { expression: VRMExpressionPresetName.Neutral, weight: 0.8 },
    { expression: VRMExpressionPresetName.Ou,     weight: 0.2 },
  ],
  TH: [
    { expression: VRMExpressionPresetName.Neutral, weight: 0.7 },
    { expression: VRMExpressionPresetName.Aa,     weight: 0.3 },
  ],
  L:  [
    { expression: VRMExpressionPresetName.Neutral, weight: 0.8 },
    { expression: VRMExpressionPresetName.Ih,     weight: 0.2 },
  ],
  R:  [
    { expression: VRMExpressionPresetName.Neutral, weight: 0.6 },
    { expression: VRMExpressionPresetName.Ou,     weight: 0.4 },
  ],

  // Arabic phoneme approximations (maps Arabic chars to closest phoneme)
  // Used for Arabic text → phoneme fallback
  ا: [{ expression: VRMExpressionPresetName.Aa, weight: 0.9 }],
  ع: [{ expression: VRMExpressionPresetName.Aa, weight: 0.7 }],
  أ: [{ expression: VRMExpressionPresetName.Aa, weight: 0.9 }],
  و: [{ expression: VRMExpressionPresetName.Ou, weight: 0.9 }],
  ي: [{ expression: VRMExpressionPresetName.Ih, weight: 0.8 }],
  ه: [{ expression: VRMExpressionPresetName.Aa, weight: 0.5 }],
  م: [{ expression: VRMExpressionPresetName.Neutral, weight: 1.0 }],
  ب: [{ expression: VRMExpressionPresetName.Neutral, weight: 1.0 }],
  ن: [{ expression: VRMExpressionPresetName.Neutral, weight: 0.8 }],

  // Fallback
  NEUTRAL: [{ expression: VRMExpressionPresetName.Neutral, weight: 1.0 }],
};

// VRM mouth expression presets
// NOTE: Aa, Ih, Ou are already managed by the existing viseme system in VRMAvatar.tsx.
// PhonemeManager ONLY drives Ee and Oh (the NEW blendshapes missing from the base system).
const MOUTH_PRESETS: VRMExpressionPresetName[] = [
  VRMExpressionPresetName.Ee,
  VRMExpressionPresetName.Oh,
];

// ── PhonemeManager ────────────────────────────────────────────────────────────

export class PhonemeManager {
  private _vrm: VRM | null = null;
  private _phonemes: PhonemeFrame[] = [];
  private _playbackTime = 0;        // current TTS playback offset (seconds)
  private _isPlaying = false;
  private _intensity = 1.0;
  private _smoothing = 0.3;
  private _currentWeights: Map<VRMExpressionPresetName, number> = new Map();

  /** Procedural fallback state */
  private _proceduralActive = false;
  private _proceduralTime = 0;
  private _proceduralPhase = 0;

  constructor(vrm?: VRM) {
    if (vrm) this.setVRM(vrm);
    MOUTH_PRESETS.forEach(p => this._currentWeights.set(p, 0));
  }

  setVRM(vrm: VRM) {
    this._vrm = vrm;
    MOUTH_PRESETS.forEach(p => this._currentWeights.set(p, 0));
  }

  /**
   * Load phoneme timings from TTS word timings.
   * If timings already contain phoneme-level data, use them directly.
   * Otherwise builds approximate phonemes from word boundaries.
   */
  setTimings(timings: WordTiming[]) {
    this._phonemes = this._buildPhonemeFrames(timings);
    this._playbackTime = 0;
    this._isPlaying = true;
    this._proceduralActive = false;
  }

  /** Start procedural (fallback) lip sync — used when no timings available. */
  startProcedural() {
    this._proceduralActive = true;
    this._proceduralTime = 0;
    this._proceduralPhase = 0;
    this._isPlaying = false;
    this._phonemes = [];
  }

  /** Stop all mouth movement and reset to closed mouth. */
  stop() {
    this._isPlaying = false;
    this._proceduralActive = false;
    this._phonemes = [];
    this._resetMouth();
  }

  /**
   * Call every frame.
   * @param delta seconds
   * @param isTalking override to drive procedural mode
   */
  update(delta: number, isTalking = false) {
    if (!this._vrm?.expressionManager) return;

    if (this._isPlaying && this._phonemes.length > 0) {
      this._playbackTime += delta;
      this._updateFromTimings();
    } else if (this._proceduralActive || (isTalking && !this._isPlaying)) {
      this._proceduralTime += delta;
      this._updateProcedural(delta);
    } else if (!isTalking) {
      this._decayToClose(delta);
    }

    // Apply current weights to VRM
    this._applyWeightsToVRM();
  }

  // ── private ────────────────────────────────────────────────────────────────

  private _updateFromTimings() {
    const t = this._playbackTime;
    const active = this._phonemes.find(p => t >= p.start && t < p.end);

    const targetWeights = new Map<VRMExpressionPresetName, number>();
    MOUTH_PRESETS.forEach(p => targetWeights.set(p, 0));

    if (active) {
      const mapping = phonemeToVRM[active.phoneme.toUpperCase()] ?? phonemeToVRM['NEUTRAL'];
      const total = mapping.reduce((s, e) => s + e.weight, 0);
      const norm = total > 0 ? 1 / total : 1;
      mapping.forEach(({ expression, weight }) => {
        targetWeights.set(expression, weight * norm * this._intensity);
      });
    }

    // Smooth transition
    const alpha = 1 - Math.pow(this._smoothing, 1 / 60);
    MOUTH_PRESETS.forEach(p => {
      const cur = this._currentWeights.get(p) ?? 0;
      const tgt = targetWeights.get(p) ?? 0;
      this._currentWeights.set(p, cur + (tgt - cur) * alpha);
    });
  }

  private _updateProcedural(delta: number) {
    this._proceduralPhase += delta * 7; // ~7 syllables/second for natural speech
    const open = Math.max(0, Math.sin(this._proceduralPhase)) * 0.45 * this._intensity;
    MOUTH_PRESETS.forEach(p => this._currentWeights.set(p, 0));
    // Add slight Oh component for round vowels (the existing system handles Aa)
    this._currentWeights.set(VRMExpressionPresetName.Oh, open * 0.5);
    this._currentWeights.set(VRMExpressionPresetName.Ee, open * 0.3);
  }

  private _decayToClose(delta: number) {
    const decayRate = 8; // units/sec
    let anyActive = false;
    MOUTH_PRESETS.forEach(p => {
      const cur = this._currentWeights.get(p) ?? 0;
      if (cur > 0.001) {
        anyActive = true;
        this._currentWeights.set(p, Math.max(0, cur - decayRate * delta));
      } else {
        this._currentWeights.set(p, 0);
      }
    });
    if (!anyActive) {
      this._proceduralActive = false;
    }
  }

  private _applyWeightsToVRM() {
    const mgr = this._vrm!.expressionManager;
    if (!mgr) return;
    MOUTH_PRESETS.forEach(p => {
      mgr.setValue(p, this._currentWeights.get(p) ?? 0);
    });
  }

  private _resetMouth() {
    if (!this._vrm?.expressionManager) return;
    MOUTH_PRESETS.forEach(p => {
      this._currentWeights.set(p, 0);
      this._vrm!.expressionManager!.setValue(p, 0);
    });
  }

  /**
   * Build phoneme frames from word-level timings.
   * Distributes approximate phonemes over each word's duration.
   */
  private _buildPhonemeFrames(wordTimings: WordTiming[]): PhonemeFrame[] {
    const frames: PhonemeFrame[] = [];
    for (const wt of wordTimings) {
      const word = wt.word ?? '';
      const start: number = (wt as any).start_time ?? (wt as any).startTime ?? 0;
      const end: number = (wt as any).end_time ?? (wt as any).endTime ?? start + 0.3;
      const phonemes = this._wordToPhonemes(word);
      if (phonemes.length === 0) continue;
      const phonemeDuration = (end - start) / phonemes.length;
      phonemes.forEach((ph, i) => {
        frames.push({
          phoneme: ph,
          start: start + i * phonemeDuration,
          end: start + (i + 1) * phonemeDuration,
        });
      });
    }
    return frames;
  }

  /**
   * Very fast approximate word → phoneme conversion.
   * Handles Arabic and Latin text.
   */
  private _wordToPhonemes(word: string): string[] {
    const phonemes: string[] = [];
    // Arabic: map vowel letters directly
    if (/[\u0600-\u06FF]/.test(word)) {
      for (const ch of word) {
        if ('اأإآ'.includes(ch))      phonemes.push('AA');
        else if ('وؤ'.includes(ch))   phonemes.push('UW');
        else if ('يئى'.includes(ch))  phonemes.push('IY');
        else if ('ع'.includes(ch))    phonemes.push('AH');
        else if ('هح'.includes(ch))   phonemes.push('AH');
        else if ('مبنتد'.includes(ch)) phonemes.push('NEUTRAL');
        else phonemes.push('NEUTRAL');
      }
      return phonemes;
    }

    // Latin: simple vowel/consonant split
    const vowels = 'aeiouAEIOU';
    for (let i = 0; i < word.length; i++) {
      const c = word[i];
      if (vowels.includes(c)) {
        const upper = c.toUpperCase();
        phonemes.push(upper === 'A' ? 'AA' : upper === 'E' ? 'EH' : upper === 'I' ? 'IH' : upper === 'O' ? 'OH' : 'UH');
      } else if ('mbp'.includes(c.toLowerCase())) {
        phonemes.push('M');
      } else if ('fv'.includes(c.toLowerCase())) {
        phonemes.push('F');
      } else if ('lr'.includes(c.toLowerCase())) {
        phonemes.push('L');
      } else {
        phonemes.push('NEUTRAL');
      }
    }
    return phonemes.filter(Boolean);
  }

  dispose() {
    this._resetMouth();
    this._vrm = null;
  }
}
