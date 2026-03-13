/**
 * جسر محادثة المعلم — يوجّه الطلبات إلى الباكند (FastAPI) حيث يُستخدم مفتاح OpenAI دون كشفه في الواجهة.
 */
import { NextRequest, NextResponse } from "next/server";

const BACKEND_URL = process.env.BACKEND_URL || "http://localhost:8000";

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { message, context = {} } = body;
    if (!message || typeof message !== "string" || message.trim() === "") {
      return NextResponse.json(
        { error: "message is required and must be non-empty" },
        { status: 400 }
      );
    }
    const res = await fetch(`${BACKEND_URL}/api/v1/tutor/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ message: message.trim(), context }),
    });
    if (!res.ok) {
      const err = await res.text();
      return NextResponse.json(
        { error: err || "Tutor request failed" },
        { status: res.status }
      );
    }
    const data = await res.json();
    return NextResponse.json({ response: data.response ?? "" });
  } catch (e: any) {
    console.error("Tutor chat bridge error:", e);
    return NextResponse.json(
      { error: e?.message || "Server error" },
      { status: 500 }
    );
  }
}
