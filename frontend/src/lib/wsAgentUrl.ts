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

/** Close code used when the client aborts a stuck CONNECTING handshake (must be 4000–4999). */
export const WS_CLIENT_OPEN_TIMEOUT_CODE = 4408;

const DEFAULT_WS_CONNECT_TIMEOUT_MS = 8000;

/**
 * Milliseconds to wait for `WebSocket` to reach OPEN before closing the socket.
 * Set `NEXT_PUBLIC_WS_CONNECT_TIMEOUT_MS` (e.g. 3000 for faster fail when backend is down).
 */
export function readWsConnectTimeoutMs(): number {
  if (typeof process === 'undefined') return DEFAULT_WS_CONNECT_TIMEOUT_MS;
  const raw = process.env.NEXT_PUBLIC_WS_CONNECT_TIMEOUT_MS?.trim();
  if (!raw) return DEFAULT_WS_CONNECT_TIMEOUT_MS;
  const n = Number.parseInt(raw, 10);
  if (!Number.isFinite(n)) return DEFAULT_WS_CONNECT_TIMEOUT_MS;
  return Math.min(120_000, Math.max(1_500, n));
}

/**
 * When `NEXT_PUBLIC_SKIP_AGENT_WS` is true/1/yes, the client must not open `/ws/agent`
 * (avoids a stuck handshake when no backend is intended).
 */
export function agentWsSkippedByEnv(): boolean {
  if (typeof process === 'undefined') return false;
  const v = process.env.NEXT_PUBLIC_SKIP_AGENT_WS?.trim().toLowerCase() ?? '';
  return v === '1' || v === 'true' || v === 'yes';
}
