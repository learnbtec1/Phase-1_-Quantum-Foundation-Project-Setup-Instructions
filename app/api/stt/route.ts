/**
 * STT bridge: forwards audio to backend POST /api/v1/stt
 * Falls back to OpenAI Whisper API when backend is unavailable.
 * Accepts multipart form with 'audio' file. Returns { transcript }.
 */
import { NextRequest, NextResponse } from "next/server";
import OpenAI, { toFile } from "openai";

const STT_TIMEOUT_MS = 15_000;

async function openaiWhisperFallback(audio: Blob): Promise<NextResponse> {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    return NextResponse.json(
      { error: "STT unavailable: no backend and no OPENAI_API_KEY" },
      { status: 503 }
    );
  }
  try {
    const openai = new OpenAI({ apiKey });
    const arrayBuf = await audio.arrayBuffer();
    const buf = Buffer.from(arrayBuf);
    const mime = audio.type || "audio/webm";
    const ext = mime.includes("mp4") ? "mp4"
      : mime.includes("ogg") ? "ogg"
      : mime.includes("wav") ? "wav"
      : mime.includes("mp3") || mime.includes("mpeg") ? "mp3"
      : mime.includes("flac") ? "flac"
      : "webm";
    const file = await toFile(buf, `audio.${ext}`, { type: mime });
    const transcription = await openai.audio.transcriptions.create({
      file,
      model: "whisper-1",
      language: "ar",
    });
    return NextResponse.json({ transcript: transcription.text ?? "", fallback: "openai" });
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    return NextResponse.json(
      { error: "OpenAI Whisper failed", details: msg.slice(0, 200) },
      { status: 502 }
    );
  }
}

export async function POST(req: NextRequest) {
  try {
    const formData = await req.formData();
    const audio = formData.get("audio");
    if (!audio || !(audio instanceof Blob) || audio.size < 100) {
      return NextResponse.json({ error: "No audio or audio too short" }, { status: 400 });
    }

    const base = process.env.NEXT_PUBLIC_API_URL || "http://127.0.0.1:8000";
    const upstream = `${base.replace(/\/$/, "")}/api/v1/stt`;

    const fd = new FormData();
    fd.append("audio", audio);

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), STT_TIMEOUT_MS);

    let res: Response | null = null;
    try {
      res = await fetch(upstream, {
        method: "POST",
        body: fd,
        signal: controller.signal,
      });
    } catch {
      clearTimeout(timeoutId);
      return openaiWhisperFallback(audio);
    }
    clearTimeout(timeoutId);

    if (!res.ok) {
      return openaiWhisperFallback(audio);
    }

    const data = await res.json().catch(() => null);
    return NextResponse.json({ transcript: data?.transcript ?? "" });
  } catch (err: unknown) {
    const isTimeout = err instanceof Error && err.name === "AbortError";
    return NextResponse.json(
      { error: isTimeout ? "STT timeout" : "Server error" },
      { status: isTimeout ? 408 : 500 }
    );
  }
}
