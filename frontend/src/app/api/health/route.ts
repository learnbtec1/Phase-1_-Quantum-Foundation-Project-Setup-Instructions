import { NextRequest, NextResponse } from 'next/server';
import { accessSync, constants } from 'node:fs';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';

export const dynamic = 'force-dynamic';

function exists(p: string): boolean {
  try {
    accessSync(p, constants.R_OK);
    return true;
  } catch {
    return false;
  }
}

async function pingReachable(url: string, timeoutMs = 2000): Promise<boolean> {
  try {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), timeoutMs);
    const r = await fetch(url, { method: 'HEAD', signal: ctrl.signal });
    clearTimeout(t);
    return r.status < 500;
  } catch {
    return false;
  }
}

export async function GET(req: NextRequest) {
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
  const chatUrl = process.env.CHAT_BACKEND_URL;
  const ritaUrl = process.env.RITA_URL || process.env.NEXT_PUBLIC_RITA_URL;
  const googleUrl = process.env.GOOGLE_REALTIME_URL || process.env.NEXT_PUBLIC_GOOGLE_REALTIME_URL;
  const geminiUrl = process.env.GEMINI_REALTIME_URL || process.env.NEXT_PUBLIC_GEMINI_REALTIME_URL;
  const dockerUrl = process.env.AVATAR_DOCKER_URL || process.env.NEXT_PUBLIC_AVATAR_DOCKER_URL;
  const azure3dUrl = process.env.AZURE3D_URL || process.env.NEXT_PUBLIC_AZURE3D_URL;

  const backendBase = process.env.NEXT_PUBLIC_API_URL || 'http://127.0.0.1:8000';
  let reach: {
    chat?: boolean;
    tts?: boolean;
    ttsWithTiming?: boolean;
    rita?: boolean;
    google?: boolean;
    gemini?: boolean;
    docker?: boolean;
    azure3d?: boolean;
  } = {};
  try {
    reach = {
      chat: await pingReachable(`${backendBase}/`),
      tts: await pingReachable(`${base}/api/tts`),
      ttsWithTiming: await pingReachable(`${base}/api/tts-with-timing`),
      rita: ritaUrl ? await pingReachable(ritaUrl) : undefined,
      google: googleUrl ? await pingReachable(googleUrl) : undefined,
      gemini: geminiUrl ? await pingReachable(geminiUrl) : undefined,
      docker: dockerUrl ? await pingReachable(dockerUrl) : undefined,
      azure3d: azure3dUrl ? await pingReachable(azure3dUrl) : undefined,
    };
  } catch {
    /* non-fatal */
  }

  const reqId = randomUUID();
  return NextResponse.json({
    ok: true,
    status: 'ok',
    time: new Date().toISOString(),
    timestamp: Date.now(),
    reqId,
    env,
    audio,
    reach,
  }, {
    headers: { 'X-Request-ID': reqId },
  });
}
