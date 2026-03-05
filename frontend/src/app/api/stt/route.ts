/**
 * STT (Speech-to-Text) — forwards audio to backend Whisper.
 * POST with FormData { audio: File } → { transcript: string }
 */
import { NextRequest, NextResponse } from 'next/server';

const STT_TIMEOUT_MS = 30_000;

export async function POST(req: NextRequest) {
  try {
    const formData = await req.formData();
    const audio = formData.get('audio');
    if (!audio || !(audio instanceof Blob)) {
      return NextResponse.json(
        { error: 'Missing or invalid audio file. Send FormData with "audio" field.' },
        { status: 400 }
      );
    }
    if (audio.size < 100) {
      return NextResponse.json({ error: 'Audio too short' }, { status: 400 });
    }

    const base = process.env.NEXT_PUBLIC_API_URL || 'http://127.0.0.1:8000';
    const upstream = `${base.replace(/\/$/, '')}/api/v1/stt`;

    const fd = new FormData();
    fd.append('audio', audio, 'recording.wav');

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), STT_TIMEOUT_MS);
    const res = await fetch(upstream, {
      method: 'POST',
      body: fd,
      signal: controller.signal,
    });
    clearTimeout(timeoutId);

    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      return NextResponse.json(
        { error: err?.detail || 'STT failed', transcript: '' },
        { status: res.status }
      );
    }
    const data = await res.json();
    return NextResponse.json({ transcript: data?.transcript ?? '' });
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    const isTimeout = msg.includes('abort');
    return NextResponse.json(
      { error: isTimeout ? 'STT timeout' : 'STT error', transcript: '' },
      { status: isTimeout ? 408 : 500 }
    );
  }
}
