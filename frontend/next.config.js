/** @type {import('next').NextConfig} */
import { fileURLToPath } from 'node:url';
import { dirname } from 'node:path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const nextConfig = {
  outputFileTracingRoot: __dirname,
  reactStrictMode: false, // ⚠️ true يكسر WebGL context في dev mode

  // تحويل حزمة three-vrm لضمان التوافق مع Next
  transpilePackages: [
    '@sage-rsc/talking-head-react',
    '@pixiv/three-vrm',
    '@pixiv/three-vrm-animation',
    '@react-three/xr',
    '@react-three/fiber',
    '@react-three/drei',
  ],

  // ⚠️ لا تضع "three" في optimizePackageImports — يكسر WebGL side-effects

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
      { protocol: "https", hostname: "**" },
      { protocol: "http", hostname: "localhost" },
    ],
  },
};

export default nextConfig;