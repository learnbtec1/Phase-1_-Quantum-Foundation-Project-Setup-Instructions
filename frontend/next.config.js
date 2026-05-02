/**
 * In the browser we call same-origin `/api/v1/...` (see getApiBase()).
 * Next rewrites those to the real FastAPI — avoids CORS between :3000/:3001 and :8000/:8001.
 *
 * Proxy target (server-side):
 * - `next dev` on the host: prefer NEXT_PUBLIC_API_URL (localhost:PORT). If BACKEND_INTERNAL_URL
 *   points at Docker DNS (`backend`), using it here breaks API calls — hostname does not resolve on the host.
 * - `next build` / production image: prefer BACKEND_INTERNAL_URL (http://backend:8000 inside Compose).
 */
const publicApi = process.env.NEXT_PUBLIC_API_URL?.trim();
const internalApi = process.env.BACKEND_INTERNAL_URL?.trim();
const defaultProxy = "http://127.0.0.1:8001";
const backendForProxy =
  process.env.NODE_ENV === "production"
    ? internalApi || publicApi || defaultProxy
    : publicApi || internalApi || defaultProxy;
const _proxy = String(backendForProxy)
  .trim()
  .replace(/\/$/, "");
const _proxyBase = _proxy.endsWith("/api/v1") ? _proxy.replace(/\/api\/v1$/, "") : _proxy;

/** @type {import('next').NextConfig} */
const nextConfig = {
  output: "standalone",

  async redirects() {
    return [
      { source: "/plagiarism-check", destination: "/plagiarism", permanent: false },
    ];
  },

  async rewrites() {
    return [
      { source: "/api/v1/:path*", destination: `${_proxyBase}/api/v1/:path*` },
      { source: "/health", destination: `${_proxyBase}/health` },
    ];
  },

  eslint: {
    ignoreDuringBuilds: true,
  },

  typescript: {
    ignoreBuildErrors: true,
  },

  experimental: {
    serverComponentsExternalPackages: ["pdf-parse", "mammoth"],
  },
};

module.exports = nextConfig;