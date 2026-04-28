/**
 * EmotionalMemoryManager.ts — Phase 4 Emotional Trajectory & Long-Term Memory
 *
 * Operates on **`useBrainStore.emotionalMemory`** and **`useBrainStore.longTermMemory`** only.
 * It does **not** use {@link BehaviorMemory} (`app/avatar-agent/behavior/BehaviorMemory.ts`) —
 * that class is a separate ~8s motion anti-repeat buffer inside BehaviorBrainHost.
 *
 * Provides a high-level API on top of the BrainStore memory primitives:
 *
 *   • recordMoment()            — snapshot the current PAD + mood, auto-promote
 *                                 significant moments to long-term memory
 *   • getTrajectory()           — analyse the last N entries; return trend + stats
 *   • queryRelevantMemories()    — retrieve past entries that match a topic string
 *   • getRelatedInterests()     — filter user interests by keyword overlap
 *   • getContextSummary()       — one-liner for prepending to LLM prompts
 *
 * This is a pure service module — no React hooks, no JSX.
 * It reads from and writes to useBrainStore.getState() directly.
 *
 * Usage:
 *   import { emotionalMemoryManager } from '@/ai/avatar/EmotionalMemoryManager';
 *   emotionalMemoryManager.recordMoment('happy', 'PESTLE analysis');
 *   const traj = emotionalMemoryManager.getTrajectory();
 */

import type {
  EmotionalMemoryEntry,
  EmotionLabel,
  PADVector,
} from '@/types/ai';
import { useBrainStore } from '@/store/useBrainStore';
import {
  getAdaptationHints,
  getCompactSummaryForPrompt,
} from '@/lib/avatar/emotionalMemory';
import { getLastSessionContext } from '@/lib/brainPersistence';
import { getPersonalityEvolutionSummary } from '@/lib/avatar/personalityEvolution';

// ─── Configuration ────────────────────────────────────────────────────────────

/** Number of recent emotional memory entries used for trajectory analysis */
const TRAJECTORY_WINDOW = 12;

/**
 * PAD intensity threshold above which a moment is automatically promoted to
 * long-term memory (importantMoments).
 * intensity = normalised PAD vector magnitude, range [0, 1].
 */
const SIGNIFICANCE_THRESHOLD = 0.52;

/** Minimum milliseconds between consecutive long-term promotions. */
const LTM_COOLDOWN_MS = 60_000; // 1 minute

// Module-level cooldown reference (shared across all manager instances)
let _lastLTMPromotion = 0;

// ─── Trajectory types ─────────────────────────────────────────────────────────

/**
 * Classification of the emotional trend derived from recent memory entries.
 *
 *  rising_positive  — pleasure axis is improving over the window
 *  falling_negative — pleasure is declining (concern / sadness building)
 *  volatile         — high variance; mood swings without clear direction
 *  stable_positive  — steadily favourable emotional state
 *  stable_neutral   — low intensity; no strong positive or negative signal
 *  stable_negative  — consistently unfavourable emotional state
 */
export type EmotionalTrend =
  | 'rising_positive'
  | 'falling_negative'
  | 'volatile'
  | 'stable_positive'
  | 'stable_neutral'
  | 'stable_negative';

export interface EmotionalTrajectory {
  /** Broad classification of the emotional movement */
  trend: EmotionalTrend;
  /** Average pleasure value across the analysis window (−1..1) */
  avgPleasure: number;
  /** Average arousal value across the analysis window (−1..1) */
  avgArousal: number;
  /**
   * Standard deviation of pleasure across the window (0 = perfectly stable).
   * > 0.4 is flagged as volatile.
   */
  variance: number;
  /** Emotion label that appeared most often in the window */
  dominantEmotion: EmotionLabel;
  /** Number of memory entries analysed */
  sampleCount: number;
}

// ─── Keyword helpers ──────────────────────────────────────────────────────────

// Common stop words (Arabic + English) that carry no topical meaning
const STOP_WORDS = new Set([
  // Arabic
  'في', 'من', 'إلى', 'على', 'عن', 'مع', 'هذا', 'هذه', 'تلك', 'ذلك',
  'أن', 'أو', 'و', 'ثم', 'لكن', 'قد', 'كان', 'كانت', 'يكون',
  // English
  'the', 'a', 'an', 'of', 'in', 'and', 'to', 'is', 'it', 'for',
  'on', 'at', 'by', 'with', 'this', 'that', 'are', 'was',
]);

