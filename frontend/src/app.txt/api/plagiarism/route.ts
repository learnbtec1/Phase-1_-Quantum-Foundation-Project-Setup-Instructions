import { NextRequest, NextResponse } from "next/server";
import { initVectorDB } from "@/lib/ai/vectorDB";
import OpenAI from "openai";

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY! });

// Add GET handler for health check (if not already present)
export async function GET() {
  return NextResponse.json({ status: "Chat API is online. Use POST to chat.", endpoint: "/api/chat" });
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { text } = body;

    // الاتصال بسيرفر البايثون (نقطة النهاية check_plagiarism)
    const response = await fetch("http://127.0.0.1:8000/api/v1/assessment/check_plagiarism", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text }),
    });

    if (!response.ok) {
      throw new Error("Failed to connect to Python Plagiarism Service");
    }

    const data = await response.json();

    // إرجاع البيانات كما هي للواجهة
    return NextResponse.json(data);

  } catch (error: any) {
    console.error("Plagiarism Bridge Error:", error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}