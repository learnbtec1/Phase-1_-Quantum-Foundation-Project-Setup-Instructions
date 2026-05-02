export type AlertSeverity = 'INFO' | 'WARNING' | 'CRITICAL';

export type ObservabilityAlert = {
  id: string;
  severity: AlertSeverity;
  code: string;
  message: string;
  cause?: string;
  suggestedFix?: string;
  ts: number;
  meta?: Record<string, unknown>;
};

export type Insight = {
  id: string;
  title: string;
  severity: AlertSeverity;
  summary: string;
  cause: string;
  suggestedFix: string;
  ts: number;
};

export type ObservabilitySnapshot = {
  fps: number;
  frameTimeMs: number;
  frameSpike: boolean;
  heapUsedMb: number | null;
  heapTrend: 'stable' | 'rising' | 'unknown';
  rootDriftM: number;
  rootDriftWarn: boolean;
  lipDriftMs: number;
  lipDriftLevel: 'ok' | 'warning' | 'critical';
  motionSilentSec: number;
  motionFreezeSuspect: boolean;
  brainChurnPerSec: number;
  stateChurnWarn: boolean;
  gestureRepeatRatio: number;
  threeGeometries: number;
  threeTextures: number;
  activeInsights: Insight[];
  recentAlerts: ObservabilityAlert[];
  eventStreamLen: number;
};
