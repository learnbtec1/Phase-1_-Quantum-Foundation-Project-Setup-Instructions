/**
 * Chat bridge: forwards to backend POST /api/v1/chat
 * Accepts { message } and returns { reply } without exposing API keys.
 * 503=unreachable, 502=upstream error, 408=timeout.
 */
import { NextRequest, NextResponse } from "next/server";
import { randomUUID } from "node:crypto";

const MAX_MESSAGE_LENGTH = 4000;
const FETCH_TIMEOUT_MS = 30_000;

export async function POST(req: NextRequest) {
  const reqId = randomUUID();
  const headers: Record<string, string> = { "X-Request-ID": reqId };

  try {
    const payload = await req.json();
    const raw = typeof payload?.message === "string" ? payload.message : "";
    const message = raw.trim().slice(0, MAX_MESSAGE_LENGTH);
    if (!message) {
      return NextResponse.json(
        { error: "Empty message", reqId },
        { status: 400, headers }
      );
    }

    const base = process.env.NEXT_PUBLIC_API_URL || "http://127.0.0.1:8000";
    const upstream = process.env.CHAT_BACKEND_URL || `${base.replace(/\/$/, "")}/api/v1/chat`;

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);

    let res: Response;
    try {
      res = await fetch(upstream, {
        method: "POST",
        headers: { "Content-Type": "application/json", "X-Request-ID": reqId },
        body: JSON.stringify({ message }),
        signal: controller.signal,
      });
    } catch (err) {
      clearTimeout(timeoutId);
      return NextResponse.json(
        { error: "Backend unreachable", reqId },
        { status: 503, headers }
      );
    }
    clearTimeout(timeoutId);

    if (!res.ok) {
      const text = await res.text().catch(() => "");
      return NextResponse.json(
        { error: "Upstream error", details: text.slice(0, 300), reqId },
        { status: 502, headers }
      );
    }

    const data = await res.json().catch(() => null);
    const reply = data?.reply ?? "";
    return NextResponse.json({ reply, reqId }, { headers });
  } catch (err: unknown) {
    const isTimeout = err instanceof Error && err.name === "AbortError";
    return NextResponse.json(
      {
        error: isTimeout ? "Timeout contacting upstream" : "Server error",
        reqId,
      },
      { status: isTimeout ? 408 : 500, headers }
    );
  }
}
