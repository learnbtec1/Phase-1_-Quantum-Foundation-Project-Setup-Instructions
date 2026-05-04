#!/usr/bin/env node
/**
 * Probes FastAPI via GET `http://127.0.0.1:<port>/api/health` (canonical dev port **8000**),
 * updates `.env.local` with NEXT_PUBLIC_API_URL, CHAT_BACKEND_URL, TTS_BACKEND_URL.
 * Preserves existing keys (ELEVENLABS, OPENAI, etc.); only updates backend URLs.
 *
 * Default Compose publishes the agent API on host **8000** (`backend` → `8000:8000`).
 */
const fs = require('fs');
const path = require('path');

const PORTS = [8000];
const TIMEOUT_MS = 2000;

function probe(port) {
  return new Promise((resolve) => {
    const http = require('http');
    const opts = {
      hostname: '127.0.0.1',
      port,
      path: '/api/health',
      method: 'GET',
      timeout: TIMEOUT_MS,
    };
    const req = http.request(opts, (res) => {
      res.resume();
      if (res.statusCode === 200) resolve(port);
      else resolve(null);
    });
    req.on('error', () => resolve(null));
    req.on('timeout', () => {
      req.destroy();
      resolve(null);
    });
    req.setTimeout(TIMEOUT_MS);
    req.end();
  });
}

async function main() {
  let port = null;
  for (const p of PORTS) {
    port = await probe(p);
    if (port) break;
  }
  port = port || 8000;
  const base = `http://127.0.0.1:${port}`;
  const envPath = path.join(__dirname, '..', '.env.local');
  let content = '';
  if (fs.existsSync(envPath)) {
    content = fs.readFileSync(envPath, 'utf8');
  }
  const updates = {
    NEXT_PUBLIC_API_URL: base,
    CHAT_BACKEND_URL: `${base}/api/v1/chat`,
    TTS_BACKEND_URL: `${base}/api/v1/tts-with-timing`,
  };
  const lines = content.split('\n');
  const seen = new Set();
  const out = [];
  for (const line of lines) {
    const eq = line.indexOf('=');
    const key = eq >= 0 ? line.slice(0, eq).trim() : '';
    if (key && updates[key] !== undefined) {
      if (!seen.has(key)) {
        out.push(`${key}=${updates[key]}`);
        seen.add(key);
      }
      continue;
    }
    out.push(line);
  }
  for (const [k, v] of Object.entries(updates)) {
    if (!seen.has(k)) out.push(`${k}=${v}`);
  }
  fs.writeFileSync(envPath, out.join('\n').trimEnd() + '\n');
  console.log('Backend env synced: port', port);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
