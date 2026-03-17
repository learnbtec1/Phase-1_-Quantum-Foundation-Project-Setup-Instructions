/**
 * TTS-with-timing bridge: forwards to backend POST /api/v1/tts-with-timing
 * Returns { audio_base64, word_timings, sample_rate } for lip-sync.
 * 503=unreachable, 502=upstream error, 408=timeout.
 */
import { NextRequest, NextResponse } from "next/server";
import { randomUUID } from "node:crypto";

const TTS_TIMEOUT_MS = 20_000;
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

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), TTS_TIMEOUT_MS);

    let res: Response;
    try {
      res = await fetch(upstream, {
        method: "POST",
        headers: { "Content-Type": "application/json", "X-Request-ID": reqId },
        body: JSON.stringify({
          text,
          // Jordanian male voice for Cogni persona (ar-JO-OmarNeural = verified male)
          voice:    payload?.voice    ?? "ar-JO-OmarNeural",
          // Slightly slower than default (0.85) for a natural teacher pace
          speed:    payload?.speed    ?? 0.85,
          emotion:  payload?.emotion  ?? "neutral",
          ...(payload?.pitch ? { pitch: payload.pitch } : {}),
          ar_voice: payload?.ar_voice ?? "ar-JO-OmarNeural",
        }),
        signal: controller.signal,
      });
    } catch (fetchErr) {
      clearTimeout(timeoutId);
      console.error(`[tts-route] ❌ Cannot reach backend TTS at ${upstream} —`, fetchErr);
      return NextResponse.json(
        { error: "Backend unreachable", detail: String(fetchErr), reqId },
        { status: 503, headers }
      );
    }
    clearTimeout(timeoutId);

    if (!res.ok) {
      const msg = await res.text().catch(() => "");
      console.error(`[tts-route] ❌ Backend returned HTTP ${res.status} from ${upstream}:`, msg.slice(0, 500));
      if (res.status === 503) {
        return NextResponse.json(
          { error: "Kokoro TTS not available", detail: msg.slice(0, 300), reqId },
          { status: 503, headers }
        );
      }
      return NextResponse.json(
        { error: "Upstream error", details: msg.slice(0, 300), reqId },
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
