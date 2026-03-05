/**
 * Chat bridge: forwards to backend POST /api/v1/chat
 * Falls back to OpenAI GPT-4o-mini when backend is unavailable.
 * Accepts { message, mode?, context? } and returns { reply }.
 */
import { NextRequest, NextResponse } from "next/server";
import OpenAI from "openai";

const mkId = () => `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;

const MAX_MESSAGE_LENGTH = 4000;
const FETCH_TIMEOUT_MS = 30_000;

const SYSTEM_PROMPT = `أنت مساعد تعليمي ذكي ومتخصص في المناهج الدراسية. تجيب باللغة العربية
بشكل واضح ومفيد ومناسب للطلاب. قدم إجابات دقيقة ومختصرة مع أمثلة عند الحاجة.`;

async function openaiChatFallback(
  message: string,
  mode: string,
  reqId: string,
  headers: Record<string, string>
): Promise<NextResponse> {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    return NextResponse.json(
      { error: "Chat unavailable: no backend and no OPENAI_API_KEY", reqId },
      { status: 503, headers }
    );
  }
  try {
    const openai = new OpenAI({ apiKey });
    const systemPrompt = mode === "simulation"
      ? "أنت مستشار أعمال استراتيجي متخصص في التسويق والأعمال. أجب بالعربية."
      : SYSTEM_PROMPT;
    const completion = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: message },
      ],
      max_tokens: 500,
      temperature: 0.7,
    });
    const reply = completion.choices[0]?.message?.content?.trim() ?? "";
    return NextResponse.json({ reply, reqId, fallback: "openai" }, { headers });
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    return NextResponse.json(
      { error: "OpenAI chat failed", details: msg.slice(0, 200), reqId },
      { status: 502, headers }
    );
  }
}

export async function POST(req: NextRequest) {
  const reqId = mkId();
  const headers: Record<string, string> = { "X-Request-ID": reqId };

  try {
    const body = await req.json().catch(() => ({}));
    const message = (body?.message ?? "").toString().trim().slice(0, MAX_MESSAGE_LENGTH);
    const mode = (body?.mode ?? "teacher").toString();

    if (!message) {
      return NextResponse.json({ error: "Empty message", reqId }, { status: 400, headers });
    }

    const base = process.env.NEXT_PUBLIC_API_URL || "http://127.0.0.1:8000";
    const upstream = `${base.replace(/\/$/, "")}/api/v1/chat`;

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);

    let res: Response | null = null;
    try {
      res = await fetch(upstream, {
        method: "POST",
        headers: { "Content-Type": "application/json", "X-Request-ID": reqId },
        body: JSON.stringify({ message }),
        signal: controller.signal,
      });
    } catch {
      clearTimeout(timeoutId);
      return openaiChatFallback(message, mode, reqId, headers);
    }
    clearTimeout(timeoutId);

    if (!res.ok) {
      return openaiChatFallback(message, mode, reqId, headers);
    }

    const data = await res.json().catch(() => null);
    if (!data?.reply) {
      return openaiChatFallback(message, mode, reqId, headers);
    }
    return NextResponse.json({ reply: data.reply, reqId }, { headers });
  } catch (err: unknown) {
    const isTimeout = err instanceof Error && err.name === "AbortError";
    return NextResponse.json(
      { error: isTimeout ? "Chat timeout" : "Server error", reqId },
      { status: isTimeout ? 408 : 500, headers }
    );
  }
}
