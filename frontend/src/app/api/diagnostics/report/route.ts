import { NextResponse } from 'next/server';
import { writeFile } from 'fs/promises';
import path from 'path';

/**
 * Development-only sink for forensic JSON.
 * Client posts when `NEXT_PUBLIC_DIAGNOSTICS_SYNC_FILE=1` (throttled in reporter).
 */
export async function POST(req: Request): Promise<NextResponse> {
  if (process.env.NODE_ENV !== 'development') {
    return NextResponse.json({ ok: false, error: 'forbidden' }, { status: 403 });
  }
  try {
    const body = await req.json();
    const repoRoot = path.resolve(process.cwd(), '..');
    const target = path.join(repoRoot, 'project_diagnostics_report.json');
    await writeFile(target, `${JSON.stringify(body, null, 2)}\n`, 'utf8');
    return NextResponse.json({ ok: true, path: target });
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'write failed';
    return NextResponse.json({ ok: false, error: msg }, { status: 500 });
  }
}
