import { NextRequest, NextResponse } from 'next/server';
import { accessSync, constants } from 'node:fs';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function exists(p: string): boolean {
  try {
    accessSync(p, constants.R_OK);
    return true;
  } catch {
    return false;
  }
}

async function pingReachable(url?: string, timeoutMs = 1800): Promise<boolean | undefined> {
  if (!url) return undefined;

  const tryOnce = async (method: 'HEAD' | 'GET') => {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), timeoutMs);
    try {
      const r = await fetch(url, {
        method,
        signal: ctrl.signal,
        headers: method === 'GET' ? { Range: 'bytes=0-0' } : undefined,
        cache: 'no-store',
      });
      return r.status > 0 && r.status < 500;
    } catch {
      return false;
    } finally {
      clearTimeout(t);
    }
  };

  const headOk = await tryOnce('HEAD');
  if (headOk) return true;
  return await tryOnce('GET');
}

export async function HEAD() {
  const reqId = randomUUID();
  return new NextResponse(null, {
    status: 200,
    headers: {
      'X-Request-ID': reqId,
      'Cache-Control': 'no-store',
    },
  });
}

export async function GET(req: NextRequest) {
  const reqId = randomUUID();
  const root = process.cwd();

  const audio = {
    hover: exists(join(root, 'public', 'audio', 'ui', 'hover.mp3')),
    hum: exists(join(root, 'public', 'audio', 'voices', 'furina', 'hum.mp3')),
    ambience: exists(join(root, 'public', 'audio', 'ambience', 'boardroom.mp3')),
  };

  const env = {
    CHAT_BACKEND_URL: !!process.env.CHAT_BACKEND_URL,
    TTS_BACKEND_URL: !!process.env.TTS_BACKEND_URL,
  };

  const base = process.env.HEALTH_BASE_URL || new URL(req.url).origin;

  const ritaUrl = process.env.RITA_URL || process.env.NEXT_PUBLIC_RITA_URL;
  const googleUrl = process.env.GOOGLE_REALTIME_URL || process.env.NEXT_PUBLIC_GOOGLE_REALTIME_URL;
  const geminiUrl = process.env.GEMINI_REALTIME_URL || process.env.NEXT_PUBLIC_GEMINI_REALTIME_URL;
  const dockerUrl = process.env.AVATAR_DOCKER_URL || process.env.NEXT_PUBLIC_AVATAR_DOCKER_URL;
  const azure3dUrl = process.env.AZURE3D_URL || process.env.NEXT_PUBLIC_AZURE3D_URL;

  const backendBase = process.env.BACKEND_URL || 'http://127.0.0.1:8000';

  const reach = {
    chat: await pingReachable(`${backendBase}/`),
    tts: await pingReachable(`${base}/api/tts`),
    ttsWithTiming: await pingReachable(`${base}/api/tts-with-timing`),
    rita: await pingReachable(ritaUrl),
    google: await pingReachable(googleUrl),
    gemini: await pingReachable(geminiUrl),
    docker: await pingReachable(dockerUrl),
    azure3d: await pingReachable(azure3dUrl),
  };

  return NextResponse.json(
    {
      ok: true,
      status: 'ok',
      time: new Date().toISOString(),
      timestamp: Date.now(),
      reqId,
      env,
      audio,
      reach,
    },
    {
      headers: {
        'X-Request-ID': reqId,
        'Cache-Control': 'no-store',
      },
    }
  );
}