/**
 * TTS-with-timing bridge: forwards to backend POST /api/v1/tts-with-timing
 * Returns { audio_base64, word_timings, sample_rate } for lip-sync.
 * Requires Authorization: Bearer (validated by Python API).
 *
 * Upstream errors: forward 401/403/429/503 where applicable; other 5xx → 502; detail truncated (bffProxy).
 */
import { NextRequest, NextResponse } from 'next/server';
import { randomUUID } from 'node:crypto';
import { backendBaseUrl } from '@/lib/server/bffAuth';
import {
  extractUpstreamDetail,
  requireIncomingBearer,
  resolveUpstreamErrorStatus,
  truncateUpstreamDetail,
} from '@/lib/server/bffProxy';

/** Azure + chunking can exceed 20s; configurable via env (Next server-side only). */
function ttsProxyTimeoutMs(): number {
  const raw = process.env.TTS_PROXY_TIMEOUT_MS;
  const n = raw ? parseInt(raw, 10) : NaN;
  if (Number.isFinite(n) && n >= 15_000) return Math.min(n, 180_000);
  return 90_000;
}
const MAX_TEXT_LENGTH = 5000;

export async function POST(req: NextRequest) {
  const reqId = randomUUID();
  const traceHeaders: Record<string, string> = { 'X-Request-ID': reqId };

  const bearer = requireIncomingBearer(req);
  if (!bearer.ok) return bearer.response;

  try {
    const payload = await req.json().catch(() => ({}));
    let text = (payload?.text ?? '').toString().trim().slice(0, MAX_TEXT_LENGTH);
    if (!text) {
      return NextResponse.json(
        { error: 'Empty text', reqId },
        { status: 400, headers: traceHeaders },
      );
    }

    text = text
      .replace(/Cogni/gi, 'كُوجْنِي')
      .replace(/EDUVERSE/gi, 'إِيدُوفِيرْس');

    const base = backendBaseUrl();
    const upstream =
      process.env.TTS_BACKEND_URL ||
      `${base}/api/v1/tts-with-timing`;
    const defaultArabicVoice =
      process.env.TTS_ARABIC_VOICE?.trim() || 'ar-JO-TaimNeural';

    const controller = new AbortController();
    const timeoutMs = ttsProxyTimeoutMs();
    const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
    const mergeAbort = (AbortSignal as unknown as { any?: (s: AbortSignal[]) => AbortSignal })
      .any;
    const upstreamSignal =
      typeof mergeAbort === 'function'
        ? mergeAbort([controller.signal, req.signal])
        : controller.signal;

    let res: Response;
    try {
      res = await fetch(upstream, {
        method: 'POST',
        headers: {
          Authorization: bearer.authHeader,
          'Content-Type': 'application/json',
          'X-Request-ID': reqId,
        },
        body: JSON.stringify({
          text,
          voice: payload?.voice ?? defaultArabicVoice,
          speed: payload?.speed ?? 0.85,
          emotion: payload?.emotion ?? 'neutral',
          ...(payload?.pitch ? { pitch: payload.pitch } : {}),
          ar_voice: payload?.ar_voice ?? 'male',
        }),
        signal: upstreamSignal,
      });
    } catch (fetchErr) {
      clearTimeout(timeoutId);
      console.error(
        `[tts-route] ❌ Cannot reach backend TTS at ${upstream} (timeout=${timeoutMs}ms) —`,
        fetchErr,
      );
      return NextResponse.json(
        {
          error: 'Backend unreachable',
          detail: truncateUpstreamDetail(String(fetchErr)),
          reqId,
        },
        { status: 503, headers: traceHeaders },
      );
    }
    clearTimeout(timeoutId);

    if (!res.ok) {
      const msg = await res.text().catch(() => '');
      console.error(
        `[tts-route] ❌ Backend returned HTTP ${res.status} from ${upstream}:`,
        msg.slice(0, 500),
      );
      const detail = extractUpstreamDetail(msg);
      let upstreamCode: string | undefined;
      try {
        const j = JSON.parse(msg) as { code?: string };
        upstreamCode = typeof j?.code === 'string' ? j.code : undefined;
      } catch {
        /* plain */
      }
      const hourlyQuota =
        res.status === 429 ||
        upstreamCode === 'tts_rate_limit' ||
        /hourly limit exceeded|TTS hourly limit/i.test(detail) ||
        /hourly limit exceeded/i.test(msg);
      if (hourlyQuota) {
        return NextResponse.json(
          {
            error: 'TTS hourly limit exceeded',
            detail,
            code: 'tts_hourly_limit',
            reqId,
          },
          { status: 429, headers: traceHeaders },
        );
      }
      if (res.status === 503) {
        const rateLimited =
          /rate limit|429|too many requests/i.test(detail) ||
          /rate limit|429/i.test(msg);
        return NextResponse.json(
          {
            error: rateLimited ? 'Azure TTS rate limited' : 'TTS unavailable',
            detail,
            code: rateLimited ? 'azure_rate_limited' : 'tts_unavailable',
            reqId,
          },
          { status: 503, headers: traceHeaders },
        );
      }
      const outStatus = resolveUpstreamErrorStatus(res.status);
      return NextResponse.json(
        { error: 'Upstream error', detail, reqId },
        { status: outStatus, headers: traceHeaders },
      );
    }

    const data = await res.json().catch(() => null);
    return NextResponse.json(data ?? {}, { headers: traceHeaders });
  } catch (err: unknown) {
    const isTimeout = err instanceof Error && err.name === 'AbortError';
    console.error(
      `[tts-route] ❌ ${isTimeout ? 'TTS timeout' : 'Server error'}:`,
      err,
    );
    return NextResponse.json(
      {
        error: isTimeout ? 'TTS timeout' : 'Server error',
        detail: truncateUpstreamDetail(String(err)),
        reqId,
      },
      { status: isTimeout ? 408 : 500, headers: traceHeaders },
    );
  }
}
