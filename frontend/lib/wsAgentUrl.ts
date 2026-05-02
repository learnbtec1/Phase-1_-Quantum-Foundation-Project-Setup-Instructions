/**
 * Shared WebSocket URL for `/ws/agent` (browser + useAgentAgent).
 *
 * Resolution order: `NEXT_PUBLIC_WS_URL` → `NEXT_PUBLIC_AGENT_WS` → derive from `NEXT_PUBLIC_API_URL`.
 * `normalizeWsLoopbackHost` maps `127.0.0.1` → `localhost` so URLs match compose/docs and Origin hosts align.
 *
 * **Browser (student UI):** prefer deriving from NEXT_PUBLIC_API_URL (e.g. `ws://localhost:8001/ws/agent`).
 * **Server-side fetch from Next container to backend:** use `http://backend:8000` (Docker DNS), not loopback.
 */
export function normalizeWsLoopbackHost(url: string): string {
  const u = url.trim();
  if (!u) return u;
  try {
    const parsed = new URL(u);
    if (parsed.hostname === '127.0.0.1') {
      parsed.hostname = 'localhost';
      return parsed.href;
    }
  } catch {
    /* ignore */
  }
  return u;
}

/** @deprecated Prefer {@link normalizeWsLoopbackHost} — kept for older imports. */
export const ipv4LoopbackWsUrl = normalizeWsLoopbackHost;

/**
 * HTTP GET target for WS preflight. FastAPI exposes `GET /health` (not `/api/health`).
 * In the browser we use same-origin `/health` so Next.js rewrites to the backend (no CORS, correct path).
 */
export function agentApiHealthUrlFromWsAgentUrl(wsUrl: string): string {
  if (typeof window !== 'undefined') {
    return '/health';
  }
  try {
    const u = new URL(wsUrl.trim());
    const httpProto = u.protocol === 'wss:' ? 'https:' : 'http:';
    return `${httpProto}//${u.host}/health`;
  } catch {
    return 'http://localhost:8001/health';
  }
}

/**
 * Same resolution as {@link buildDefaultWsAgentUrl} but reads env from a getter (for tests and SSR safety).
 * Order: `NEXT_PUBLIC_WS_URL` → `NEXT_PUBLIC_AGENT_WS` → derive from `NEXT_PUBLIC_API_URL` → default.
 */
export function buildWsAgentUrlFromEnv(
  get: (key: string) => string | undefined,
): string {
  const explicit =
    get('NEXT_PUBLIC_WS_URL')?.trim() ||
    get('NEXT_PUBLIC_AGENT_WS')?.trim();
  if (explicit) return normalizeWsLoopbackHost(explicit.replace(/\/$/, ''));
  const api = get('NEXT_PUBLIC_API_URL')?.trim();
  if (api) {
    const wsBase = `${api
      .replace(/\/$/, '')
      .replace(/^https:\/\//i, 'wss://')
      .replace(/^http:\/\//i, 'ws://')}`;
    return normalizeWsLoopbackHost(`${wsBase}/ws/agent`);
  }
  return 'ws://localhost:8001/ws/agent';
}

export function buildDefaultWsAgentUrl(): string {
  if (typeof process === 'undefined') return 'ws://localhost:8001/ws/agent';
  return buildWsAgentUrlFromEnv((k) => process.env[k]);
}
