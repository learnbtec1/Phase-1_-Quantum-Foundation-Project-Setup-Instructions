/**
 * Unit tests for WebSocket URL resolution (run: npm run test:ws-url).
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  agentApiHealthUrlFromWsAgentUrl,
  agentWsSkippedByEnv,
  buildWsAgentUrlFromEnv,
  ipv4LoopbackWsUrl,
  readWsConnectTimeoutMs,
} from './wsAgentUrl.ts';

describe('ipv4LoopbackWsUrl', () => {
  it('maps localhost to 127.0.0.1 for ws', () => {
    assert.equal(
      ipv4LoopbackWsUrl('ws://localhost:8000/ws/agent'),
      'ws://127.0.0.1:8000/ws/agent',
    );
  });
  it('maps localhost to 127.0.0.1 for wss', () => {
    assert.equal(
      ipv4LoopbackWsUrl('wss://localhost/ws/agent'),
      'wss://127.0.0.1/ws/agent',
    );
  });
  it('leaves 127.0.0.1 unchanged', () => {
    assert.equal(
      ipv4LoopbackWsUrl('ws://127.0.0.1:8000/ws/agent'),
      'ws://127.0.0.1:8000/ws/agent',
    );
  });
});

describe('agentApiHealthUrlFromWsAgentUrl', () => {
  it('maps ws to http /api/health', () => {
    assert.equal(
      agentApiHealthUrlFromWsAgentUrl('ws://127.0.0.1:8000/ws/agent'),
      'http://127.0.0.1:8000/api/health',
    );
  });
  it('maps wss to https /api/health', () => {
    assert.equal(
      agentApiHealthUrlFromWsAgentUrl('wss://api.example.com/ws/agent'),
      'https://api.example.com/api/health',
    );
  });
});

describe('buildWsAgentUrlFromEnv priority', () => {
  it('prefers NEXT_PUBLIC_WS_URL over AGENT_WS and API_URL', () => {
    const url = buildWsAgentUrlFromEnv((k) =>
      ({
        NEXT_PUBLIC_WS_URL: 'ws://a:1/ws/agent',
        NEXT_PUBLIC_AGENT_WS: 'ws://b:2/ws/agent',
        NEXT_PUBLIC_API_URL: 'http://c:3',
      }[k]),
    );
    assert.equal(url, 'ws://a:1/ws/agent');
  });
  it('uses NEXT_PUBLIC_AGENT_WS when WS_URL unset', () => {
    const url = buildWsAgentUrlFromEnv((k) =>
      ({
        NEXT_PUBLIC_AGENT_WS: 'ws://legacy:8000/ws/agent',
        NEXT_PUBLIC_API_URL: 'http://ignored:8000',
      }[k]),
    );
    assert.equal(url, 'ws://legacy:8000/ws/agent');
  });
  it('derives from NEXT_PUBLIC_API_URL http → ws + /ws/agent', () => {
    const url = buildWsAgentUrlFromEnv((k) =>
      k === 'NEXT_PUBLIC_API_URL' ? 'http://127.0.0.1:8000' : undefined,
    );
    assert.equal(url, 'ws://127.0.0.1:8000/ws/agent');
  });
  it('derives https API → wss', () => {
    const url = buildWsAgentUrlFromEnv((k) =>
      k === 'NEXT_PUBLIC_API_URL' ? 'https://api.example.com' : undefined,
    );
    assert.equal(url, 'wss://api.example.com/ws/agent');
  });
  it('defaults when no env', () => {
    assert.equal(
      buildWsAgentUrlFromEnv(() => undefined),
      'ws://127.0.0.1:8000/ws/agent',
    );
  });
  it('strips trailing slash on explicit WS URL before use', () => {
    const url = buildWsAgentUrlFromEnv((k) =>
      k === 'NEXT_PUBLIC_WS_URL' ? 'ws://127.0.0.1:8000/ws/agent/' : undefined,
    );
    assert.equal(url, 'ws://127.0.0.1:8000/ws/agent');
  });
});

describe('agentApiHealthUrlFromWsAgentUrl edge', () => {
  it('falls back to default health URL on malformed ws URL', () => {
    assert.equal(
      agentApiHealthUrlFromWsAgentUrl('not-a-valid-url'),
      'http://127.0.0.1:8000/api/health',
    );
  });
});

describe('readWsConnectTimeoutMs', () => {
  it('clamps parsed env values', () => {
    const prev = process.env.NEXT_PUBLIC_WS_CONNECT_TIMEOUT_MS;
    process.env.NEXT_PUBLIC_WS_CONNECT_TIMEOUT_MS = '2500';
    assert.equal(readWsConnectTimeoutMs(), 2500);
    process.env.NEXT_PUBLIC_WS_CONNECT_TIMEOUT_MS = '500000';
    assert.equal(readWsConnectTimeoutMs(), 120000);
    process.env.NEXT_PUBLIC_WS_CONNECT_TIMEOUT_MS = '500';
    assert.equal(readWsConnectTimeoutMs(), 1500);
    if (prev === undefined) delete process.env.NEXT_PUBLIC_WS_CONNECT_TIMEOUT_MS;
    else process.env.NEXT_PUBLIC_WS_CONNECT_TIMEOUT_MS = prev;
  });
});

describe('agentWsSkippedByEnv', () => {
  it('recognizes common truthy strings', () => {
    const prev = process.env.NEXT_PUBLIC_SKIP_AGENT_WS;
    process.env.NEXT_PUBLIC_SKIP_AGENT_WS = 'true';
    assert.equal(agentWsSkippedByEnv(), true);
    process.env.NEXT_PUBLIC_SKIP_AGENT_WS = '0';
    assert.equal(agentWsSkippedByEnv(), false);
    if (prev === undefined) delete process.env.NEXT_PUBLIC_SKIP_AGENT_WS;
    else process.env.NEXT_PUBLIC_SKIP_AGENT_WS = prev;
  });
});
