#!/usr/bin/env node
/**
 * Self-healing dev orchestration for this repo (Windows + Docker Desktop/WSL workflows).
 *
 * Usage (repo root):
 *   node scripts/recover-dev-env.js
 *   node scripts/recover-dev-env.js --fast
 *   node scripts/recover-dev-env.js --no-wsl --no-docker-restart --no-frontend --no-ws-probe
 *   RECOVER_WS_URL=ws://127.0.0.1:8000/ws/agent RECOVER_STRICT_WS=1 node scripts/recover-dev-env.js
 *   npm run recover:dev   (same as bare script)
 *
 * --fast — skip WSL, Docker Desktop restart, pull, compose & WS probe; only free :3000 then npm run dev.
 *
 * Requires optional devDependency `ws` for WebSocket probing (npm install -D ws). Use --no-ws-probe to skip.
 */
'use strict';

const fs = require('fs');
const path = require('path');
const { execSync, spawnSync } = require('child_process');

const ROOT = path.resolve(__dirname, '..');

/** Safer LISTEN row match for IPv4 `:3000 ` and `[::]:3000 ` columns (digit-precise heuristic removed). */
const NETSTAT_LOCAL_PORT_COLON3000 = /:3000\s/;

function parseArgs(argv) {
  const a = argv.slice(2);
  return {
    fast: a.includes('--fast'),
    noWsl: a.includes('--no-wsl'),
    noDockerRestart: a.includes('--no-docker-restart'),
    noFrontend: a.includes('--no-frontend'),
    noWsProbe: a.includes('--no-ws-probe'),
    help: a.includes('--help') || a.includes('-h'),
  };
}

function printHelp() {
  console.log(`
recover-dev-env.js — Cogni stack recovery

Options:
  --fast               Skip WSL, Docker restart, redis pull, compose, WS probe — only kill :3000 + npm run dev
  --no-wsl             Skip wsl --shutdown
  --no-docker-restart  Skip killing / starting Docker Desktop (still runs docker readiness check)
  --no-frontend        Skip npm run dev (compose + probes only); exits 0 on success
  --no-ws-probe        Skip WebSocket handshake probe (needs devDependency ws)
  -h, --help           Show this help

Env:
  RECOVER_WS_URL        Override WS URL for probe (else NEXT_PUBLIC_WS_URL or frontend/.env*)
  RECOVER_STRICT_WS     unset or 1 → probe failure exits 1. Set to 0 | false | off | no to warn-only.

Repo root: ${ROOT}
`);
}

