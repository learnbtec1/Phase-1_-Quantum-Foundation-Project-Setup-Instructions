/**
 * TTS-with-timing bridge: forwards to backend POST /api/v1/tts-with-timing
 * Returns { audio_base64, word_timings, sample_rate } for lip-sync.
 * 503=unreachable, 502=upstream error, 408=timeout.
 */
import { NextRequest, NextResponse } from "next/server";
import { randomUUID } from "node:crypto";

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
  const headers: Record<string, string> = { "X-Request-ID": reqId };

  try {
    const payload = await req.json().catch(() => ({}));
    let text = (payload?.text ?? "").toString().trim().slice(0, MAX_TEXT_LENGTH);
    if (!text) {
      return NextResponse.json({ error: "Empty text", reqId }, { status: 400, headers });
    }

    // Arabic name preprocessing — replace English names with diacritised Arabic so
    // Azure Neural TTS pronounces them correctly instead of spelling them out.
    text = text
      .replace(/Cogni/ig, "كُوجْنِي")
      .replace(/EDUVERSE/ig, "إِيدُوفِيرْس");

    const base = process.env.BACKEND_URL || "http://127.0.0.1:8000";
    const upstream = process.env.TTS_BACKEND_URL || `${base.replace(/\/$/, "")}/api/v1/tts-with-timing`;
    /** Must match backend `TTS_ARABIC_VOICE` (Omar may be unavailable in some Azure regions). */
    const defaultArabicVoice =
      process.env.TTS_ARABIC_VOICE?.trim() || "ar-JO-TaimNeural";

    const controller = new AbortController();
    const timeoutMs = ttsProxyTimeoutMs();
    const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
    // Client disconnect should cancel upstream work; combine with proxy timeout (ES2024+).
    const mergeAbort = (AbortSignal as unknown as { any?: (s: AbortSignal[]) => AbortSignal })
      .any;
    const upstreamSignal =
      typeof mergeAbort === "function"
        ? mergeAbort([controller.signal, req.signal])
        : controller.signal;

    let res: Response;
    try {
      res = await fetch(upstream, {
        method: "POST",
        headers: { "Content-Type": "application/json", "X-Request-ID": reqId },
        body: JSON.stringify({
          text,
          voice:    payload?.voice    ?? defaultArabicVoice,
          // Slightly slower than default (0.85) for a natural teacher pace
          speed:    payload?.speed    ?? 0.85,
          emotion:  payload?.emotion  ?? "neutral",
          ...(payload?.pitch ? { pitch: payload.pitch } : {}),
          ar_voice: payload?.ar_voice ?? "male",
        }),
        signal: upstreamSignal,
      });
    } catch (fetchErr) {
      clearTimeout(timeoutId);
      console.error(`[tts-route] ❌ Cannot reach backend TTS at ${upstream} (timeout=${timeoutMs}ms) —`, fetchErr);
      return NextResponse.json(
        { error: "Backend unreachable", detail: String(fetchErr), reqId },
        { status: 503, headers }
      );
    }
    clearTimeout(timeoutId);

    if (!res.ok) {
      const msg = await res.text().catch(() => "");
      console.error(`[tts-route] ❌ Backend returned HTTP ${res.status} from ${upstream}:`, msg.slice(0, 500));
      let detail = msg.slice(0, 500);
      let upstreamCode: string | undefined;
      try {
        const j = JSON.parse(msg) as { detail?: unknown; code?: string };
        upstreamCode = typeof j?.code === "string" ? j.code : undefined;
        if (typeof j?.detail === "string") detail = j.detail;
        else if (j?.detail != null) detail = String(j.detail);
      } catch {
        /* plain text body */
      }
      const hourlyQuota =
        res.status === 429 ||
        upstreamCode === "tts_rate_limit" ||
        /hourly limit exceeded|TTS hourly limit/i.test(detail) ||
        /hourly limit exceeded/i.test(msg);
      if (hourlyQuota) {
        return NextResponse.json(
          {
            error: "TTS hourly limit exceeded",
            detail,
            code: "tts_hourly_limit",
            reqId,
          },
          { status: 429, headers }
        );
      }
      if (res.status === 503) {
        const rateLimited =
          /rate limit|429|too many requests/i.test(detail) || /rate limit|429/i.test(msg);
        return NextResponse.json(
          {
            error: rateLimited ? "Azure TTS rate limited" : "TTS unavailable",
            detail,
            code: rateLimited ? "azure_rate_limited" : "tts_unavailable",
            reqId,
          },
          { status: 503, headers }
        );
      }
      return NextResponse.json(
        { error: "Upstream error", details: detail.slice(0, 300), reqId },
        { status: 502, headers }
      );
    }

    const data = await res.json().catch(() => null);
    return NextResponse.json(data ?? {}, { headers });
  } catch (err: unknown) {
    const isTimeout = err instanceof Error && err.name === "AbortError";
    console.error(`[tts-route] ❌ ${isTimeout ? 'TTS timeout' : 'Server error'}:`, err);
    return NextResponse.json(
      { error: isTimeout ? "TTS timeout" : "Server error", detail: String(err), reqId },
      { status: isTimeout ? 408 : 500, headers }
    );
  }
}
