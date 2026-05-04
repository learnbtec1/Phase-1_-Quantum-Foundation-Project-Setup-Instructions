/**
 * ElevenLabs TTS:
 * 1) Prefer direct call to api.elevenlabs.io when ELEVENLABS_API_KEY + ELEVENLABS_VOICE_ID are set on Next.js.
 * 2) Otherwise proxy to FastAPI POST /api/v1/tts-with-timing (keys often live only in backend .env).
 *
 * Viseme timeline: Arabic → phoneme-class mapping; non-Arabic → stub. Applied whenever we have MP3 bytes.
 */

import { NextRequest, NextResponse } from 'next/server';
import { randomUUID } from 'node:crypto';
import { backendBaseUrl } from '@/lib/server/bffAuth';
import {
  buildArabicPhonemeVisemeTimeline,
  estimateMp3DurationMs,
  type PhonemeVisemeEvent,
} from '@/lib/server/arabicPhonemeVisemeTimeline';
import { stubVisemeTimelineForText } from '@/lib/server/elevenlabsTtsStub';
import {
  extractUpstreamDetail,
  resolveIncomingBearerOrDevBypass,
  resolveUpstreamErrorStatus,
  truncateUpstreamDetail,
} from '@/lib/server/bffProxy';
import { isTtsUpstreamProviderOk } from '@/lib/server/ttsUpstreamIntegrity';

const MAX_TEXT_LENGTH = 5000;

const ARABIC_RE = /[\u0600-\u06FF]/;