function delay(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

/**
 * Shell command; cwd defaults to ROOT.
 * @returns {boolean}
 */
function run(cmd, label, opts = {}) {
  const { cwd = ROOT, allowFail = false } = opts;
  try {
    console.log(`\n🟡 ${label}...`);
    execSync(cmd, { stdio: 'inherit', cwd, shell: true });
    console.log(`🟢 ${label} — SUCCESS`);
    return true;
  } catch (err) {
    console.error(`🔴 ${label} — FAILED`);
    console.error(err instanceof Error ? err.message : String(err));
    if (!allowFail) return false;
    return false;
  }
}

function killPort3000() {
  console.log('\n🟡 Freeing port 3000...');
  try {
    execSync('npm run clean:port', { stdio: 'inherit', cwd: ROOT, shell: true });
    console.log('🟢 Port 3000 — cleanup attempted (clean:port)');
    return;
  } catch {
    /* npx/network may fail */
  }

  try {
    const output = execSync('netstat -ano', {
      encoding: 'utf8',
      shell: true,
    });
    const pids = new Set();
    for (const raw of output.split(/\r?\n/)) {
      const line = raw.trim();
      if (!/LISTENING/.test(line)) continue;
      if (!NETSTAT_LOCAL_PORT_COLON3000.test(line)) continue;
      const parts = line.split(/\s+/).filter(Boolean);
      const pid = parts[parts.length - 1];
      if (pid && /^\d+$/.test(pid)) pids.add(pid);
    }
    if (pids.size === 0) {
      console.log('🟢 Port 3000 — nothing listening (netstat + :3000\\s heuristic)');
      return;
    }
    for (const pid of pids) {
      console.log(`🔥 taskkill PID ${pid}`);
      try {
        execSync(`taskkill /PID ${pid} /F`, { stdio: 'inherit', shell: true });
      } catch {
        console.warn(`🟠 Could not kill PID ${pid} (already gone?)`);
      }
    }
    console.log('🟢 Port 3000 — netstat/taskkill sweep done');
  } catch {
    console.log('🟢 Port 3000 — skipped (could not enumerate netstat)');
  }
}

function restartWSL() {
  if (process.platform !== 'win32') {
    console.log('\n🟠 Skipping WSL shutdown (not Windows).');
    return;
  }
  try {
    console.log('\n🟡 Shutting down WSL (wsl --shutdown)...');
    execSync('wsl --shutdown', { stdio: 'inherit', shell: true });
    console.log('🟢 WSL shutdown — SUCCESS');
  } catch (err) {
    console.warn(
      '🟠 wsl --shutdown failed (ignored if WSL disabled):',
      err instanceof Error ? err.message : err,
    );
  }
}

function dockerDesktopExe() {
  const pf = process.env.ProgramFiles || 'C:\\Program Files';
  return path.join(pf, 'Docker', 'Docker', 'Docker Desktop.exe');
}

function restartDockerDesktop() {
  if (process.platform !== 'win32') {
    console.log('\n🟠 Skipping Docker Desktop restart (not Windows).');
    return;
  }
  const exe = dockerDesktopExe();
  console.log('\n🟡 Restarting Docker Desktop...');
  try {
    execSync('taskkill /IM "Docker Desktop.exe" /F', {
      stdio: 'pipe',
      shell: true,
    });
  } catch {
    /* not running */
  }
  if (!fs.existsSync(exe)) {
    console.warn(`🟠 Docker Desktop not found at: ${exe} — start it manually`);
    return;
  }
  try {
    spawnSync(exe, [], {
      cwd: ROOT,
      detached: true,
      stdio: 'ignore',
      windowsHide: false,
      shell: false,
    });
    console.log('🟢 Docker Desktop — start triggered');
  } catch (err) {
    console.warn(
      '🟠 Could not start Docker Desktop automatically:',
      err instanceof Error ? err.message : err,
    );
    console.warn('   Open Docker Desktop manually, then rerun.');
  }
}

/** Silent docker info check (polling). */
function dockerInfoQuiet() {
  try {
    execSync('docker info', { stdio: 'ignore', shell: true, cwd: ROOT });
    return true;
  } catch {
    return false;
  }
}

/**
 * Retry until daemon answers `docker info` (used after restarting Docker Desktop).
 */
async function waitForDockerReady(label, opts = {}) {
  const maxAttempts = opts.maxAttempts ?? (opts.afterRestart ? 40 : 12);
  const intervalMs = opts.intervalMs ?? 2000;

  console.log(`\n⏳ ${label} (${maxAttempts} attempts × ${intervalMs / 1000}s)...`);
  for (let i = 0; i < maxAttempts; i++) {
    if (dockerInfoQuiet()) {
      console.log(`🟢 Docker daemon ready — attempt ${i + 1}/${maxAttempts}`);
      return true;
    }
    await delay(intervalMs);
  }
  console.error(`🔴 Docker daemon not ready — gave up after ${maxAttempts} attempts`);
  return false;
}

/** Verbose `docker info` for human debugging. */
function verifyDockerVerbose() {
  console.log('\n🟡 Docker Engine sanity (docker info, verbose)...');
  try {
    execSync('docker info', { stdio: 'inherit', cwd: ROOT, shell: true });
    console.log('🟢 Docker Engine — reachable');
    return true;
  } catch (err) {
    console.error('🔴 Docker Engine — unreachable');
    console.error(err instanceof Error ? err.message : String(err));
    return false;
  }
}

function readWsUrlFromDotEnv(relPath) {
  const full = path.join(ROOT, relPath);
  if (!fs.existsSync(full)) return null;
  const text = fs.readFileSync(full, 'utf8');
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.replace(/\uFEFF/g, '').trim();
    let m =
      /^NEXT_PUBLIC_WS_URL\s*=\s*(.*)$/i.exec(line) ??
      /^export\s+NEXT_PUBLIC_WS_URL\s*=\s*(.*)$/i.exec(line);
    if (!m)
      m =
        /^NEXT_PUBLIC_AGENT_WS\s*=\s*(.*)$/i.exec(line) ??
        /^export\s+NEXT_PUBLIC_AGENT_WS\s*=\s*(.*)$/i.exec(line);
    if (!m) continue;
    let v = (m[1] ?? '').trim().replace(/^['"]/, '').replace(/['"]+$/, '').trim();
    const hash = v.indexOf('#');
    if (hash >= 0) v = v.slice(0, hash).trim().replace(/\s*$/, '');
    if (v.length > 5) return v;
  }
  return null;
}

function resolveWsAgentUrlForProbe() {
  const fromEnv = (
    process.env.RECOVER_WS_URL ||
    process.env.NEXT_PUBLIC_WS_URL ||
    process.env.NEXT_PUBLIC_AGENT_WS ||
    ''
  ).trim();
  if (fromEnv) return fromEnv;
  const fromFrontend =
    readWsUrlFromDotEnv(path.join('frontend', '.env.local')) ||
    readWsUrlFromDotEnv(path.join('frontend', '.env')) ||
    readWsUrlFromDotEnv(path.join('.env.local')) ||
    readWsUrlFromDotEnv('.env');
  if (fromFrontend) return fromFrontend;
  return 'ws://127.0.0.1:8000/ws/agent';
}

async function probeAgentWebSocketOnce(wsUrl, timeoutMs) {
  let WebSocketCtor;
  try {
    WebSocketCtor = require('ws');
  } catch {
    return 'no_ws_pkg';
  }

  return await new Promise((resolve) => {
    let settled = false;
    const ws = new WebSocketCtor(wsUrl, { handshakeTimeout: timeoutMs });
    const tid = setTimeout(() => {
      if (settled) return;
      settled = true;
      try {
        ws.terminate();
      } catch {
        try {
          ws.close();
        } catch {
          /* */
        }
      }
      resolve('timeout');
    }, timeoutMs + 750);

    const done = (v) => {
      if (settled) return;
      settled = true;
      clearTimeout(tid);
      resolve(v);
    };

    ws.once('open', () => {
      try {
        ws.close();
      } catch {
        /* */
      }
      done('ok');
    });
    ws.once('error', () => done('error'));
  });
}

async function probeAgentWebSocketWithRetries(wsUrl, opts = {}) {
  const attempts = opts.attempts ?? 6;
  const perTryMs = opts.perTryMs ?? 5500;
  const gapMs = opts.gapMs ?? 2000;

  console.log(`\n🟡 WebSocket probe (${attempts} tries): ${wsUrl}`);

  for (let i = 0; i < attempts; i++) {
    const r = await probeAgentWebSocketOnce(wsUrl, perTryMs);
    if (r === 'no_ws_pkg') {
      console.warn(
        '🟠 WebSocket probe skipped — optional devDependency missing. Run from repo root: npm install -D ws',
      );
      return 'skipped';
    }
    if (r === 'ok') {
      console.log(`🟢 WebSocket handshake OK (attempt ${i + 1}/${attempts})`);
      return 'ok';
    }
    console.warn(
      `🟠 WebSocket attempt ${i + 1}/${attempts} — ${r} (daemon or auth may still be warming up)`,
    );
    if (i < attempts - 1) await delay(gapMs);
  }
  console.error('🔴 WebSocket probe FAILED after all retries');
  return 'failed';
}

function composePs() {
  run('docker compose ps', 'Docker Compose — status (compose ps)', { allowFail: true });
}

/** Blocks until dev server exits. */
function startFrontendBlocking() {
  console.log('\n🚀 Starting Next.js (watch mode) via npm run dev — frontend/ canonical app');
  console.log('   Repo root cwd. Ctrl+C stops the server.\n');
  let r;
  if (process.platform === 'win32') {
    r = spawnSync('cmd.exe', ['/d', '/s', '/c', 'npm run dev'], {
      cwd: ROOT,
      stdio: 'inherit',
      env: process.env,
    });
  } else {
    r = spawnSync('npm', ['run', 'dev'], {
      cwd: ROOT,
      stdio: 'inherit',
      env: process.env,
      shell: true,
    });
  }
  const code = typeof r.status === 'number' ? r.status : 0;
  process.exit(code);
}

async function main() {
  const args = parseArgs(process.argv);

  if (args.help) {
    printHelp();
    process.exit(0);
  }

  const fail = [];

  console.log('\n🔧 Self-healing dev environment — Cogni recover-dev-env\n');

  if (args.fast) {
    console.log('\n⚡ FAST mode — compose / Docker orchestration skipped\n');
    killPort3000();
    if (args.noFrontend) {
      console.log('\n📋 FINAL STATUS: SUCCESS (--fast --no-frontend)\n');
      process.exit(0);
    }
    startFrontendBlocking();
    return;
  }

  killPort3000();

  if (!args.noWsl) {
    restartWSL();
    console.log('\n⏳ WSL settle pause (3s)...');
    await delay(3000);
  }

  if (!args.noDockerRestart && process.platform === 'win32') {
    restartDockerDesktop();
    const okDaemon = await waitForDockerReady('Waiting for Docker daemon after Desktop restart', {
      afterRestart: true,
      maxAttempts: 40,
      intervalMs: 2000,
    });
    if (!okDaemon) {
      console.error('\n❌ FINAL STATUS: FAILURE — Docker daemon not ready');
      process.exit(1);
    }
  } else {
    console.log('\n⏳ Checking existing Docker daemon (no Desktop restart)');
    const okExisting = await waitForDockerReady('Waiting for Docker daemon', {
      afterRestart: false,
      maxAttempts: 14,
      intervalMs: 1500,
    });
    if (!okExisting) {
      console.error('\n❌ FINAL STATUS: FAILURE — Docker unreachable');
      process.exit(1);
    }
  }

  if (!verifyDockerVerbose()) {
    console.error('\n❌ FINAL STATUS: FAILURE — docker info failed');
    process.exit(1);
  }

  if (!run('docker pull redis:7-alpine', 'Pull Redis image (compose dependency)')) {
    fail.push('redis_pull');
    console.warn('🟠 Continuing — compose may still pull deps');
  }

  if (!run('docker compose up -d --build', 'Docker Compose up -d --build')) {
    console.error('\n❌ FINAL STATUS: FAILURE — docker compose failed');
    process.exit(1);
  }

  composePs();

  console.log('\n⏳ Post-compose pause (5s)...');
  await delay(5000);

  composePs();

  if (!args.noWsProbe) {
    /** Default strict probe (exit 1 on failure): RECOVER_STRICT_WS unset. Set RECOVER_STRICT_WS=0 to warn-only. */
    const rawStrict = process.env.RECOVER_STRICT_WS;
    const strictWs =
      rawStrict === undefined || String(rawStrict).trim() === ''
        ? true
        : !/^(0|false|no|off)$/i.test(String(rawStrict).trim());

    const url = resolveWsAgentUrlForProbe();
    const probed = await probeAgentWebSocketWithRetries(url);

    if (probed === 'failed' && strictWs) {
      console.error('\n❌ FINAL STATUS: FAILURE — WebSocket probe');
      console.error(`   Hint: RECOVER_WS_URL or fix backend /guest auth / NEXT_PUBLIC_WS_URL (tried ${url})`);
      process.exit(1);
    }
    if (probed === 'failed') {
      console.warn('\n⚠ RECOVER_STRICT_WS unset/false — continuing despite WS failure');
    }
    if (probed === 'skipped') fail.push('ws_probe_skipped');
  }

  if (args.noFrontend) {
    console.log('\n📋 FINAL STATUS: SUCCESS (stack ready; frontend not started)');
    console.log('   Next: npm run dev → http://localhost:3000\n');
    if (fail.length) console.warn('   Minor warnings:', fail.join(', '), '\n');
    process.exit(0);
  }

  console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('📋 Pre-flight summary: SUCCESS — launching dev UI');
  if (fail.length) console.warn('   Minor warnings:', fail.join(', '));
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

  startFrontendBlocking();
}

main().catch((e) => {
  console.error(e && e.stack ? e.stack : e);
  process.exit(1);
});