/**
 * Cheap keyword extractor for Arabic and English topic strings.
 * Strips diacritics, lowercases, removes stop-words and very short tokens.
 */
function extractKeywords(text: string): string[] {
  return text
    .replace(/[\u064B-\u065F\u0670]/g, '') // strip Arabic diacritics
    .split(/[\s.,،؟؛?!:;()\[\]]+/u)
    .map(w => w.toLowerCase().trim())
    .filter(w => w.length >= 3 && !STOP_WORDS.has(w))
    .slice(0, 10);
}

// ─── EmotionalMemoryManager ───────────────────────────────────────────────────

export class EmotionalMemoryManager {
  private readonly _window: number;

  constructor(trajectoryWindow = TRAJECTORY_WINDOW) {
    this._window = trajectoryWindow;
    console.log(
      `[EmotionalMemory] Initialised — trajectory window: ${trajectoryWindow} entries`,
    );
  }

  // ── Recording ───────────────────────────────────────────────────────────────

  /**
   * Snapshot the current PAD state as an emotional memory entry.
   *
   * Automatically promotes to long-term importantMoments when:
   *   1. The PAD intensity exceeds SIGNIFICANCE_THRESHOLD
   *   2. The LTM cooldown has elapsed since the last promotion
   *
   * Also calls learnInterest() so the BrainStore builds the user's interest
   * profile over time.
   *
   * @param userMood — the mood label attributed to the user in this moment
   * @param topic    — optional topic string (used for interest tracking + query)
   */
  recordMoment(userMood: EmotionLabel, topic?: string): void {
    const store    = useBrainStore.getState();
    const { pad, emotionLabel } = store;

    // Delegate to BrainStore's own memory recorder
    store.recordEmotionalMoment(userMood, topic);

    const intensity = this._padIntensity(pad);
    console.log(
      `[EmotionalMemory] recordMoment — userMood:${userMood}` +
      ` avatarEmotion:${emotionLabel} intensity:${intensity.toFixed(3)}` +
      (topic ? ` topic:"${topic.slice(0, 40)}"` : ''),
    );

    // ── Automatic LTM promotion ──────────────────────────────────────────────
    const now = Date.now();
    if (
      intensity >= SIGNIFICANCE_THRESHOLD &&
      now - _lastLTMPromotion >= LTM_COOLDOWN_MS
    ) {
      _lastLTMPromotion = now;
      const description =
        `[${emotionLabel}] ${
          topic ? `during "${topic.slice(0, 50)}"` : 'significant emotional moment'
        } (intensity=${intensity.toFixed(2)})`;
      store.addImportantMoment(description);
      console.log(`[EmotionalMemory] → Promoted to LTM: "${description}"`);
    }

    // ── Interest learning ────────────────────────────────────────────────────
    if (topic) {
      extractKeywords(topic).forEach(kw => store.learnInterest(kw));
    }
  }

  // ── Trajectory analysis ─────────────────────────────────────────────────────

  /**
   * Analyse the last N emotional memory entries in the BrainStore and return
   * a trajectory summary.
   *
   * Returns 'stable_neutral' when fewer than 2 entries are available.
   */
  getTrajectory(): EmotionalTrajectory {
    const entries = useBrainStore
      .getState()
      .emotionalMemory
      .slice(-this._window);

    if (entries.length < 2) {
      console.log('[EmotionalMemory] getTrajectory — insufficient data, returning stable_neutral');
      return {
        trend:           'stable_neutral',
        avgPleasure:     0,
        avgArousal:      0,
        variance:        0,
        dominantEmotion: 'neutral',
        sampleCount:     entries.length,
      };
    }

    const pleasures = entries.map(e => e.avatarPAD.pleasure);
    const arousals  = entries.map(e => e.avatarPAD.arousal);

    const avgPleasure = pleasures.reduce((a, b) => a + b, 0) / entries.length;
    const avgArousal  = arousals.reduce((a, b) => a + b, 0) / entries.length;

    // Variance (standard deviation of pleasure — the primary valence axis)
    const variance = Math.sqrt(
      pleasures.reduce((acc, p) => acc + (p - avgPleasure) ** 2, 0) / entries.length,
    );

    // Trend: compare mean pleasure of first half vs second half of the window
    const mid        = Math.floor(entries.length / 2);
    const firstHalf  = pleasures.slice(0, mid);
    const secondHalf = pleasures.slice(mid);
    const avgFirst   = firstHalf.reduce((a, b) => a + b, 0)  / firstHalf.length;
    const avgSecond  = secondHalf.reduce((a, b) => a + b, 0) / secondHalf.length;
    const trend      = this._classifyTrend(avgFirst, avgSecond, avgPleasure, variance);

    // Dominant emotion: most frequent label in the window
    const counts: Record<string, number> = {};
    for (const e of entries) {
      counts[e.userMood] = (counts[e.userMood] ?? 0) + 1;
    }
    const dominantEmotion = Object.entries(counts)
      .sort((a, b) => b[1] - a[1])[0][0] as EmotionLabel;

    const trajectory: EmotionalTrajectory = {
      trend,
      avgPleasure,
      avgArousal,
      variance,
      dominantEmotion,
      sampleCount: entries.length,
    };

    console.log('[EmotionalMemory] Trajectory:', JSON.stringify(trajectory));
    return trajectory;
  }

