/**
 * BFF → backend POST /api/v1/tts-with-timing when the Python server uses TTS_PROVIDER=elevenlabs.
 * No ElevenLabs API key on Next.js — secrets live on the FastAPI host only.
 * Client still sends Authorization: Bearer (real JWT from login).
 */

import { NextRequest, NextResponse } from 'next/server';
import { randomUUID } from 'node:crypto';
import { backendBaseUrl } from '@/lib/server/bffAuth';
import {
  extractUpstreamDetail,
  resolveIncomingBearerOrDevBypass,
  resolveUpstreamErrorStatus,
  truncateUpstreamDetail,
} from '@/lib/server/bffProxy';

const MAX_TEXT_LENGTH = 5000;

function ttsProxyTimeoutMs(): number {
  const raw = process.env.TTS_PROXY_TIMEOUT_MS;
  const n = raw ? parseInt(raw, 10) : NaN;
  if (Number.isFinite(n) && n >= 15000) return Math.min(n, 180000);
  return 90000;
}

export async function POST(req: NextRequest) {
  const reqId = randomUUID();
  const traceHeaders: Record<string, string> = {
    'X-Request-ID': reqId,
  };

  const bearer = resolveIncomingBearerOrDevBypass(req);
  if (!bearer.ok) return bearer.response;

  try {
    const requestPayload = await req.json().catch(() => ({}));

    let text = (requestPayload?.text ?? '')
      .toString()
      .trim()
      .slice(0, MAX_TEXT_LENGTH);

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
      process.env.TTS_BACKEND_URL || `${base}/api/v1/tts-with-timing`;

    const defaultArabicVoice =
      process.env.TTS_ARABIC_VOICE?.trim() || 'ar-JO-TaimNeural';

    const controller = new AbortController();
    const timeoutMs = ttsProxyTimeoutMs();
    const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

    const upstreamSignal =
      typeof (AbortSignal as any).any === 'function'
        ? (AbortSignal as any).any([controller.signal, req.signal])
        : controller.signal;

    let res: Response;

    try {
      const upstreamHeaders: Record<string, string> = {
        'Content-Type': 'application/json',
        'X-Request-ID': reqId,
      };
      if (bearer.authHeader) {
        upstreamHeaders.Authorization = bearer.authHeader;
      }

      res = await fetch(upstream, {
        method: 'POST',
        headers: upstreamHeaders,
        body: JSON.stringify({
          text,
          provider: 'elevenlabs',
          voice: requestPayload?.voice ?? defaultArabicVoice,
          speed: requestPayload?.speed ?? 0.85,
          emotion: requestPayload?.emotion ?? 'neutral',
          emotion_intensity:
            typeof requestPayload?.emotion_intensity === 'number' &&
            Number.isFinite(requestPayload.emotion_intensity)
              ? requestPayload.emotion_intensity
              : 0.72,
          ...(requestPayload?.pitch ? { pitch: requestPayload.pitch } : {}),
          ar_voice: requestPayload?.ar_voice ?? 'male',
        }),
        signal: upstreamSignal,
      });
    } catch (fetchErr) {
      clearTimeout(timeoutId);
      console.error('[tts-elevenlabs] Backend unreachable:', fetchErr);
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
      const detail = extractUpstreamDetail(msg);

      let upstreamCode: string | undefined;
      try {
        const parsed = JSON.parse(msg);
        upstreamCode = parsed?.code;
      } catch {
        /* */
      }

      const isQuota =
        res.status === 429 ||
        upstreamCode === 'tts_rate_limit' ||
        /hourly limit/i.test(detail);

      if (isQuota) {
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
        return NextResponse.json(
          {
            error: 'TTS unavailable',
            detail,
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

    const data = (await res.json().catch(() => null)) as Record<
      string,
      unknown
    > | null;

    const providerRaw = data?.provider;
    const provider =
      typeof providerRaw === 'string' ? providerRaw.toLowerCase().trim() : '';

    const audio =
      typeof data?.audio_base64 === 'string' ? data.audio_base64 : '';

    const visemes = data?.viseme_events;

    const providerOk =
      !provider ||
      provider === 'azure' ||
      provider === 'edge' ||
      provider === 'auto' ||
      provider === 'elevenlabs';
    if (!providerOk) {
      return NextResponse.json(
        {
          error: 'TTS integrity',
          detail: `Unexpected provider=${String(providerRaw)}`,
          reqId,
        },
        { status: 502, headers: traceHeaders },
      );
    }

    if (!audio) {
      return NextResponse.json(
        {
          error: 'TTS integrity',
          detail: 'Empty audio',
          reqId,
        },
        { status: 502, headers: traceHeaders },
      );
    }

    if (!Array.isArray(visemes) || visemes.length === 0) {
      return NextResponse.json(
        {
          error: 'TTS integrity',
          detail: 'Missing viseme_events',
          reqId,
        },
        { status: 502, headers: traceHeaders },
      );
    }

    const responsePayload: Record<string, unknown> = {
      ...data,
      visemes,
    };

    return NextResponse.json(responsePayload, {
      headers: traceHeaders,
    });
  } catch (err: unknown) {
    const isTimeout = err instanceof Error && err.name === 'AbortError';

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
