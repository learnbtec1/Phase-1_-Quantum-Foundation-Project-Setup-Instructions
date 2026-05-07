'use client';

/**
 * Persistent autonomous repair governor — each cycle re-opens forensic logs from disk via
 * GET /api/repair-governor/inspect (mtime window). Loop #1 = 5 min; loops ≥2 = 4 min.
 * After optional surgical hook, performs a second disk read to verify (mission Steps 7–8).
 *
 * Enable with NEXT_PUBLIC_AUTONOMOUS_REPAIR_GOVERNOR=1
 */

import type { RepairGovernorFailureRef } from './repairGovernorDiskEvidence';
import {
  collectRepairGovernorFailuresFromDiskPayload,
  dominantVerifiedRootCauseActive,
  hasEmbodimentCollapseDiag,
  passesStrictRepairEvidence,
} from './repairGovernorDiskEvidence';

export type { RepairGovernorFailureRef };

export type AutonomousRepairLoopReport = {
  loopIndex: number;
  activeWindowMinutes: number;
  activeFailuresDetected: RepairGovernorFailureRef[];
  verifiedRootCauses: string[];
  patchedFiles: string[];
  patchedFunctions: string[];
  verifiedFixes: string[];
  remainingFailures: RepairGovernorFailureRef[];
  confidenceLevel: number;
  telemetryTrustworthiness: number;
  forensicIntegrityScore: number;
  continueLoop: boolean;
  stopReason: string;
};

const MIN_CONFIDENCE = 0.55;
const INTERVAL_MS_DEFAULT = 60_000;
const CLEAN_STREAK_TO_HALT = 1;
const INTEGRITY_STABLE_EPS = 6;

let _timer: ReturnType<typeof setInterval> | null = null;
let _loopIndex = 0;
let _prevIntegrity: number | null = null;
let _prevFailureIds = new Set<string>();
let _cleanStreak = 0;
let _lastReport: AutonomousRepairLoopReport | null = null;

export function getLastAutonomousRepairLoopReport(): AutonomousRepairLoopReport | null {
  return _lastReport;
}

function noAuthorityConflicts(proj: unknown): boolean {
  if (!proj || typeof proj !== 'object') return true;
  const auth = (proj as Record<string, unknown>).authorityConflicts;
  return !Array.isArray(auth) || auth.length === 0;
}

type InspectSnap = {
  ok: boolean;
  serverNowMs?: number;
  files?: Record<string, { inWindow: boolean; json: unknown | null; name?: string }>;
  latestTimeline?: { name: string; inWindow: boolean; json: unknown | null; mtimeMs?: number } | null;
};

async function fetchInspect(windowMinutes: number): Promise<InspectSnap> {
  try {
    const res = await fetch(`/api/repair-governor/inspect?windowMinutes=${windowMinutes}`, {
      cache: 'no-store',
    });
    return (await res.json()) as InspectSnap;
  } catch {
    return { ok: false };
  }
}

function analyzeMerged(
  merged: RepairGovernorFailureRef[],
  execJson: unknown,
  projInWindow: boolean,
  timelineInWindow: boolean,
  rootCauseGraphInWindow: boolean,
): {
  activeFailuresDetected: RepairGovernorFailureRef[];
  strictVerified: RepairGovernorFailureRef[];
} {
  const activeFailuresDetected = merged.filter((f) => f.confidence >= MIN_CONFIDENCE);
  const strictVerified = activeFailuresDetected.filter(
    (f) =>
      f.confidence >= MIN_CONFIDENCE &&
      passesStrictRepairEvidence(f, execJson, projInWindow, timelineInWindow, rootCauseGraphInWindow),
  );
  strictVerified.sort(repairGovernorFailureRankCmp);
  return { activeFailuresDetected, strictVerified };
}

/** STEP 4 — execution-chain / authority severity first, then confidence. */
function repairGovernorFailureRankCmp(a: RepairGovernorFailureRef, b: RepairGovernorFailureRef): number {
  const tier = (id: string): number => {
    if (id.startsWith('exec_chain_invalid:')) return 5;
    if (id.startsWith('project:authority')) return 4;
    if (id.startsWith('project:critical')) return 4;
    if (id.startsWith('correlation:') || id.startsWith('temporal_chain:')) return 3;
    if (id.startsWith('spatial:') || id.startsWith('bone_authority:')) return 3;
    if (id.startsWith('root_graph:')) return 2;
    if (id.startsWith('timeline:')) return 2;
    return 1;
  };
  const dt = tier(b.id) - tier(a.id);
  if (dt !== 0) return dt;
  return b.confidence - a.confidence;
}

