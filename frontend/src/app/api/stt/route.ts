/**
 * STT (Speech-to-Text) — forwards audio to backend Whisper with OpenAI Whisper fallback.
 * POST with FormData { audio: File } → { transcript: string }
 */
import { NextRequest, NextResponse } from 'next/server';

const STT_TIMEOUT_MS = 30_000;

/** OpenAI Whisper fallback — used when backend is unavailable. */
async function openaiWhisperFallback(audio: Blob): Promise<string> {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) throw new Error('[STT] No OPENAI_API_KEY for fallback');
  const fd = new FormData();
  fd.append('file', audio, 'recording.wav');
  fd.append('model', 'whisper-1');
  fd.append('language', 'ar');
  const res = await fetch('https://api.openai.com/v1/audio/transcriptions', {
    method: 'POST',
    headers: { Authorization: `Bearer ${apiKey}` },
    body: fd,
  });
  if (!res.ok) throw new Error(`[STT] OpenAI Whisper HTTP ${res.status}`);
  const data = (await res.json()) as { text?: string };
  return data.text ?? '';
}

export async function POST(req: NextRequest) {
  let audioBlob: Blob | null = null;   // hoisted for fallback access in catch
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
    audioBlob = audio;   // save for outer-catch fallback

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
      console.warn('[STT] Backend failed, trying OpenAI fallback…', err?.detail);
      try {
        const transcript = await openaiWhisperFallback(audio);
        return NextResponse.json({ transcript, fallback: 'openai' });
      } catch (fbErr) {
        const fbMsg = fbErr instanceof Error ? fbErr.message : String(fbErr);
        return NextResponse.json({ error: fbMsg, transcript: '' }, { status: 502 });
      }
    }
    const data = await res.json();
    return NextResponse.json({ transcript: data?.transcript ?? '' });
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    const isTimeout = msg.includes('abort');
    // On timeout/network error → try OpenAI fallback too
    if (!isTimeout && audioBlob) {
      try {
        const transcript = await openaiWhisperFallback(audioBlob);
        return NextResponse.json({ transcript, fallback: 'openai' });
      } catch { /* fall through to error response */ }
    }
    return NextResponse.json(
      { error: isTimeout ? 'STT timeout' : 'STT error', transcript: '' },
      { status: isTimeout ? 408 : 500 }
    );
  }
}
