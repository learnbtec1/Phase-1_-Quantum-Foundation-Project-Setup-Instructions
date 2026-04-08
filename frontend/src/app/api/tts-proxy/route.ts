/**
 * Legacy TTS proxy → backend POST /api/v1/tts-with-timing.
 * Requires Authorization: Bearer (validated by Python API).
 * HTTP status matches upstream on error (see @/lib/server/bffProxy); success → 200 with { ok, tts }.
 */
import { NextRequest, NextResponse } from 'next/server';
import { backendBaseUrl } from '@/lib/server/bffAuth';
import {
  extractUpstreamDetail,
  requireIncomingBearer,
  resolveUpstreamErrorStatus,
  truncateUpstreamDetail,
} from '@/lib/server/bffProxy';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

async function fetchWithTimeout(url: string, init: RequestInit, ms = 15_000) {
  const ctrl = new AbortController();
  const id = setTimeout(() => ctrl.abort(), ms);
  try {
    return await fetch(url, { ...init, signal: ctrl.signal });
  } finally {
    clearTimeout(id);
  }
}

export async function POST(req: NextRequest) {
  const bearer = requireIncomingBearer(req);
  if (!bearer.ok) return bearer.response;

  try {
    const body = await req.json().catch(() => ({}));
    const base = backendBaseUrl();
    const r = await fetchWithTimeout(
      `${base}/api/v1/tts-with-timing`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: bearer.authHeader,
        },
        body: JSON.stringify(body),
      },
      15_000,
    );

    const text = await r.text();
    if (!r.ok) {
      const detail = extractUpstreamDetail(text);
      const status = resolveUpstreamErrorStatus(r.status);
      return NextResponse.json(
        { ok: false, error: 'Upstream request failed', detail },
        { status, headers: { 'Cache-Control': 'no-store' } },
      );
    }

    try {
      const j = JSON.parse(text) as Record<string, unknown>;
      const audioUrl = (j.audio_url || j.audioUrl || null) as string | null;
      return NextResponse.json(
        {
          ok: true,
          tts: {
            provider: j.provider ?? 'azure',
            voice: j.voice ?? (body as { voice?: string })?.voice ?? null,
            format: j.format ?? 'wav',
            sampleRate: j.sample_rate ?? 24000,
            audioUrl,
            audioBase64: j.audio_base64 ?? null,
            visemes: Array.isArray(j.viseme_events)
              ? (j.viseme_events as unknown[]).length
              : undefined,
            viseme_events: j.viseme_events ?? [],
            word_timings: j.word_timings ?? [],
            timing_mode: j.timing_mode ?? 'native',
          },
        },
        { status: 200, headers: { 'Cache-Control': 'no-store' } },
      );
    } catch {
      return NextResponse.json(
        {
          ok: false,
          error: 'BAD_UPSTREAM_BODY',
          detail: truncateUpstreamDetail(text),
        },
        { status: 502, headers: { 'Cache-Control': 'no-store' } },
      );
    }
  } catch (err: unknown) {
    return NextResponse.json(
      {
        ok: false,
        error: 'PROXY_ERROR',
        detail: truncateUpstreamDetail(
          err instanceof Error ? err.message : String(err),
        ),
      },
      { status: 503, headers: { 'Cache-Control': 'no-store' } },
    );
  }
}
