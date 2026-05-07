import { NextResponse } from 'next/server';
import { mkdir, writeFile } from 'fs/promises';
import path from 'path';

/**
 * Persists controlled embodiment verification artifacts under frontend/logs/.
 */
export async function POST(req: Request): Promise<NextResponse> {
  try {
    const body = (await req.json()) as Record<string, unknown>;

    const logsDir = path.join(process.cwd(), 'logs');
    await mkdir(logsDir, { recursive: true });

    const write = async (name: string, data: unknown): Promise<void> => {
      await writeFile(path.join(logsDir, name), `${JSON.stringify(data, null, 2)}\n`, 'utf8');
    };

    await write('controlled_embodiment_sequence_report.json', body.controlled_embodiment_sequence_report ?? {});
    await write('controlled_embodiment_checkpoints.json', body.controlled_embodiment_checkpoints ?? []);
    await write('controlled_embodiment_failures.json', body.controlled_embodiment_failures ?? []);
    await write('controlled_embodiment_spatial_analysis.json', body.controlled_embodiment_spatial_analysis ?? {});
    await write('controlled_embodiment_execution_trace.json', body.controlled_embodiment_execution_trace ?? []);

    return NextResponse.json({ ok: true });
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'write_failed';
    return NextResponse.json({ ok: false, error: msg }, { status: 500 });
  }
}
