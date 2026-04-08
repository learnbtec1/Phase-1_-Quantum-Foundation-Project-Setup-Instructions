type Bucket = { count: number; windowStart: number };

const buckets = new Map<string, Bucket>();

/**
 * Fixed-window rate limit. Returns true if the request is allowed.
 */
export function takeRateLimit(
  key: string,
  max: number,
  windowMs: number,
): boolean {
  const now = Date.now();
  const b = buckets.get(key);
  if (!b || now - b.windowStart >= windowMs) {
    buckets.set(key, { count: 1, windowStart: now });
    return true;
  }
  if (b.count >= max) {
    return false;
  }
  b.count += 1;
  return true;
}

export function clientIpFromRequest(req: { headers: Headers }): string {
  const xf = req.headers.get('x-forwarded-for');
  if (xf) {
    const first = xf.split(',')[0]?.trim();
    if (first) return first;
  }
  const real = req.headers.get('x-real-ip');
  if (real?.trim()) return real.trim();
  return 'unknown';
}