  // ── Context-aware memory queries ────────────────────────────────────────────

  /**
   * Find the most relevant past emotional memory entries for a given topic.
   *
   * Scoring: keyword overlap (60 %) + emotional intensity (40 %).
   * Returns entries sorted by score descending, limited to `limit`.
   *
   * @param topic — free-text topic string (Arabic or English)
   * @param limit — number of results to return (default 5)
   */
  queryRelevantMemories(topic: string, limit = 5): EmotionalMemoryEntry[] {
    const { emotionalMemory } = useBrainStore.getState();
    if (emotionalMemory.length === 0) return [];

    const queryKws = new Set(extractKeywords(topic));

    const scored = emotionalMemory
      .filter(e => e.topic)
      .map(e => {
        const entryKws = extractKeywords(e.topic!);
        const overlap  = entryKws.filter(k => queryKws.has(k)).length;
        // Normalise overlap score by the larger keyword-set size
        const overlapScore = overlap / Math.max(1, Math.max(queryKws.size, entryKws.length));
        const score        = overlapScore * 0.60 + e.intensity * 0.40;
        return { entry: e, score };
      })
      .filter(x => x.score > 0.05)
      .sort((a, b) => b.score - a.score)
      .slice(0, limit)
      .map(x => x.entry);

    console.log(
      `[EmotionalMemory] queryRelevantMemories("${topic.slice(0, 30)}") → ${scored.length}/${limit} results`,
    );
    return scored;
  }

  /**
   * Return known user interests that are topically related to `topic`.
   * Uses keyword overlap; returns an empty array when the user has no interests.
   */
  getRelatedInterests(topic: string): string[] {
    const { userInterests } = useBrainStore.getState().longTermMemory;
    if (userInterests.length === 0) return [];

    const queryKws    = new Set(extractKeywords(topic));
    const related     = userInterests.filter(interest => {
      const interestKws = extractKeywords(interest);
      return interestKws.some(k => queryKws.has(k));
    });

    console.log(
      `[EmotionalMemory] getRelatedInterests("${topic.slice(0, 30)}") → [${related.join(', ')}]`,
    );
    return related;
  }

  // ── LLM context generation ──────────────────────────────────────────────────

  /**
   * Build a compact emotional context string suitable for prepending to LLM
   * system prompts, biasing the model toward empathetic, contextually-aware
   * responses.
   *
   * Format (pipe-separated):
   *   "Current emotion: happy | Trajectory: rising_positive (avg_p=0.42) |
   *    User interests: BTEC, PESTLE | Last significant moment: ..."
   */
  getContextSummary(): string {
    const state      = useBrainStore.getState();
    const trajectory = this.getTrajectory();
    const { emotionLabel, longTermMemory } = state;

    const lines: string[] = [
      `Current emotion: ${emotionLabel}`,
      `Trajectory: ${trajectory.trend} (avg_pleasure=${trajectory.avgPleasure.toFixed(2)}, variance=${trajectory.variance.toFixed(2)})`,
    ];

    if (longTermMemory.userInterests.length > 0) {
      lines.push(`User interests: ${longTermMemory.userInterests.slice(0, 6).join(', ')}`);
    }

    if (longTermMemory.importantMoments.length > 0) {
      const last = longTermMemory.importantMoments[longTermMemory.importantMoments.length - 1];
      lines.push(`Last significant moment: ${last.description}`);
    }

    const dominant = trajectory.dominantEmotion;
    if (dominant !== emotionLabel) {
      lines.push(`Dominant recent emotion: ${dominant} (${trajectory.sampleCount} samples)`);
    }

    const persist = getCompactSummaryForPrompt();
    const hints = getAdaptationHints();
    lines.push(`Persistent: ${persist}`);
    lines.push(getPersonalityEvolutionSummary());
    if (hints.recallHintAr) {
      lines.push(`Recall hint (optional): ${hints.recallHintAr}`);
    }

    const persisted = getLastSessionContext();
    if (persisted?.lastTopic?.trim()) {
      lines.push(
        `BrainPersist last_topic: ${persisted.lastTopic.trim().slice(0, 200)}`,
      );
      lines.push(
        `BrainPersist last_mood: ${String(persisted.lastMood ?? 'neutral').slice(0, 64)} | last_seen: ${persisted.lastSeen}`,
      );
    }

    const summary = lines.join(' | ');
    console.log('[EmotionalMemory] Context summary:', summary);
    return summary;
  }

