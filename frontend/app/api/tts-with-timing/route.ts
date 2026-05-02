/**
 * Edge TTS BFF: proxies to FastAPI `POST /api/v1/tts-with-timing`
 * (`edge-tts` / Microsoft online voices — no API key).
 */

import { NextRequest, NextResponse } from 'next/server';
import { randomUUID } from 'node:crypto';
import { backendBaseUrl } from '@/lib/server/bffAuth';
import {
  buildArabicPhonemeVisemeTimeline,
  estimateMp3DurationMs,
  type PhonemeVisemeEvent,
} from '@/lib/server/arabicPhonemeVisemeTimeline';
import { resolveTtsUpstreamAuth } from '@/app/api/_shared/authorizeTts';
import {
  extractUpstreamDetail,
  resolveUpstreamErrorStatus,
  truncateUpstreamDetail,
} from '@/lib/server/bffProxy';

const MAX_TEXT_LENGTH = 5000;

const ARABIC_RE = /[\u0600-\u06FF]/;

function ttsProxyTimeoutMs(): number {
  const raw = process.env.TTS_PROXY_TIMEOUT_MS;
  const n = raw ? parseInt(raw, 10) : NaN;
  if (Number.isFinite(n) && n >= 15000) return Math.min(n, 180000);
  return 90000;
}

function applyVisemeTimelineFromAudio(
  text: string,
  audioBase64: string,
): {
  viseme_events: PhonemeVisemeEvent[];
  timing_mode: string;
} {
  const b64 = audioBase64.replace(/\s/g, '');
  const buf = Buffer.from(b64, 'base64');
  const bytes = new Uint8Array(buf);
  const durationMs = estimateMp3DurationMs(bytes);
  const hasArabic = ARABIC_RE.test(text);
  if (hasArabic) {
    const { events, stats } = buildArabicPhonemeVisemeTimeline(text, durationMs);
    // eslint-disable-next-line no-console
    console.log(
      `[BFF] [TTS-SYNC] weighted phoneme_ar | cues=${events.length} | avgCharMs=${stats.avgCharDurationMs.toFixed(1)} | totalWeight=${stats.totalWeight.toFixed(2)} | durationMs=${durationMs}`,
    );
    return {
      viseme_events: events,
      timing_mode: 'phoneme_ar',
    };
  }
  const step = Math.max(120, Math.min(340, Math.round(durationMs / 40)));
  const stubVis: PhonemeVisemeEvent[] = [];
  let t = 0;
  while (t < durationMs) {
    stubVis.push({
      offset_ms: t,
      viseme_id: [4, 6, 8, 12][stubVis.length % 4]!,
    });
    t += step;
  }
  return {
    viseme_events: stubVis.length ? stubVis : [{ offset_ms: 0, viseme_id: 0 }],
    timing_mode: 'stub_non_ar',
  };
}

export async function POST(req: NextRequest) {
  const reqId = randomUUID();
  const traceHeaders: Record<string, string> = {
    'X-Request-ID': reqId,
  };

  const bearer = resolveTtsUpstreamAuth(req);
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

    const controller = new AbortController();
    const timeoutMs = ttsProxyTimeoutMs();
    const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

    const upstreamSignal =
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      typeof (AbortSignal as any).any === 'function'
        ? // eslint-disable-next-line @typescript-eslint/no-explicit-any
          (AbortSignal as any).any([controller.signal, req.signal])
        : controller.signal;

    const upstream =
      process.env.TTS_BACKEND_URL ||
      `${backendBaseUrl()}/api/v1/tts-with-timing`;

    const upstreamHeaders: Record<string, string> = {
      'Content-Type': 'application/json',
      'X-Request-ID': reqId,
    };
    if (bearer.authHeader) {
      upstreamHeaders.Authorization = bearer.authHeader;
    }

    let res: Response;
    try {
      res = await fetch(upstream, {
        method: 'POST',
        headers: upstreamHeaders,
        body: JSON.stringify({
          text,
          provider: 'edge',
          speed: typeof requestPayload?.speed === 'number' ? requestPayload.speed : 0.85,
          emotion: typeof requestPayload?.emotion === 'string' ? requestPayload.emotion : 'neutral',
          emotion_intensity:
            typeof requestPayload?.emotion_intensity === 'number' &&
            Number.isFinite(requestPayload.emotion_intensity)
              ? requestPayload.emotion_intensity
              : 0.72,
          ...(requestPayload?.pitch ? { pitch: requestPayload.pitch } : {}),
          format: 'mp3',
        }),
        signal: upstreamSignal,
      });
    } catch (fetchErr) {
      clearTimeout(timeoutId);
      // eslint-disable-next-line no-console
      console.error('[tts-with-timing] Backend unreachable:', fetchErr);
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

      if (res.status === 502 || res.status === 503) {
        // eslint-disable-next-line no-console
        console.error('[tts-with-timing] FastAPI Edge TTS failed. Detail:', detail.slice(0, 500));
      }

      let upstreamCode: string | undefined;
      try {
        const parsed = JSON.parse(msg) as { code?: string };
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

    const data = (await res.json().catch(() => null)) as Record<string, unknown> | null;

    const providerRaw = data?.provider;
    const provider =
      typeof providerRaw === 'string' ? providerRaw.toLowerCase().trim() : '';

    const audio =
      typeof data?.audio_base64 === 'string' ? data.audio_base64 : '';

    const providerOk = !provider || provider === 'edge' || provider === 'azure' || provider === 'auto';
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

    let visemes = data?.viseme_events;
    let timing_mode = typeof data?.timing_mode === 'string' ? data.timing_mode : 'stub';

    try {
      const { viseme_events: v, timing_mode: tm } = applyVisemeTimelineFromAudio(text, audio);
      visemes = v;
      timing_mode = tm;
    } catch (timelineErr: unknown) {
      /* Fallback: upstream `viseme_events` when local timeline builder fails */
      if (process.env.NODE_ENV === 'development') {
        // eslint-disable-next-line no-console
        console.warn('[tts-with-timing] Keeping upstream viseme_events — timeline override failed:', timelineErr);
      }
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

    // eslint-disable-next-line no-console
    console.log(
      `[BFF] [TTS-SYNC] Edge proxy | cues=${(visemes as unknown[]).length} | timing=${timing_mode}`,
    );

    const responsePayload: Record<string, unknown> = {
      ...data,
      provider: data?.provider ?? 'edge',
      viseme_events: visemes,
      visemes,
      timing_mode,
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