/** Free-tier default (Rachel) — used when `.env` voice is unset or returns HTTP 402. */
const ELEVENLABS_FALLBACK_VOICE_ID = '21m00Tcm4TlvDq8ikWAM';

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
  const hasArabic = /[\u0600-\u06FF]/.test(text);
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
  return {
    viseme_events: stubVisemeTimelineForText(text, durationMs),
    timing_mode: 'stub',
  };
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

    const apiKey = (process.env.ELEVENLABS_API_KEY ?? '').trim();
    const voiceIdEnv = (process.env.ELEVENLABS_VOICE_ID ?? '').trim();
    const defaultArabicVoice =
      process.env.TTS_ARABIC_VOICE?.trim() || 'ar-SA-ZariyahNeural';

    const modelId =
      (process.env.ELEVENLABS_MODEL_ID ?? '').trim() || 'eleven_multilingual_v2';

    const controller = new AbortController();
    const timeoutMs = ttsProxyTimeoutMs();
    const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

    const upstreamSignal =
      typeof (AbortSignal as any).any === 'function'
        ? (AbortSignal as any).any([controller.signal, req.signal])
        : controller.signal;

    const voicesToTry = Array.from(
      new Set([
        (voiceIdEnv || ELEVENLABS_FALLBACK_VOICE_ID).trim(),
        ELEVENLABS_FALLBACK_VOICE_ID.trim(),
      ]),
    );

    const useDirectElevenLabs = Boolean(apiKey);

    if (useDirectElevenLabs) {
      const body: Record<string, unknown> = {
        text,
        model_id: modelId,
      };
      if (ARABIC_RE.test(text)) {
        body.language_code = 'ar';
      }

      let res: Response | undefined;
      let voiceUsed = ELEVENLABS_FALLBACK_VOICE_ID;

      outer: for (let vi = 0; vi < voicesToTry.length; vi++) {
        const voiceTry = voicesToTry[vi];
        const url = new URL(
          `https://api.elevenlabs.io/v1/text-to-speech/${encodeURIComponent(voiceTry)}`,
        );
        url.searchParams.set('output_format', 'mp3_44100_128');

        // eslint-disable-next-line no-console
        console.log(`[BFF] Calling ElevenLabs API directly for voice: ${voiceTry}`);

        try {
          res = await fetch(url.toString(), {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              Accept: 'audio/mpeg',
              'xi-api-key': apiKey,
              'X-Request-ID': reqId,
            },
            body: JSON.stringify(body),
            signal: upstreamSignal,
          });
        } catch (fetchErr) {
          clearTimeout(timeoutId);
          console.error('[tts-elevenlabs] ElevenLabs unreachable:', fetchErr);
          return NextResponse.json(
            {
              error: 'ElevenLabs unreachable',
              detail: truncateUpstreamDetail(String(fetchErr)),
              reqId,
            },
            { status: 503, headers: traceHeaders },
          );
        }

        if (res.ok) {
          voiceUsed = voiceTry;
          break outer;
        }

        const msg = await res.text().catch(() => '');
        const detail = extractUpstreamDetail(msg);
        if (res.status === 402 && vi < voicesToTry.length - 1) {
          // eslint-disable-next-line no-console
          console.warn(`[tts-elevenlabs] ElevenLabs 402 for voice ${voiceTry} — retrying fallback`);
          continue;
        }

        clearTimeout(timeoutId);

        if (res.status === 429) {
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
        if (res.status === 402) {
          return NextResponse.json(
            {
              error: 'ElevenLabs voice or subscription not allowed for this API key',
              detail,
              code: 'elevenlabs_402',
              reqId,
            },
            { status: 402, headers: traceHeaders },
          );
        }
        if (res.status === 401 || res.status === 403) {
          return NextResponse.json(
            {
              error: 'ElevenLabs auth failed',
              detail,
              reqId,
            },
            { status: 502, headers: traceHeaders },
          );
        }
        const outStatus = resolveUpstreamErrorStatus(res.status);
        return NextResponse.json(
          { error: 'ElevenLabs error', detail, reqId },
          { status: outStatus, headers: traceHeaders },
        );
      }

      clearTimeout(timeoutId);

      if (!res?.ok) {
        return NextResponse.json(
          { error: 'ElevenLabs error', detail: 'no successful response', reqId },
          { status: 502, headers: traceHeaders },
        );
      }

      const buf = new Uint8Array(await res.arrayBuffer());
      if (!buf.length || buf.length < 32) {
        return NextResponse.json(
          {
            error: 'TTS integrity',
            detail: 'Empty or invalid audio from ElevenLabs',
            reqId,
          },
          { status: 502, headers: traceHeaders },
        );
      }

      const durationMs = estimateMp3DurationMs(buf);
      const hasArabic = /[\u0600-\u06FF]/.test(text);
      let viseme_events: PhonemeVisemeEvent[];
      const timing_mode = hasArabic ? 'phoneme_ar' : 'stub';
      if (hasArabic) {
        const built = buildArabicPhonemeVisemeTimeline(text, durationMs);
        viseme_events = built.events;
        // eslint-disable-next-line no-console
        console.log(
          `[BFF] [TTS-SYNC] weighted phoneme_ar | cues=${viseme_events.length} | avgCharMs=${built.stats.avgCharDurationMs.toFixed(1)} | totalWeight=${built.stats.totalWeight.toFixed(2)} | durationMs=${durationMs}`,
        );
      } else {
        viseme_events = stubVisemeTimelineForText(text, durationMs);
        // eslint-disable-next-line no-console
        console.log(
          `[BFF] [TTS-SYNC] stub viseme map: ${viseme_events.length} cues | timing=${timing_mode} | durationMs=${durationMs}`,
        );
      }

      const audio_base64 = Buffer.from(buf).toString('base64');

      const responsePayload: Record<string, unknown> = {
        audio_base64,
        audio_mp3_base64: audio_base64,
        audio_wav_base64: null,
        word_timings: [],
        viseme_events,
        visemes: viseme_events,
        sample_rate: 44100,
        format: 'mp3',
        timing_mode,
        provider: 'elevenlabs',
        voice: voiceUsed,
      };

      return NextResponse.json(responsePayload, {
        headers: traceHeaders,
      });
    }

    // ── Fallback: FastAPI has ELEVENLABS_* when TTS_PROVIDER=elevenlabs ─────────
    // eslint-disable-next-line no-console
    console.warn(
      '[BFF] ELEVENLABS_API_KEY not set on Next.js — proxying to FastAPI /api/v1/tts-with-timing (voice id optional here; Rachel fallback applies on direct ElevenLabs path only).',
    );

    const upstream =
      process.env.TTS_BACKEND_URL ||
      `${backendBaseUrl()}/api/v1/tts-with-timing`;

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

      if (res.status === 502 || res.status === 503) {
        // eslint-disable-next-line no-console
        console.error(
          '[tts-elevenlabs] FastAPI proxy failed — check backend .env: TTS_PROVIDER=elevenlabs, ELEVENLABS_API_KEY, ELEVENLABS_VOICE_ID (docker-compose must not override TTS_PROVIDER with a fixed "edge"). Detail:',
          detail.slice(0, 500),
        );
      }

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

    if (!isTtsUpstreamProviderOk(provider)) {
      return NextResponse.json(
        {
          error: 'TTS integrity',
          detail: `Unexpected provider=${String(providerRaw)}`,
          reqId,
        },
        { status: 502, headers: traceHeaders },
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
        { status: 502, headers: traceHeaders },
      );
    }

    let visemes = data?.viseme_events;
    let timing_mode =
      typeof data?.timing_mode === 'string' ? data.timing_mode : 'stub';

    try {
      const { viseme_events: v, timing_mode: tm } =
        applyVisemeTimelineFromAudio(text, audio);
      visemes = v;
      timing_mode = tm;
    } catch {
      /* keep backend visemes */
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
      `[BFF] [TTS-SYNC] Proxy path | cues=${(visemes as unknown[]).length} | timing=${timing_mode}`,
    );

    const responsePayload: Record<string, unknown> = {
      ...data,
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
