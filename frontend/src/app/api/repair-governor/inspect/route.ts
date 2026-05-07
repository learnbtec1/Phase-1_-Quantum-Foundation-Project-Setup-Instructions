import { NextResponse } from 'next/server';
import { readFile, readdir, stat } from 'fs/promises';
import path from 'path';

export type LogFileSnapshot = {
  name: string;
  mtimeMs: number;
  ageMs: number;
  inWindow: boolean;
  parseError: string | null;
  json: unknown | null;
};

const FIRST_PRIORITY = [
  'forensic_integrity_report.json',
  'embodiment_intelligence_report.json',
  'project_diagnostics_report.json',
  'active_embodiment_failures.json',
  'root_cause_graph.json',
  'temporal_behavior_chains.json',
] as const;

const SECOND_PRIORITY = [
  'predictive_failure_analysis.json',
  'conversational_kinematics_report.json',
  'spatial_cognition_report.json',
  'skeletal_telemetry_report.json',
  'human_perception_analysis.json',
  'cognitive_embodiment_report.json',
] as const;

async function resolveLogsDir(): Promise<string> {
  const candidates = [path.join(process.cwd(), 'logs'), path.join(process.cwd(), 'frontend', 'logs')];
  for (const p of candidates) {
    try {
      await stat(p);
      return p;
    } catch {
      /* try next */
    }
  }
  return path.join(process.cwd(), 'logs');
}

async function readLogSnapshot(
  logsDir: string,
  relPath: string,
  serverNowMs: number,
  windowMs: number,
): Promise<LogFileSnapshot> {
  const fp = path.join(logsDir, relPath);
  try {
    const st = await stat(fp);
    const mtimeMs = st.mtimeMs;
    const ageMs = Math.max(0, serverNowMs - mtimeMs);
    const raw = await readFile(fp, 'utf8');

    if (!relPath.endsWith('.json')) {
      return {
        name: relPath,
        mtimeMs,
        ageMs,
        inWindow: ageMs <= windowMs,
        parseError: null,
        json: raw.trim().slice(0, 8000),
      };
    }

    let json: unknown = null;
    let parseError: string | null = null;
    try {
      json = JSON.parse(raw) as unknown;
    } catch (e) {
      parseError = e instanceof Error ? e.message : 'parse_error';
    }

    return {
      name: relPath,
      mtimeMs,
      ageMs,
      inWindow: ageMs <= windowMs,
      parseError,
      json,
    };
  } catch {
    return {
      name: relPath,
      mtimeMs: 0,
      ageMs: Number.POSITIVE_INFINITY,
      inWindow: false,
      parseError: 'missing_or_unreadable',
      json: null,
    };
  }
}

/**
 * GET ?windowMinutes=5|4 — disk-backed forensic snapshots with mtime windowing.
 */
export async function GET(req: Request): Promise<NextResponse> {
  try {
    const { searchParams } = new URL(req.url);
    const windowMinutes = Math.max(0.5, Math.min(120, Number(searchParams.get('windowMinutes') ?? '5')));
    const windowMs = windowMinutes * 60 * 1000;
    const serverNowMs = Date.now();
    const logsDir = await resolveLogsDir();

    const files: Record<string, LogFileSnapshot> = {};
    for (const name of [...FIRST_PRIORITY, ...SECOND_PRIORITY]) {
      files[name] = await readLogSnapshot(logsDir, name, serverNowMs, windowMs);
    }

    let latestTimeline: LogFileSnapshot | null = null;
    try {
      const tlDir = path.join(logsDir, 'runtime_timelines');
      const ents = await readdir(tlDir);
      let best: string | null = null;
      let bestM = 0;
      for (const n of ents) {
        if (!n.endsWith('.json')) continue;
        const st = await stat(path.join(tlDir, n));
        if (st.mtimeMs >= bestM) {
          bestM = st.mtimeMs;
          best = n;
        }
      }
      if (best) {
        latestTimeline = await readLogSnapshot(logsDir, path.join('runtime_timelines', best), serverNowMs, windowMs);
      }
    } catch {
      latestTimeline = null;
    }

    const summaries: Record<string, LogFileSnapshot> = {};
    for (const n of ['embodiment_runtime_summary.txt', 'project_runtime_summary.txt']) {
      summaries[n] = await readLogSnapshot(logsDir, n, serverNowMs, windowMs);
    }

    return NextResponse.json({
      ok: true,
      logsDir,
      serverNowMs,
      windowMinutes,
      windowMs,
      files,
      latestTimeline,
      summaries,
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'inspect_failed';
    return NextResponse.json({ ok: false, error: msg }, { status: 500 });
  }
}
