#!/usr/bin/env node
/**
 * Non-interactive sanity checks for root .env + Docker Compose interpolation.
 * Does not substitute for browser AudioContext/TTS audition — reports what is machine-verifiable.
 *
 * Usage (repo root):
 *   node scripts/check-dev-env.mjs
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execSync } from 'node:child_process';
import http from 'node:http';
import https from 'node:https';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');

/** @typedef {{ duplicates: Record<string, number[]>, keys: Record<string, { value: string, line: number }> }} ParsedEnv */
function parseDotEnv(relPath) {
  /** @type {ParsedEnv} */
  const out = { duplicates: {}, keys: {} };
  const full = path.join(ROOT, relPath);
  if (!fs.existsSync(full)) return { ...out, _missingFile: full };
  const raw = fs.readFileSync(full, 'utf8').replace(/^\uFEFF/, '');
  const lines = raw.split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    const num = i + 1;
    const rawLine = lines[i];
    const trimmed = rawLine.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const strippedExport = trimmed.replace(/^export\s+/i, '');
    const eq = strippedExport.indexOf('=');
    if (eq <= 0) continue;
    const keyPart = strippedExport.slice(0, eq).trim();
    if (keyPart.includes('#') || !/^([A-Za-z_][\w]*)$/.test(keyPart)) continue;
    let valPart = strippedExport.slice(eq + 1).trim();
    valPart = stripInlineComment(valPart);
    valPart = stripQuotes(valPart);
    const prev = out.keys[keyPart];
    if (prev !== undefined) {
      if (!out.duplicates[keyPart]) out.duplicates[keyPart] = [prev.line];
      out.duplicates[keyPart].push(num);
    }
    out.keys[keyPart] = { value: valPart, line: num };
  }
  return out;
}

function stripQuotes(s) {
  if ((s.startsWith('"') && s.endsWith('"')) || (s.startsWith("'") && s.endsWith("'")))
    return s.slice(1, -1).trim();
  return s;
}

/** Remove trailing `# comment` outside simple quotes — good enough for dev checks. */
function stripInlineComment(s) {
  const i = findUnquotedHash(s);
  if (i < 0) return s.trim();
  return s.slice(0, i).trim().replace(/\s+$/, '');
}

function findUnquotedHash(s) {
  let q = '';
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if ((c === '"' || c === "'") && s[i - 1] !== '\\') {
      if (!q) q = c;
      else if (q === c) q = '';
    } else if (c === '#' && !q) return i;
  }
  return -1;
}

function httpGetHealth(urlStr) {
  return new Promise((resolve) => {
    let u;
    try {
      u = new URL(urlStr);
    } catch {
      resolve({ ok: false, detail: `bad URL ${urlStr}` });
      return;
    }
    const proto = u.protocol;
    if (proto !== 'http:' && proto !== 'https:') {
      resolve({ ok: false, detail: `unsupported protocol ${proto}` });
      return;
    }
    const lib = proto === 'https:' ? https : http;
    const port = u.port || (proto === 'https:' ? 443 : 80);
    const pathQuery = `${u.pathname || '/'}${u.search}`;
    const req = lib.request(
      { hostname: u.hostname, port, path: pathQuery, method: 'GET', timeout: 8000 },
      (res) => {
        res.resume?.();
        const ok = res.statusCode === 200;
        resolve({
          ok,
          statusCode: res.statusCode,
          detail: ok ? undefined : `HTTP ${res.statusCode}`,
        });
      },
    );
    req.on('error', (e) => resolve({ ok: false, detail: String(e.message) }));
    req.on('timeout', () => {
      req.destroy();
      resolve({ ok: false, detail: 'timeout' });
    });
    req.end();
  });
}

function pickApiBase(keys) {
  const pub = keys.NEXT_PUBLIC_API_URL?.value?.trim();
  if (pub) return pub.replace(/\/$/, '');
  return 'http://127.0.0.1:8000';
}

