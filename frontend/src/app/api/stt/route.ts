/**
 * STT (Speech-to-Text) — forwards audio to backend Whisper.
 * POST with FormData { audio: File } → { transcript: string }
 * Requires Authorization: Bearer (validated by Python API).
 */
import { NextRequest, NextResponse } from 'next/server';
import { backendBaseUrl } from '@/lib/server/bffAuth';
import {
  extractUpstreamDetail,
  requireIncomingBearer,
  resolveUpstreamErrorStatus,
} from '@/lib/server/bffProxy';

const STT_TIMEOUT_MS = 30_000;

export async function POST(req: NextRequest) {
  const bearer = requireIncomingBearer(req);
  if (!bearer.ok) return bearer.response;

  try {
    const formData = await req.formData();
    const audio = formData.get('audio');
    if (!audio || !(audio instanceof Blob)) {
      return NextResponse.json(
        { error: 'Missing or invalid audio file. Send FormData with "audio" field.' },
        { status: 400 },
      );
    }
    if (audio.size < 100) {
      return NextResponse.json({ error: 'Audio too short' }, { status: 400 });
    }

    const base = backendBaseUrl();
    const upstream = `${base}/api/v1/stt`;

    const fd = new FormData();
    fd.append('audio', audio, 'recording.wav');

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), STT_TIMEOUT_MS);
    const res = await fetch(upstream, {
      method: 'POST',
      headers: { Authorization: bearer.authHeader },
      body: fd,
      signal: controller.signal,
    });
    clearTimeout(timeoutId);

    if (!res.ok) {
      const text = await res.text().catch(() => '');
      const detail = extractUpstreamDetail(text);
      const status = resolveUpstreamErrorStatus(res.status);
      return NextResponse.json(
        { error: 'STT upstream failed', detail, transcript: '' },
        { status },
      );
    }
    const data = (await res.json().catch(() => null)) as {
      transcript?: string;
    } | null;
    return NextResponse.json({ transcript: data?.transcript ?? '' });
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    const isTimeout = msg.includes('abort');
    return NextResponse.json(
      { error: isTimeout ? 'STT timeout' : 'STT error', transcript: '' },
      { status: isTimeout ? 408 : 503 },
    );
  }
}
