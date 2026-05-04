/**
 * TTS-with-timing bridge: forwards to backend POST /api/v1/tts-with-timing
 * Returns { audio_base64, viseme_events, visemes, sample_rate } for lip-sync.
 * Requires Authorization: Bearer
 * Backend may use Microsoft Edge TTS (edge-tts) — provider may be null/edge/azure in JSON.
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
import { isTtsUpstreamProviderOk } from '@/lib/server/ttsUpstreamIntegrity';

const MAX_TEXT_LENGTH = 5000;

/** Timeout config */
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

  // 🔐 AUTH (optional when COGNI_BFF_DEV_BYPASS_AUTH + backend COGNI_DEV_BYPASS_AUTH — Docker demo)
  const bearer = resolveIncomingBearerOrDevBypass(req);
  if (!bearer.ok) return bearer.response;

  try {
    // 📥 REQUEST PAYLOAD
    const requestPayload = await req.json().catch(() => ({}));

    let text = (requestPayload?.text ?? '')
      .toString()
      .trim()
      .slice(0, MAX_TEXT_LENGTH);

    if (!text) {
      return NextResponse.json(
        { error: 'Empty text', reqId },
        { status: 400, headers: traceHeaders }
      );
    }

    // 🧠 Normalize names
    text = text
      .replace(/Cogni/gi, 'كُوجْنِي')
      .replace(/EDUVERSE/gi, 'إِيدُوفِيرْس');

    const base = backendBaseUrl();
    const upstream =
      process.env.TTS_BACKEND_URL ||
      `${base}/api/v1/tts-with-timing`;

    const defaultArabicVoice =
      process.env.TTS_ARABIC_VOICE?.trim() || 'ar-SA-ZariyahNeural';

    // ⏱ TIMEOUT CONTROL
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
          provider:
            (typeof requestPayload?.provider === 'string'
              ? requestPayload.provider
              : 'edge') || 'edge',
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

      console.error('[tts-route] Backend unreachable:', fetchErr);

      return NextResponse.json(
        {
          error: 'Backend unreachable',
          detail: truncateUpstreamDetail(String(fetchErr)),
          reqId,
        },
        { status: 503, headers: traceHeaders }
      );
    }

    clearTimeout(timeoutId);

    // ❌ ERROR HANDLING
    if (!res.ok) {
      const msg = await res.text().catch(() => '');

      const detail = extractUpstreamDetail(msg);

      let upstreamCode: string | undefined;
      try {
        const parsed = JSON.parse(msg);
        upstreamCode = parsed?.code;
      } catch {}

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
          { status: 429, headers: traceHeaders }
        );
      }

      if (res.status === 503) {
        return NextResponse.json(
          {
            error: 'TTS unavailable',
            detail,
            reqId,
          },
          { status: 503, headers: traceHeaders }
        );
      }

      const outStatus = resolveUpstreamErrorStatus(res.status);

      return NextResponse.json(
        { error: 'Upstream error', detail, reqId },
        { status: outStatus, headers: traceHeaders }
      );
    }

    // ✅ SUCCESS RESPONSE
    const data = (await res.json().catch(() => null)) as Record<
      string,
      unknown
    > | null;

    const providerRaw = data?.provider;
    const provider =
      typeof providerRaw === 'string' ? providerRaw.toLowerCase().trim() : '';

    const audio =
      typeof data?.audio_base64 === 'string'
        ? data.audio_base64
        : '';

    const visemes = data?.viseme_events;

    if (!isTtsUpstreamProviderOk(provider)) {
      return NextResponse.json(
        {
          error: 'TTS integrity',
          detail: `Unexpected provider=${String(providerRaw)}`,
          reqId,
        },
        { status: 502, headers: traceHeaders }
      );
    }
    const acceptedProviderLabel =
      (typeof providerRaw === 'string' && providerRaw.trim() !== '')
        ? providerRaw.trim()
        : (provider || '(empty)');
    // eslint-disable-next-line no-console -- intentional observability
    console.log('[TTS] provider accepted:', acceptedProviderLabel);

    if (!audio) {
      return NextResponse.json(
        {
          error: 'TTS integrity',
          detail: 'Empty audio',
          reqId,
        },
        { status: 502, headers: traceHeaders }
      );
    }

    if (!Array.isArray(visemes) || visemes.length === 0) {
      return NextResponse.json(
        {
          error: 'TTS integrity',
          detail: 'Missing viseme_events',
          reqId,
        },
        { status: 502, headers: traceHeaders }
      );
    }

    // 👑 FINAL RESPONSE (FIXED)
    const responsePayload: Record<string, unknown> = {
      ...data,
      visemes: visemes, // alias
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
      { status: isTimeout ? 408 : 500, headers: traceHeaders }
    );
  }
}