  // ── Trajectory helpers ──────────────────────────────────────────────────────

  /**
   * Return true when the emotional trajectory indicates a shift to concern —
   * useful for triggering proactive empathetic responses.
   */
  isConcerningTrend(): boolean {
    const t = this.getTrajectory();
    return t.trend === 'falling_negative' || t.trend === 'stable_negative';
  }

  /**
   * Return true when the emotional trajectory is very volatile —
   * avatar should adopt a stabilising, calm communication style.
   */
  isVolatile(): boolean {
    return this.getTrajectory().trend === 'volatile';
  }

  /**
   * Long-term traits for BehaviorRulesEngine + AgentDirector:
   * technical interests → slightly faster delivery + pointing bias;
   * warm/friendly trajectory → higher chance of playful gestures.
   */
  getPersonalityAdaptation(): {
    voiceRateMultiplier: number;
    preferPointingGestures: boolean;
    playfulGestureChance: number;
    /** Long-term emotional memory: clarity / warmth (0..1) */
    persistentClarityBias: number;
    persistentWarmthBias: number;
  } {
    const { longTermMemory } = useBrainStore.getState();
    const blob = longTermMemory.userInterests.join(' ').toLowerCase();
    const techHints =
      /btec|pestle|swot|technical|كود|برمج|حساب|math|science|algorithm|data|تحليل|إحصاء/i;
    let voiceRateMultiplier = 1.0;
    let preferPointingGestures = false;
    if (techHints.test(blob)) {
      voiceRateMultiplier = 1.05;
      preferPointingGestures = true;
    }

    const lt = getAdaptationHints();
    voiceRateMultiplier *= lt.voiceRateMul;

    const traj = this.getTrajectory();
    let playfulGestureChance = 0.12;
    if (
      (traj.dominantEmotion === 'encouraging' || traj.dominantEmotion === 'excited') &&
      traj.avgPleasure > 0.12
    ) {
      playfulGestureChance = 0.28;
    }
    if (traj.trend === 'rising_positive') {
      playfulGestureChance = Math.min(0.35, playfulGestureChance + 0.08);
    }

    playfulGestureChance = Math.min(
      0.38,
      playfulGestureChance + lt.warmthBias * 0.06,
    );

    return {
      voiceRateMultiplier,
      preferPointingGestures,
      playfulGestureChance,
      persistentClarityBias: lt.clarityBias,
      persistentWarmthBias: lt.warmthBias,
    };
  }

  // ── Private utilities ────────────────────────────────────────────────────────

  /** Normalised magnitude of a PAD vector [0, 1]. 1 = maximum emotional state. */
  private _padIntensity(pad: PADVector): number {
    const magnitude = Math.sqrt(
      pad.pleasure ** 2 + pad.arousal ** 2 + pad.dominance ** 2,
    );
    return Math.min(1, magnitude / Math.sqrt(3));
  }

  private _classifyTrend(
    avgFirst:  number,
    avgSecond: number,
    overall:   number,
    variance:  number,
  ): EmotionalTrend {
    if (variance > 0.40)               return 'volatile';
    const delta = avgSecond - avgFirst;
    if (delta >  0.15 && overall >  0) return 'rising_positive';
    if (delta < -0.15 && overall <  0) return 'falling_negative';
    if (overall >=  0.18)              return 'stable_positive';
    if (overall <= -0.18)              return 'stable_negative';
    return 'stable_neutral';
  }
}

// ─── Singleton ────────────────────────────────────────────────────────────────

/**
 * Singleton instance.  Import and use directly without instantiation:
 *
 *   import { emotionalMemoryManager } from '@/ai/avatar/EmotionalMemoryManager';
 *   emotionalMemoryManager.recordMoment('happy', 'PESTLE analysis');
 */
export const emotionalMemoryManager = new EmotionalMemoryManager();
