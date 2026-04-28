/**
 * Shared WebSocket URL for `/ws/agent` (browser + useAgentAgent).
 *
 * Resolution order: `NEXT_PUBLIC_WS_URL` → `NEXT_PUBLIC_AGENT_WS` → derive from `NEXT_PUBLIC_API_URL`.
 * `ipv4LoopbackWsUrl` maps `localhost` → `127.0.0.1` to avoid IPv6 ::1 vs IPv4-only binds.
 *
 * **Browser (student UI):** use `ws://127.0.0.1:8000/ws/agent` when the API is published on the host
 * (`ports: "8000:8000"`). The browser runs on the host, not inside the frontend container.
 * **Server-side fetch from Next container to backend:** use `http://backend:8000` (Docker DNS), not 127.0.0.1.
 */
export function ipv4LoopbackWsUrl(url: string): string {
  const u = url.trim();
  if (!u) return u;
  try {
    const parsed = new URL(u);
    if (parsed.hostname === 'localhost') {
      parsed.hostname = '127.0.0.1';
      return parsed.href;
    }
  } catch {
    /* ignore */
  }
  return u;
}

/**
 * Maps `ws://host:port/ws/agent` → `http://host:port/api/health` for a cheap TCP/HTTP preflight
 * before opening a WebSocket (avoids Chromium's noisy "WebSocket connection failed" when nothing listens).
 */
export function agentApiHealthUrlFromWsAgentUrl(wsUrl: string): string {
  try {
    const u = new URL(wsUrl.trim());
    const httpProto = u.protocol === 'wss:' ? 'https:' : 'http:';
    return `${httpProto}//${u.host}/api/health`;
  } catch {
    return 'http://127.0.0.1:8000/api/health';
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
  if (explicit) return ipv4LoopbackWsUrl(explicit.replace(/\/$/, ''));
  const api = get('NEXT_PUBLIC_API_URL')?.trim();
  if (api) {
    const wsBase = `${api
      .replace(/\/$/, '')
      .replace(/^https:\/\//i, 'wss://')
      .replace(/^http:\/\//i, 'ws://')}`;
    return ipv4LoopbackWsUrl(`${wsBase}/ws/agent`);
  }
  return 'ws://127.0.0.1:8000/ws/agent';
}

export function buildDefaultWsAgentUrl(): string {
  if (typeof process === 'undefined') return 'ws://127.0.0.1:8000/ws/agent';
  return buildWsAgentUrlFromEnv((k) => process.env[k]);
}
