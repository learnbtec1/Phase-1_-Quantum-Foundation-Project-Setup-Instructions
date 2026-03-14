import { NextResponse } from 'next/server';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function backend() {
  return process.env.BACKEND_URL?.trim() || 'http://127.0.0.1:8000';
}

async function fetchWithTimeout(url: string, init: RequestInit, ms = 15000) {
  const ctrl = new AbortController(); const id = setTimeout(() => ctrl.abort(), ms);
  try { return await fetch(url, { ...init, signal: ctrl.signal }); }
  finally { clearTimeout(id); }
}

export async function POST(req: Request) {
  try {
    const body = await req.json().catch(() => ({}));
    const r = await fetchWithTimeout(`${backend()}/api/v1/tts-with-timing`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    }, 15000);

    const text = await r.text();
    try {
      const j = JSON.parse(text);
      const audioUrl = j.audio_url || j.audioUrl || null;
      return NextResponse.json({
        ok: r.ok,
        tts: {
          provider: j.provider ?? 'azure',
          voice: j.voice ?? (body as any)?.voice ?? null,
          format: j.format ?? 'wav',
          sampleRate: j.sample_rate ?? 24000,
          audioUrl,
          audioBase64: j.audio_base64 ?? null,
          visemes: Array.isArray(j.viseme_events) ? j.viseme_events.length : undefined,
          viseme_events: j.viseme_events ?? [],
          word_timings: j.word_timings ?? [],
          timing_mode: j.timing_mode ?? 'native',
        },
      }, { status: 200, headers: { 'Cache-Control': 'no-store' }});
    } catch {
      return NextResponse.json({ ok:false, error:'BAD_UPSTREAM_BODY', details: text?.slice(0,400) }, { status:200 });
    }
  } catch (err:any) {
    return NextResponse.json({ ok:false, error:'PROXY_ERROR', details: err?.message || 'unknown' }, { status:200 });
  }
}
