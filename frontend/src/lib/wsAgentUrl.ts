/**
 * Shared WebSocket URL for `/ws/agent` (browser + useAgentAgent).
 * `ipv4LoopbackWsUrl` maps `localhost` → `127.0.0.1` to avoid IPv6 ::1 vs IPv4-only binds.
 * Override with `NEXT_PUBLIC_WS_URL` if you must keep the hostname literal (e.g. mixed Docker networking).
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

export function buildDefaultWsAgentUrl(): string {
  if (typeof process === 'undefined') return 'ws://127.0.0.1:8000/ws/agent';
  /** Prefer NEXT_PUBLIC_WS_URL; NEXT_PUBLIC_AGENT_WS kept as legacy alias. */
  const explicit =
    process.env.NEXT_PUBLIC_WS_URL?.trim() ||
    process.env.NEXT_PUBLIC_AGENT_WS?.trim();
  if (explicit) return ipv4LoopbackWsUrl(explicit.replace(/\/$/, ''));
  const api = process.env.NEXT_PUBLIC_API_URL?.trim();
  if (api) {
    const wsBase = `${api
      .replace(/\/$/, '')
      .replace(/^https:\/\//i, 'wss://')
      .replace(/^http:\/\//i, 'ws://')}`;
    return ipv4LoopbackWsUrl(`${wsBase}/ws/agent`);
  }
  return 'ws://127.0.0.1:8000/ws/agent';
}
