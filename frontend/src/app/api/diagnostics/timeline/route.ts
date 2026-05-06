import { NextResponse } from 'next/server';
import { mkdir, readdir, unlink, writeFile, stat } from 'fs/promises';
import path from 'path';

import type { RuntimeTimelineSnapshot } from '@/lib/diagnostics/diagnosticsTypes';

const PRUNE_MAX_AGE_MS = 22 * 60 * 1000;

async function pruneOldSnapshots(dir: string): Promise<void> {
  const now = Date.now();
  let names: string[];
  try {
    names = await readdir(dir);
  } catch {
    return;
  }
  await Promise.all(
    names.map(async (name) => {
      if (!name.endsWith('.json')) return;
      const fp = path.join(dir, name);
      try {
        const st = await stat(fp);
        if (!st.isFile()) return;
        if (now - st.mtimeMs > PRUNE_MAX_AGE_MS) await unlink(fp);
      } catch {
        /* ignore */
      }
    }),
  );
}

/**
 * Persists rolling timeline snapshots under frontend/logs/runtime_timelines/.
 * Each POST writes a new timestamped file (never overwrites).
 */
export async function POST(req: Request): Promise<NextResponse> {
  try {
    const body = (await req.json()) as { snapshot?: RuntimeTimelineSnapshot };
    const snapshot = body.snapshot;
    if (!snapshot || typeof snapshot.timestamp !== 'string') {
      return NextResponse.json({ ok: false, error: 'invalid_body' }, { status: 400 });
    }

    const timelinesDir = path.join(process.cwd(), 'logs', 'runtime_timelines');
    await mkdir(timelinesDir, { recursive: true });

    const safeTs = snapshot.timestamp.replace(/[:.]/g, '-');
    const filename = `${safeTs}.json`;
    const filePath = path.join(timelinesDir, filename);

    await writeFile(filePath, `${JSON.stringify(snapshot, null, 2)}\n`, 'utf8');

    void pruneOldSnapshots(timelinesDir);

    return NextResponse.json({ ok: true, path: filePath });
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'write_failed';
    return NextResponse.json({ ok: false, error: msg }, { status: 500 });
  }
}
