import { NextResponse } from 'next/server';
import { mkdir, writeFile } from 'fs/promises';
import path from 'path';

import type { AutonomousDiagnosticsReport } from '@/lib/diagnostics/diagnosticsTypes';

/**
 * Persists the 60s autonomous analyzer output under frontend/logs/.
 * Best-effort: works with `next dev` ( cwd = frontend ).
 */
export async function POST(req: Request): Promise<NextResponse> {
  try {
    const body = (await req.json()) as {
      report?: AutonomousDiagnosticsReport;
      summaryText?: string;
    };
    const report = body.report;
    const summaryText = body.summaryText ?? '';
    if (!report || typeof summaryText !== 'string') {
      return NextResponse.json({ ok: false, error: 'invalid_body' }, { status: 400 });
    }

    const logsDir = path.join(process.cwd(), 'logs');
    await mkdir(logsDir, { recursive: true });

    const jsonPath = path.join(logsDir, 'project_diagnostics_report.json');
    const txtPath = path.join(logsDir, 'project_runtime_summary.txt');

    await writeFile(jsonPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
    await writeFile(txtPath, summaryText, 'utf8');

    return NextResponse.json({ ok: true, jsonPath, txtPath });
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'write_failed';
    return NextResponse.json({ ok: false, error: msg }, { status: 500 });
  }
}
