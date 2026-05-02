/**
 * Guard: avatar VRMA mixer must delegate motion authority sync so IDLE/procedural layers
 * are not indefinitely blocked after a clip completes.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const VRMA_PLAYER = path.join(__dirname, '..', 'app', 'avatar-agent', 'VRMAPlayer.tsx');

test('VRMAPlayer calls syncMotionAuthorityFromVrma when driving mixer', () => {
  const src = fs.readFileSync(VRMA_PLAYER, 'utf8');
  assert.ok(src.includes('syncMotionAuthorityFromVrma'), 'expected VRMA ↔ authority sync');
});

const USE_AGENT = path.join(__dirname, '..', 'hooks', 'useAgentAgent.ts');

test('useAgentAgent routes WS payload through stable frame ref pattern', () => {
  const src = fs.readFileSync(USE_AGENT, 'utf8');
  assert.ok(src.includes('handleFrameRef'), 'stable WS handler ref');
  assert.ok(
    /\bconnect\s*=\s*useCallback[\s\S]*?\[wsUrlProp,\s*autoReconnect\]/s.test(src),
    'connect should not depend on handleFrame identity',
  );
});
