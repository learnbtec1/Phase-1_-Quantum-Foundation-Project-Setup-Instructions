import { NextRequest } from 'next/server';

import { getBearerTokenFromRequest } from '../evaluate/_auth';

export const runtime = 'nodejs';
export const maxDuration = 60;

/**
 * POST /api/extract-text
 * Proxies file(s) to the FastAPI backend for server-side text extraction.
 * Uses python-docx which correctly reads table content (unlike client-side mammoth).
 */
export async function POST(req: NextRequest) {
  try {
    const token = getBearerTokenFromRequest(req);
    if (!token) {
      return new Response(
        JSON.stringify({ detail: 'يجب تسجيل الدخول لاستخراج النص.' }),
        { status: 401, headers: { 'Content-Type': 'application/json' } },
      );
    }

    const formData = await req.formData();
    const backendUrl = process.env.BACKEND_URL || 'http://127.0.0.1:8000';

    const backendRes = await fetch(`${backendUrl}/api/v1/assessment/extract-text`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}` },
      body: formData,
    });

    const json = await backendRes.json();

    return new Response(JSON.stringify(json), {
      status: backendRes.status,
      headers: { 'Content-Type': 'application/json' },
    });
  } catch (err: any) {
    return new Response(
      JSON.stringify({ detail: `فشل استخراج النص: ${err?.message || err}` }),
      { status: 500, headers: { 'Content-Type': 'application/json' } }
    );
  }
}