async function main() {
  console.log('[check-dev-env] Root:', ROOT);
  let exit = 0;
  /** @type {string[]} */
  const reasons = [];
  /** @type {string[]} */
  const warnings = [];

  const env = parseDotEnv('.env');
  if (env._missingFile) {
    exit = 1;
    reasons.push(`Missing file: ${path.relative(ROOT, env._missingFile)}`);
  }
  /** @type {Record<string,{value:string,line:number}>} */
  const keys = env.keys || {};

  const dupEntries = Object.entries(env.duplicates || {}).filter(([, lines]) => (lines?.length ?? 0) >= 1);
  if (dupEntries.length) {
    exit = 1;
    dupEntries.forEach(([k, lines]) => {
      reasons.push(`Duplicate KEY ${k} on lines ${[...new Set(lines)].sort((a,b)=>a-b).join(', ')} (last occurrence wins per typical dotenv loaders)`);
      console.warn('[check-dev-env]', reasons[reasons.length - 1]);
    });
  }

  const jwt = keys.JWT_SECRET?.value?.trim();
  if (!jwt && !env._missingFile) {
    exit = 1;
    reasons.push('JWT_SECRET is empty — docker-compose requires it (${JWT_SECRET:?}).');
    console.error('[check-dev-env]', reasons[reasons.length - 1]);
  }

  const ttsPub = keys.NEXT_PUBLIC_TTS_PROVIDER?.value?.trim().toLowerCase() || 'edge';
  const ttsBack = keys.TTS_PROVIDER?.value?.trim().toLowerCase() || '';

  const elPub = !!(keys.ELEVENLABS_API_KEY?.value?.trim() && keys.ELEVENLABS_VOICE_ID?.value?.trim());
  if ((ttsPub === 'elevenlabs' || ttsBack === 'elevenlabs') && !elPub) {
    exit = 1;
    reasons.push('ElevenLabs provider selected but ELEVENLABS_API_KEY and/or ELEVENLABS_VOICE_ID missing in root .env');
    console.error('[check-dev-env]', reasons[reasons.length - 1]);
  }

  /** Effective agent WS browser uses (`NEXT_PUBLIC_WS_URL` beats `NEXT_PUBLIC_AGENT_WS`; see frontend `wsAgentUrl.ts`). */
  const wsExplicit =
    keys.NEXT_PUBLIC_WS_URL?.value?.trim() || keys.NEXT_PUBLIC_AGENT_WS?.value?.trim() || '';
  const ws = wsExplicit;
  if (ws) {
    try {
      const u = new URL(ws);
      if (!['ws:', 'wss:'].includes(u.protocol)) {
        exit = 1;
        reasons.push(`NEXT_PUBLIC_WS_URL protocol must be ws: or wss:, got ${u.protocol}`);
      }
      const pn = u.pathname.replace(/\/$/, '') || '/';
      if (!pn.endsWith('/ws/agent')) {
        warnings.push(`WS pathname should normally end with /ws/agent — got ${u.pathname}`);
      }
      const pubApi = keys.NEXT_PUBLIC_API_URL?.value?.trim();
      if (pubApi && pn.endsWith('/ws/agent')) {
        try {
          const httpU = new URL(pubApi.includes('://') ? pubApi : `http://${pubApi}`);
          const sameLoopback =
            u.hostname.replace(/^127\.0\.0\.1$/, 'localhost') ===
            httpU.hostname.replace(/^127\.0\.0\.1$/, 'localhost');
          if (
            pn.endsWith('/ws/agent') &&
            u.port &&
            httpU.port &&
            u.port !== httpU.port &&
            sameLoopback
          ) {
            warnings.push(
              `NEXT_PUBLIC_WS_URL uses port ${u.port} but NEXT_PUBLIC_API_URL uses ${httpU.port}; /ws/agent should match FastAPI.`,
            );
          }
        } catch {
          /* ignore */
        }
      }
      if (u.port === '8001') {
        exit = 1;
        reasons.push(
          `NEXT_PUBLIC_WS_URL uses port 8001 for /ws/agent — wrong for default Docker (FastAPI is :8000; avatar kinematic WS is typically :8011 with a different path). Fix .env.`,
        );
        console.error('[check-dev-env]', reasons[reasons.length - 1]);
      }
    } catch {
      exit = 1;
      reasons.push(`Invalid NEXT_PUBLIC_WS_URL / AGENT_WS: ${ws}`);
    }
    if (
      (/\bdocker\b/.test(ws) || /\bbackend\b/.test(ws)) &&
      !/127\.0\.0\.1|localhost/i.test(ws)
    ) {
      warnings.push('WS URL may use a hostname the browser cannot resolve (use published host/LAN IP).');
    }
  }

  const apiUrlWrong8001 =
    keys.NEXT_PUBLIC_API_URL?.value &&
    /\b:8001(\/|$)/.test(keys.NEXT_PUBLIC_API_URL.value.replace(/\s+/g, ''));
  if (apiUrlWrong8001) {
    exit = 1;
    reasons.push(
      `NEXT_PUBLIC_API_URL uses port 8001 — usually wrong (Compose publishes FastAPI backend on host :8000, not :8001).`,
    );
    console.error('[check-dev-env]', reasons[reasons.length - 1]);
  }

  console.log('[check-dev-env] docker compose config validation...');
  try {
    execSync('docker compose config', {
      cwd: ROOT,
      stdio: env._missingFile ? 'pipe' : 'pipe',
      shell: true,
      encoding: 'utf8',
    });
    console.log('[check-dev-env]', 'docker compose config — OK');
  } catch (e) {
    exit = 1;
    const msg =
      typeof e.stderr === 'string' ? e.stderr.slice(0, 400)
      : typeof e.message === 'string' ? e.message
      : String(e);
    reasons.push(`docker compose config failed: ${msg}`);
    console.error('[check-dev-env]', reasons[reasons.length - 1]);
    if (!env._missingFile && /JWT_SECRET/.test(msg))
      reasons.push('Hint: set JWT_SECRET in root .env for compose substitution');
  }

  try {
    const txt = execSync('docker compose ps --status running', {
      cwd: ROOT,
      shell: true,
      encoding: 'utf8',
    }).trim();
    if (txt) {
      const lines = txt.split(/\r?\n/).filter(Boolean);
      console.log('[check-dev-env] docker compose ps (running):');
      console.log(lines.slice(0, 12).join('\n'));
    } else console.warn('[check-dev-env] No running compose services — start stack first');
  } catch {
    console.warn('[check-dev-env] docker compose ps failed (daemon down or compose not applied)');
  }

  const apiBase = pickApiBase(keys);
  console.log('[check-dev-env] Probing GET', `${apiBase}/api/health`);
  const probe = await httpGetHealth(`${apiBase}/api/health`);
  if (!probe.ok) {
    console.warn('[check-dev-env] API health FAILED', probe.detail ?? probe.statusCode);
    const canon = await httpGetHealth('http://127.0.0.1:8000/api/health');
    if (canon.ok && apiBase.replace(/\/$/, '') !== 'http://127.0.0.1:8000') {
      reasons.push(
        `Configured NEXT_PUBLIC_API_URL (${apiBase}) has no OK /api/health but http://127.0.0.1:8000/api/health works — align NEXT_PUBLIC_* with Docker publish port (typically 8000).`,
      );
      console.warn('[check-dev-env]', reasons[reasons.length - 1]);
    } else if (!canon.ok) {
      reasons.push(`API health unreachable at ${apiBase}/api/health (${JSON.stringify(probe)})`);
    }
    exit = 1;
  } else {
    console.log('[check-dev-env]', 'API health — OK');
  }

  console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  warnings.forEach((w) => console.warn('[check-dev-env] WARNING:', w));

  if (exit === 1) {
    console.log('FINAL: FAILURE');
    reasons.forEach((r) => console.log(' ROOT CAUSE:', r));
    process.exit(1);
  }

  console.log(
    'FINAL: SUCCESS — Automated ENV / compose / HTTP checks passed (audit WebSocket handshake + audible TTS in browser manually)',
  );
  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  console.log('\nFINAL: FAILURE — check script crashed');
  process.exit(1);
});
