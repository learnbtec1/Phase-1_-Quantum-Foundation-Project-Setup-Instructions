/**
 * TTS-with-timing bridge:
 *   1st try → Kokoro backend POST /api/v1/tts-with-timing  (full word timings)
 *   2nd try → OpenAI TTS /v1/audio/speech                  (audio-only, no timings)
 * Returns { audio_base64, word_timings, sample_rate } for lip-sync.
 * 503 = both unavailable, 502 = upstream error, 408 = timeout.
 */
import { NextRequest, NextResponse } from "next/server";
import { randomUUID } from "node:crypto";

const TTS_TIMEOUT_MS = 20_000;
const MAX_TEXT_LENGTH = 5000;

// ─── OpenAI TTS fallback ────────────────────────────────────────────────────
async function openaiTTSFallback(
  text: string,
  reqId: string
): Promise<NextResponse | null> {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) return null;

  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), TTS_TIMEOUT_MS);

    const res = await fetch("https://api.openai.com/v1/audio/speech", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
        "X-Request-ID": reqId,
      },
      body: JSON.stringify({
        model: "tts-1",
        input: text,
        voice: "nova",
        response_format: "mp3",
        speed: 1.0,
      }),
      signal: controller.signal,
    });
    clearTimeout(timeoutId);

    if (!res.ok) return null;

    const audioBuffer = await res.arrayBuffer();
    const audio_base64 = Buffer.from(audioBuffer).toString("base64");

    return NextResponse.json(
      { audio_base64, word_timings: [], sample_rate: 24000, source: "openai" },
      { headers: { "X-Request-ID": reqId } }
    );
  } catch {
    return null;
  }
}

export async function POST(req: NextRequest) {
  const reqId = randomUUID();
  const headers: Record<string, string> = { "X-Request-ID": reqId };

  try {
    const payload = await req.json().catch(() => ({}));
    const text = (payload?.text ?? "").toString().trim().slice(0, MAX_TEXT_LENGTH);
    if (!text) {
      return NextResponse.json({ error: "Empty text", reqId }, { status: 400, headers });
    }

    // ── 1st attempt: Kokoro backend ─────────────────────────────────────────
    const base = process.env.NEXT_PUBLIC_API_URL || "http://127.0.0.1:8000";
    const upstream =
      process.env.TTS_BACKEND_URL ||
      `${base.replace(/\/$/, "")}/api/v1/tts-with-timing`;

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), TTS_TIMEOUT_MS);

    let kokoroOk = false;
    try {
      const res = await fetch(upstream, {
        method: "POST",
        headers: { "Content-Type": "application/json", "X-Request-ID": reqId },
        body: JSON.stringify({
          text,
          voice: payload?.voice ?? "af_sarah",
          speed: payload?.speed ?? 1,
        }),
        signal: controller.signal,
      });
      clearTimeout(timeoutId);

      if (res.ok) {
        kokoroOk = true;
        const data = await res.json().catch(() => null);
        return NextResponse.json(data ?? {}, { headers });
      }
      // Kokoro returned non-OK → fall through to OpenAI
    } catch {
      clearTimeout(timeoutId);
      // Kokoro unreachable → fall through to OpenAI
    }

    if (!kokoroOk) {
      // ── 2nd attempt: OpenAI TTS ───────────────────────────────────────────
      const openaiResponse = await openaiTTSFallback(text, reqId);
      if (openaiResponse) return openaiResponse;

      // Both unavailable
      return NextResponse.json(
        { error: "TTS unavailable: Kokoro offline and no OpenAI key configured", reqId },
        { status: 503, headers }
      );
    }

    // Should not reach here
    return NextResponse.json({ error: "Server error", reqId }, { status: 500, headers });
  } catch (err: unknown) {
    const isTimeout = err instanceof Error && err.name === "AbortError";
    return NextResponse.json(
      { error: isTimeout ? "TTS timeout" : "Server error", reqId },
      { status: isTimeout ? 408 : 500, headers }
    );
  }
}
