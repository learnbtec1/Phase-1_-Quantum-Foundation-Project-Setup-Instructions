/** @type {import('next').NextConfig} */
import { fileURLToPath } from 'node:url';
import { dirname } from 'node:path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// جذر عام لكل البيئات
const ROOT = process.cwd();

const nextConfig = {
  output: process.env.NODE_ENV === 'production' ? 'standalone' : undefined,
  outputFileTracingRoot: ROOT,
  reactStrictMode: false,
  poweredByHeader: false,
  productionBrowserSourceMaps: false,

  eslint: { ignoreDuringBuilds: true },
  typescript: { ignoreBuildErrors: true },

  transpilePackages: [
    '@sage-rsc/talking-head-react',
    '@pixiv/three-vrm',
    '@pixiv/three-vrm-animation',
    '@react-three/xr',
    '@react-three/fiber',
    '@react-three/drei',
  ],

  async headers() {
    return [
      {
        source: '/models/:path*',
        headers: [{ key: 'Cache-Control', value: 'public, max-age=3600' }],
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