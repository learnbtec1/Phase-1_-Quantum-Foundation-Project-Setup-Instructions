import { NextRequest, NextResponse } from 'next/server';

export const runtime = 'nodejs';

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { text } = body;

    const backendUrl = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8000';
    const response = await fetch(`${backendUrl}/api/v1/assessment/check_plagiarism`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text })
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