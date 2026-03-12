import { NextRequest, NextResponse } from 'next/server';

export const runtime = 'nodejs';

/** Fallback shape when the Python backend is unreachable */
const FALLBACK = {
  score: 0,
  detail: 'تعذّر الاتصال بخدمة التحليل. يرجى التحقق من تشغيل الخادم.',
  findings: { length: 0, note: 'backend_unavailable' },
};

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { text } = body;

    if (!text || typeof text !== 'string' || text.trim().length < 10) {
      return NextResponse.json(FALLBACK);
    }

    const backendUrl = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8000';
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 15000);

    try {
      const response = await fetch(`${backendUrl}/api/v1/assessment/check_plagiarism`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text }),
        signal: controller.signal,
      });
      clearTimeout(timer);

      if (!response.ok) {
        console.error('[Plagiarism] backend error', response.status);
        return NextResponse.json(FALLBACK);
      }

      const data = await response.json();
      return NextResponse.json(data);
    } catch (fetchErr: any) {
      clearTimeout(timer);
      console.error('[Plagiarism] fetch failed:', fetchErr.message);
      return NextResponse.json(FALLBACK);
    }

  } catch (error: any) {
    console.error('[Plagiarism] route error:', error);
    return NextResponse.json(FALLBACK);
  }
}