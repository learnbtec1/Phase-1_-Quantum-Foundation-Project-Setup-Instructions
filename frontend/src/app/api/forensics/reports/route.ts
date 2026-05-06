import { NextResponse } from 'next/server';
import { mkdir, writeFile } from 'fs/promises';
import path from 'path';

import type { ActiveFailure } from '@/lib/forensics/types';
import type { EmbodimentIntelligenceReportPayload } from '@/lib/forensics/types';
import type { RootCauseGraphPayload } from '@/lib/forensics/types';

/**
 * Persists the 60s embodied nervous system bundle under frontend/logs/.
 */
export async function POST(req: Request): Promise<NextResponse> {
  try {
    const body = (await req.json()) as {
      intelligenceReport?: EmbodimentIntelligenceReportPayload;
      rootCauseGraph?: RootCauseGraphPayload;
      temporalChains?: Array<{ chainId: string; steps: string[]; confidence: number }>;
      activeFailures?: ActiveFailure[];
      summaryText?: string;
    };

    if (!body.intelligenceReport || !body.rootCauseGraph) {
      return NextResponse.json({ ok: false, error: 'invalid_body' }, { status: 400 });
    }

    const logsDir = path.join(process.cwd(), 'logs');
    await mkdir(logsDir, { recursive: true });

    const paths = {
      intelligence: path.join(logsDir, 'embodiment_intelligence_report.json'),
      summary: path.join(logsDir, 'embodiment_runtime_summary.txt'),
      graph: path.join(logsDir, 'root_cause_graph.json'),
      temporal: path.join(logsDir, 'temporal_behavior_chains.json'),
      failures: path.join(logsDir, 'active_embodiment_failures.json'),
    };

    await writeFile(
      paths.intelligence,
      `${JSON.stringify(body.intelligenceReport, null, 2)}\n`,
      'utf8',
    );
    await writeFile(paths.summary, body.summaryText ?? '', 'utf8');
    await writeFile(paths.graph, `${JSON.stringify(body.rootCauseGraph, null, 2)}\n`, 'utf8');
    await writeFile(
      paths.temporal,
      `${JSON.stringify(body.temporalChains ?? [], null, 2)}\n`,
      'utf8',
    );
    await writeFile(
      paths.failures,
      `${JSON.stringify(body.activeFailures ?? [], null, 2)}\n`,
      'utf8',
    );

    return NextResponse.json({ ok: true, paths });
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'write_failed';
    return NextResponse.json({ ok: false, error: msg }, { status: 500 });
  }
}
