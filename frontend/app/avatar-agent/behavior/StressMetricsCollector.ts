/**
 * Aggregates per-tick stress samples into a single StressReport (diagnostic only).
 */

export type StressTickSample = {
  scenarioId: string;
  /** Simulated intent → gesture scheduling latency (ms). */
  timingIntentToGestureMs: number;
  /** Affect label from gated frame (for audit). */
  emotionLabel: string;
  emotionIntensityValue: number;
  coherence: number;
  partialDropGesture: boolean;
  partialDropMicro: boolean;
  partialDropSaccade: boolean;
  gazeEyeFocus: 'user' | 'away' | undefined;
  /** Proxy for speech / action onset delay (hesitation + base delay). */
  speechActionDelayMs: number;
};

export type StressReport = {
  scenarioCount: number;
  totalTicks: number;
  rejectedTicks: number;
  averageEmotionalContinuityScore: number;
  averageTimingStabilityScore: number;
  instabilitySpikeCount: number;
  frameCoherenceVariance: number;
  gestureDropRate: number;
  partialExecutionMicroDropRate: number;
  gazeConsistencyScore: number;
  speechDelayStabilityScore: number;
  /** Composite 0–1 */
  stabilityScore: number;
  realismScore: number;
  emotionalContinuityScore: number;
  timingCoherenceScore: number;
  perScenario: Array<{
    scenarioId: string;
    name: string;
    ticks: number;
    rejected: number;
    meanCoherence: number;
    gestureDropRate: number;
  }>;
};

function mean(xs: number[]): number {
  if (xs.length === 0) return 0;
  return xs.reduce((a, b) => a + b, 0) / xs.length;
}

function variance(xs: number[]): number {
  if (xs.length < 2) return 0;
  const m = mean(xs);
  return mean(xs.map((x) => (x - m) ** 2));
}

function stddev(xs: number[]): number {
  return Math.sqrt(variance(xs));
}

function clamp01(n: number): number {
  return Math.max(0, Math.min(1, n));
}

export class StressMetricsCollector {
  private samples: StressTickSample[] = [];
  private perScenarioSamples = new Map<string, StressTickSample[]>();
  private rejected = 0;
  private scenarioRejections = new Map<string, number>();

  addSample(scenarioId: string, sample: StressTickSample | null): void {
    if (!sample) {
      this.rejected += 1;
      this.scenarioRejections.set(scenarioId, (this.scenarioRejections.get(scenarioId) ?? 0) + 1);
      return;
    }
    this.samples.push(sample);
    const list = this.perScenarioSamples.get(scenarioId) ?? [];
    list.push(sample);
    this.perScenarioSamples.set(scenarioId, list);
  }

  finalize(scenarioMeta: ReadonlyArray<{ id: string; name: string }>): StressReport {
    const intensities = this.samples.map((s) => s.emotionIntensityValue);
    const intVar = variance(intensities);
    const emotionalContinuityScore = clamp01(1 / (1 + 14 * intVar));

    const delays = this.samples.map((s) => s.timingIntentToGestureMs);
    const delayMean = mean(delays);
    const delayStd = stddev(delays);
    const cv = delayMean > 1e-6 ? delayStd / delayMean : 0;
    const timingCoherenceScore = clamp01(1 / (1 + 4 * cv));

    const cohs = this.samples.map((s) => s.coherence);
    const coherenceVar = variance(cohs);
    let spikes = 0;
    for (let i = 1; i < cohs.length; i++) {
      if (Math.abs(cohs[i] - cohs[i - 1]) > 0.12) spikes += 1;
    }
    const instabilitySpikeCount = spikes;

    const n = this.samples.length || 1;
    const gestureDropRate =
      this.samples.filter((s) => s.partialDropGesture).length / n;
    const partialExecutionMicroDropRate =
      this.samples.filter((s) => s.partialDropMicro).length / n;

    const focuses = this.samples.map((s) => s.gazeEyeFocus);
    let gazeConsistencyScore = 1;
    if (focuses.length > 0) {
      let bestCount = 0;
      for (let i = 0; i < focuses.length; i++) {
        const key = focuses[i] ?? '__none__';
        const c = focuses.filter((x) => (x ?? '__none__') === key).length;
        if (c > bestCount) bestCount = c;
      }
      gazeConsistencyScore = bestCount / focuses.length;
    }

    const speechDelays = this.samples.map((s) => s.speechActionDelayMs);
    const speechStd = stddev(speechDelays);
    const speechDelayStabilityScore = clamp01(1 / (1 + 0.012 * speechStd));

    const meanCoherence = mean(cohs);
    const spikeNorm = clamp01(spikes / Math.max(8, this.samples.length * 0.35));
    const stabilityScore = clamp01(
      meanCoherence * (1 - spikeNorm * 0.55) * (0.5 + 0.5 * timingCoherenceScore),
    );

    const realismScore = clamp01(
      0.28 * emotionalContinuityScore +
        0.24 * timingCoherenceScore +
        0.22 * gazeConsistencyScore +
        0.16 * speechDelayStabilityScore +
        0.1 * (1 - Math.min(1, gestureDropRate * 2.2)),
    );

    const perScenario = scenarioMeta.map(({ id, name }) => {
      const ss = this.perScenarioSamples.get(id) ?? [];
      const rej = this.scenarioRejections.get(id) ?? 0;
      return {
        scenarioId: id,
        name,
        ticks: ss.length,
        rejected: rej,
        meanCoherence: mean(ss.map((x) => x.coherence)),
        gestureDropRate:
          ss.length === 0 ? 0 : ss.filter((x) => x.partialDropGesture).length / ss.length,
      };
    });

    return {
      scenarioCount: scenarioMeta.length,
      totalTicks: this.samples.length,
      rejectedTicks: this.rejected,
      averageEmotionalContinuityScore: emotionalContinuityScore,
      averageTimingStabilityScore: timingCoherenceScore,
      instabilitySpikeCount,
      frameCoherenceVariance: coherenceVar,
      gestureDropRate,
      partialExecutionMicroDropRate,
      gazeConsistencyScore,
      speechDelayStabilityScore,
      stabilityScore,
      realismScore,
      emotionalContinuityScore,
      timingCoherenceScore,
      perScenario,
    };
  }
}
