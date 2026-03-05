/**
 * TTS-with-timing bridge: forwards to backend POST /api/v1/tts-with-timing
 * Falls back to OpenAI TTS when Kokoro backend is unavailable.
 * Returns { audio_base64, word_timings, sample_rate, format } for lip-sync.
 */
import { NextRequest, NextResponse } from "next/server";
import OpenAI from "openai";

const mkId = () => `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;

const TTS_TIMEOUT_MS = 20_000;
const MAX_TEXT_LENGTH = 5000;

function estimateWordTimings(text: string): Array<{ word: string; start_time: number; end_time: number }> {
  const words = text.split(/\s+/).filter(Boolean);
  const msPerWord = 350;
  return words.map((word, i) => ({
    word,
    start_time: i * msPerWord,
    end_time: (i + 1) * msPerWord,
  }));
}

async function openaiTtsFallback(
  text: string,
  reqId: string,
  headers: Record<string, string>
): Promise<NextResponse> {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    return NextResponse.json(
      { error: "TTS unavailable: no backend and no OPENAI_API_KEY", reqId },
      { status: 503, headers }
    );
  }
  try {
    const openai = new OpenAI({ apiKey });
    const speechRes = await openai.audio.speech.create({
      model: "tts-1",
      voice: "nova",
      input: text,
      response_format: "mp3",
    });
    const buf = Buffer.from(await speechRes.arrayBuffer());
    const audio_base64 = buf.toString("base64");
    const word_timings = estimateWordTimings(text);
    return NextResponse.json(
      { audio_base64, word_timings, sample_rate: 24000, format: "mp3", fallback: "openai" },
      { headers }
    );
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    return NextResponse.json(
      { error: "OpenAI TTS failed", details: msg.slice(0, 200), reqId },
      { status: 502, headers }
    );
  }
}

export async function POST(req: NextRequest) {
  const reqId = mkId();
  const headers: Record<string, string> = { "X-Request-ID": reqId };

  try {
    const payload = await req.json().catch(() => ({}));
    const text = (payload?.text ?? "").toString().trim().slice(0, MAX_TEXT_LENGTH);
    if (!text) {
      return NextResponse.json({ error: "Empty text", reqId }, { status: 400, headers });
    }

    const base = process.env.NEXT_PUBLIC_API_URL || "http://127.0.0.1:8000";
    const upstream = process.env.TTS_BACKEND_URL || `${base.replace(/\/$/, "")}/api/v1/tts-with-timing`;

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), TTS_TIMEOUT_MS);

    let res: Response | null = null;
    try {
      res = await fetch(upstream, {
        method: "POST",
        headers: { "Content-Type": "application/json", "X-Request-ID": reqId },
        body: JSON.stringify({
          text,
          voice: payload?.voice ?? "af_sarah",
          speed: payload?.speed ?? 1,
        }),
        signal: controller.signal,
      });
    } catch {
      clearTimeout(timeoutId);
      return openaiTtsFallback(text, reqId, headers);
    }
    clearTimeout(timeoutId);

    if (!res.ok) {
      return openaiTtsFallback(text, reqId, headers);
    }

    const data = await res.json().catch(() => null);
    return NextResponse.json(data ?? {}, { headers });
  } catch (err: unknown) {
    const isTimeout = err instanceof Error && err.name === "AbortError";
    return NextResponse.json(
      { error: isTimeout ? "TTS timeout" : "Server error", reqId },
      { status: isTimeout ? 408 : 500, headers }
    );
  }
}
