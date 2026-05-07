import { NextResponse } from 'next/server';
import { mkdir, writeFile } from 'fs/promises';
import path from 'path';

/**
 * Persists predictive cognition bundle under frontend/logs/ (60s cycle).
 */
export async function POST(req: Request): Promise<NextResponse> {
  try {
    const body = (await req.json()) as Record<string, unknown>;

    const logsDir = path.join(process.cwd(), 'logs');
    await mkdir(logsDir, { recursive: true });

    const write = async (name: string, data: unknown): Promise<void> => {
      await writeFile(
        path.join(logsDir, name),
        `${JSON.stringify(data, null, 2)}\n`,
        'utf8',
      );
    };

    await write('cognitive_embodiment_report.json', body.cognitive_embodiment_report ?? {});
    await write('predictive_failure_analysis.json', body.predictive_failure_analysis ?? {});
    await write('human_perception_analysis.json', body.human_perception_analysis ?? {});
    await write('conversational_kinematics_report.json', body.conversational_kinematics_report ?? {});
    await write('skeletal_telemetry_report.json', body.skeletal_telemetry_report ?? {});
    await write('spatial_cognition_report.json', body.spatial_cognition_report ?? {});
    await write('self_healing_actions.json', body.self_healing_actions ?? {});
    await write('embodied_cognition_memory.json', body.embodied_cognition_memory ?? {});
    await write(
      'conversational_visibility_amplification.json',
      body.conversational_visibility_amplification ?? {},
    );
    await write('social_presence_analysis.json', body.social_presence_analysis ?? {});
    await write('gesture_projection_report.json', body.gesture_projection_report ?? {});
    await write('conversational_openness_report.json', body.conversational_openness_report ?? {});
    await write('torso_participation_report.json', body.torso_participation_report ?? {});

    return NextResponse.json({ ok: true });
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'write_failed';
    return NextResponse.json({ ok: false, error: msg }, { status: 500 });
  }
}
