/** @type {import('next').NextConfig} */
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// جذر عام لكل البيئات
const ROOT = process.cwd();

/** Origins to allow for fetch + WS when API is not same-origin (LAN IP, custom port, etc.). */
function cspConnectSrcExtras() {
  const extras = new Set();
  const tryAdd = (raw) => {
    if (!raw || typeof raw !== 'string') return;
    const u = raw.trim();
    if (!u) return;
    try {
      const { origin, protocol, host } = new URL(u);
      extras.add(origin);
      if (protocol === 'http:' && host) extras.add(`ws://${host}`);
      if (protocol === 'https:' && host) extras.add(`wss://${host}`);
    } catch {
      /* ignore invalid URL */
    }
  };
  tryAdd(process.env.NEXT_PUBLIC_API_URL);
  tryAdd(process.env.BACKEND_URL);
  return Array.from(extras).join(' ');
}

/** Phase 4 — CSP: report-only by default; set CSP_ENFORCE=true to apply Content-Security-Policy. */
function securityHeaders() {
  const isProd = process.env.NODE_ENV === 'production';
  const enforceCsp = process.env.CSP_ENFORCE === 'true';
  const connectExtras = cspConnectSrcExtras();
  const parts = [
    "default-src 'self'",
    "base-uri 'self'",
    "object-src 'none'",
    "frame-ancestors 'self'",
    "script-src 'self' 'unsafe-inline' 'unsafe-eval' blob:",
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob: https:",
    "font-src 'self' data:",
    "media-src 'self' blob: data:",
    "worker-src 'self' blob:",
    "child-src 'self' blob:",
    // WebSocket agent, Azure Speech / OpenAI / API (broad https: keeps regional Azure endpoints working)
    "connect-src 'self' blob: ws: wss: https:" +
      (isProd ? '' : ' http://localhost:* http://127.0.0.1:*') +
      (connectExtras ? ` ${connectExtras}` : ''),
  ];
  if (isProd) {
    parts.push('upgrade-insecure-requests');
  }
  const csp = parts.join('; ');
  const cspEntry = enforceCsp
    ? { key: 'Content-Security-Policy', value: csp }
    : { key: 'Content-Security-Policy-Report-Only', value: csp };

  return [
    { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
    { key: 'X-Content-Type-Options', value: 'nosniff' },
    { key: 'X-Frame-Options', value: 'SAMEORIGIN' },
    cspEntry,
  ];
}

const nextConfig = {
  output: process.env.NODE_ENV === 'production' ? 'standalone' : undefined,
  outputFileTracingRoot: ROOT,
  reactStrictMode: false,
  poweredByHeader: false,
  productionBrowserSourceMaps: false,

  /** Allow HMR when browser connects from 127.0.0.1 (avoids "Blocked cross-origin" warning). */
  allowedDevOrigins: ['127.0.0.1', 'localhost'],

  /** Build-time default — ensures cogni.vrm is resolved even without .env.local. */
  env: {
    NEXT_PUBLIC_AVATAR_VRM_URL:
      process.env.NEXT_PUBLIC_AVATAR_VRM_URL || '/models/cogni.vrm',
  },

  // eslint: removed — Next.js 16 no longer reads this from next.config.js
  // Use .eslintrc / eslint.config.js and `next lint` instead.

  // TypeScript: Next.js 16 ignores this option too — tsc is run separately.
  // Run `npm run type-check` in CI for TypeScript validation.

  transpilePackages: [
    '@pixiv/three-vrm',
    '@pixiv/three-vrm-animation',
    '@pixiv/three-vrm-core',
    '@react-three/xr',
    '@react-three/fiber',
    '@react-three/drei',
  ],

  // ── Next.js 16: opt-out of Turbopack for production builds ───────────────
  // Three.js / @pixiv/three-vrm use webpack-specific GLSL loaders and
  // binary module handling that require webpack. Turbopack is still maturing
  // for complex 3D stacks. Explicitly declare an empty turbopack config so
  // Next.js stops treating this as an error (per Next 16 migration guide).
  turbopack: {},

  async headers() {
    const sec = securityHeaders();
    return [
      {
        source: '/models/:path*',
        headers: [
          { key: 'Cache-Control', value: 'public, max-age=3600' },
          ...sec,
        ],
      },
      {
        source: '/:path*',
        headers: sec,
      },
    ];
  },

  images: {
    remotePatterns: [
      { protocol: 'https', hostname: '**' },
      { protocol: 'http', hostname: 'localhost' },
    ],
  },
};

export default nextConfig;