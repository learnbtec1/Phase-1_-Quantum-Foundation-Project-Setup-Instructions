#!/usr/bin/env node
/**
 * Root package.json delegates dev/build/start to frontend/ — the only supported Next.js app.
 */
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '..');
const frontend = path.join(root, 'frontend');

const cmd = process.argv[2];
const allowed = new Set(['dev', 'build', 'start']);
if (!allowed.has(cmd)) {
  console.error('[run-canonical-frontend] Usage: node scripts/run-canonical-frontend.mjs <dev|build|start>');
  process.exit(1);
}

const isProd = process.env.NODE_ENV === 'production';
if (isProd || cmd === 'build' || cmd === 'start') {
  console.log('[Cogni] ACTIVE APP: frontend/ (production mode)');
} else {
  console.log('[Cogni] ACTIVE APP: frontend/ (development) — root Next app is not the production path');
}

/** Windows: `spawn('npm')` can throw EINVAL; delegate via cmd.exe. `cmd` is allowlisted above. */
const child =
  process.platform === 'win32'
    ? spawn('cmd.exe', ['/d', '/s', '/c', `npm run ${cmd}`], {
        cwd: frontend,
        stdio: 'inherit',
        env: process.env,
      })
    : spawn('npm', ['run', cmd], {
        cwd: frontend,
        stdio: 'inherit',
        env: process.env,
      });

child.on('exit', (code, signal) => {
  if (signal) process.kill(process.pid, signal);
  process.exit(code ?? 1);
});