export type StartRepairGovernorOptions = {
  intervalMs?: number;
};

export function startAutonomousRuntimeRepairGovernor(opts: StartRepairGovernorOptions = {}): void {
  if (typeof window === 'undefined') return;
  if (_timer != null) return;

  const intervalMs = opts.intervalMs ?? INTERVAL_MS_DEFAULT;
  _loopIndex = 0;
  _prevIntegrity = null;
  _prevFailureIds = new Set();
  _cleanStreak = 0;

  const tick = async (): Promise<void> => {
    _loopIndex += 1;
    const loopIndex = _loopIndex;
    const activeWindowMinutes = loopIndex === 1 ? 5 : 4;

    const snap = await fetchInspect(activeWindowMinutes);
    if (!snap.ok || !snap.files) {
      _lastReport = {
        loopIndex,
        activeWindowMinutes,
        activeFailuresDetected: [],
        verifiedRootCauses: [],
        patchedFiles: [],
        patchedFunctions: [],
        verifiedFixes: [],
        remainingFailures: [],
        confidenceLevel: 0,
        telemetryTrustworthiness: 0,
        forensicIntegrityScore: 0,
        continueLoop: true,
        stopReason: 'inspect_fetch_failed',
      };
      // eslint-disable-next-line no-console
      console.info('[AUTONOMOUS_RUNTIME_REPAIR_LOOP]\n' + JSON.stringify(_lastReport, null, 2));
      if (typeof window !== 'undefined') {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (window as any).__AUTONOMOUS_REPAIR_LOOP_LAST = _lastReport;
      }
      return;
    }

    const F = snap.files;
    const projInWindow = F['project_diagnostics_report.json']?.inWindow ?? false;
    const rootCauseGraphInWindow = F['root_cause_graph.json']?.inWindow ?? false;
    const timelineInWindow = snap.latestTimeline?.inWindow ?? false;
    const execJson = F['execution_chain_validation.json']?.json;

    const merged = collectRepairGovernorFailuresFromDiskPayload({
      files: F,
      latestTimeline: snap.latestTimeline ?? null,
      minConfidence: MIN_CONFIDENCE,
    });

    let { activeFailuresDetected, strictVerified } = analyzeMerged(
      merged,
      execJson,
      projInWindow,
      timelineInWindow,
      rootCauseGraphInWindow,
    );

    const forensic = F['forensic_integrity_report.json']?.json as Record<string, unknown> | undefined;
    const telemetryTrust = Number(forensic?.telemetryTrustworthiness ?? 0);
    const forensicIntegrityScore = Number(forensic?.forensicIntegrityScore ?? 0);

    const proj = F['project_diagnostics_report.json']?.json;

    const integrityStable =
      _prevIntegrity === null || Math.abs(forensicIntegrityScore - _prevIntegrity) <= INTEGRITY_STABLE_EPS;
    _prevIntegrity = forensicIntegrityScore;

    const collapseActive = hasEmbodimentCollapseDiag(proj, MIN_CONFIDENCE);

    const cond1 = strictVerified.length === 0;
    const cond2 = integrityStable;
    const cond3 = telemetryTrust >= 70;
    const cond4 = noAuthorityConflicts(proj);
    const cond5 = !collapseActive;
    const cond6 = !dominantVerifiedRootCauseActive(proj, forensic);

    const allStop = cond1 && cond2 && cond3 && cond4 && cond5 && cond6;

    if (allStop) _cleanStreak += 1;
    else _cleanStreak = 0;

    const currentIds = new Set(strictVerified.map((f) => f.id));
    const verifiedFixes = [..._prevFailureIds].filter((id) => !currentIds.has(id)).map((id) => `cleared:${id}`);
    _prevFailureIds = currentIds;

    const patchedFiles: string[] = [];
    const patchedFunctions: string[] = [];
    const hook =
      typeof window !== 'undefined'
        ? // eslint-disable-next-line @typescript-eslint/no-explicit-any
          (window as any).__AUTONOMOUS_REPAIR_EXECUTE as
          | ((d: { failure: RepairGovernorFailureRef; loopIndex: number }) => void)
          | undefined
        : undefined;

    const topFailure = strictVerified[0];
    const topFailureId = topFailure?.id ?? '';

    if (hook && topFailure) {
      try {
        hook({ failure: topFailure, loopIndex });
        patchedFunctions.push('__AUTONOMOUS_REPAIR_EXECUTE(hook)');
      } catch {
        /* hook owns errors */
      }

      const verifySnap = await fetchInspect(activeWindowMinutes);
      if (verifySnap.ok && verifySnap.files) {
        const mergedV = collectRepairGovernorFailuresFromDiskPayload({
          files: verifySnap.files,
          latestTimeline: verifySnap.latestTimeline ?? null,
          minConfidence: MIN_CONFIDENCE,
        });
        const projW = verifySnap.files['project_diagnostics_report.json']?.inWindow ?? false;
        const graphW = verifySnap.files['root_cause_graph.json']?.inWindow ?? false;
        const tlW = verifySnap.latestTimeline?.inWindow ?? false;
        const execV = verifySnap.files['execution_chain_validation.json']?.json;
        const { strictVerified: strictV } = analyzeMerged(mergedV, execV, projW, tlW, graphW);
        const stillThere = topFailureId.length > 0 && strictV.some((f) => f.id === topFailureId);
        verifiedFixes.push(
          stillThere ? 'disk_verify_post_patch:top_strict_failure_persistent' : 'disk_verify_post_patch:top_strict_failure_cleared',
        );
      } else {
        verifiedFixes.push('disk_verify_post_patch:inspect_reread_failed');
      }
    }

    const maxConf =
      strictVerified.length === 0 ? 0 : Math.max(...strictVerified.map((f) => f.confidence));

    let stopReason = '';
    if (allStop) {
      stopReason = [
        `no_strict_active_failures=${cond1}`,
        `integrity_stable=${cond2}`,
        `telemetryTrust>=70 (${telemetryTrust})=${cond3}`,
        `no_authority_conflicts=${cond4}`,
        `no_embodiment_collapse_chain>=${MIN_CONFIDENCE}=${cond5}`,
        `no_dominant_verified_root_cause=${cond6}`,
      ].join('; ');
    } else {
      stopReason = [
        !cond1 ? `strict_failures=${strictVerified.map((f) => f.id).join(',')}` : '',
        !cond2 ? 'integrity_unstable' : '',
        !cond3 ? `telemetryTrust=${telemetryTrust}<70` : '',
        !cond4 ? 'authority_conflicts_present' : '',
        !cond5 ? `embodiment_collapse_chain>=${MIN_CONFIDENCE}` : '',
        !cond6 ? 'dominant_verified_root_cause_present' : '',
      ]
        .filter(Boolean)
        .join('; ');
    }

    const continueLoop = !allStop || _cleanStreak < CLEAN_STREAK_TO_HALT;

    _lastReport = {
      loopIndex,
      activeWindowMinutes,
      activeFailuresDetected,
      verifiedRootCauses: strictVerified.map((f) => f.summary ?? f.id),
      patchedFiles,
      patchedFunctions,
      verifiedFixes,
      remainingFailures: strictVerified,
      confidenceLevel: Math.round(maxConf * 1000) / 10,
      telemetryTrustworthiness: telemetryTrust,
      forensicIntegrityScore,
      continueLoop,
      stopReason: allStop && _cleanStreak >= CLEAN_STREAK_TO_HALT ? `HALT:${stopReason}` : stopReason,
    };

    // eslint-disable-next-line no-console
    console.info('[AUTONOMOUS_RUNTIME_REPAIR_LOOP]\n' + JSON.stringify(_lastReport, null, 2));

    if (typeof window !== 'undefined') {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (window as any).__AUTONOMOUS_REPAIR_LOOP_LAST = _lastReport;
    }

    if (allStop && _cleanStreak >= CLEAN_STREAK_TO_HALT) {
      stopAutonomousRuntimeRepairGovernor();
    }
  };

  void tick();
  _timer = setInterval(() => {
    void tick();
  }, intervalMs);
}

export function stopAutonomousRuntimeRepairGovernor(): void {
  if (_timer != null) {
    clearInterval(_timer);
    _timer = null;
  }
}
