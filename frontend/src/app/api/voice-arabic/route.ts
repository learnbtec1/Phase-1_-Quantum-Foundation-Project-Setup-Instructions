/**
 * POST /api/voice-arabic
 * Body:    { text: string }
 * Returns: { audio: string }  — base64-encoded MP3 (browser AudioContext decodable)
 *
 * Uses OpenAI TTS (tts-1) — default voice aligns with Cogni (male-presenting), not Verona-era shimmer.
 * Falls back to a minimal silent MP3 if OPENAI_API_KEY is missing or upstream fails,
 * so V20 animations continue running without a hard error.
 */
import { NextRequest, NextResponse } from 'next/server';

const MAX_TEXT   = 4096;
const TTS_TIMEOUT = 20_000;

// Minimal valid silent MP3 (44 bytes) — ensures AudioContext.decodeAudioData succeeds
// even when real TTS is unavailable.
const SILENT_MP3_B64 =
  '//uQxAAAAAAAAAAAAAAAAAAAAAAAWGluZwAAAA8AAAACAAACcQCAgICAgICAgICAgICAgICAgICAgICAgI' +
  'CAgICAgICAgICAgICAgICAgICAgICAgICAgMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwM' +
  'DAwMDAwMDAwMDAwMDAwMDAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA' +
  'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA' +
  'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA==';

export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => ({}));
    const text = (body?.text ?? '').toString().trim().slice(0, MAX_TEXT);

    if (!text) {
      return NextResponse.json({ error: 'Empty text' }, { status: 400 });
    }

    const apiKey = process.env.OPENAI_API_KEY;
    /** OpenAI voices: onyx/echo = male-presenting; shimmer/nova = female (avoid for Cogni). */
    const openaiVoice = (process.env.OPENAI_TTS_VOICE || 'onyx').trim() || 'onyx';
    if (!apiKey) {
      console.warn('[voice-arabic] OPENAI_API_KEY not set — returning silent audio');
      return NextResponse.json({ audio: SILENT_MP3_B64 });
    }

    const controller = new AbortController();
    const timeoutId  = setTimeout(() => controller.abort(), TTS_TIMEOUT);

    let res: Response;
    try {
      res = await fetch('https://api.openai.com/v1/audio/speech', {
        method : 'POST',
        headers: {
          'Authorization': `Bearer ${apiKey}`,
          'Content-Type' : 'application/json',
        },
        body: JSON.stringify({
          model           : 'tts-1',
          voice           : openaiVoice,
          input           : text,
          response_format : 'mp3',
          speed           : 0.95,
        }),
        signal: controller.signal,
      });
    } catch (fetchErr) {
      clearTimeout(timeoutId);
      const isAbort = fetchErr instanceof Error && fetchErr.name === 'AbortError';
      console.error('[voice-arabic] fetch failed:', isAbort ? 'timeout' : fetchErr);
      return NextResponse.json({ audio: SILENT_MP3_B64 });
    }
    clearTimeout(timeoutId);

    if (!res.ok) {
      const errText = await res.text().catch(() => '');
      console.error(`[voice-arabic] OpenAI TTS error ${res.status}:`, errText.slice(0, 200));
      // Graceful fallback — let V20 show animation without audio
      return NextResponse.json({ audio: SILENT_MP3_B64 });
    }

    // Convert binary MP3 response → base64
    const arrayBuf = await res.arrayBuffer();
    const uint8    = new Uint8Array(arrayBuf);
    let binary = '';
    for (let i = 0; i < uint8.length; i++) binary += String.fromCharCode(uint8[i]);
    const base64 = btoa(binary);

    return NextResponse.json({ audio: base64 });

  } catch (err) {
    console.error('[voice-arabic] unexpected error:', err);
    return NextResponse.json({ audio: SILENT_MP3_B64 });
  }
}
