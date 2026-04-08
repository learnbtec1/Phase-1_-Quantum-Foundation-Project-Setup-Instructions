'use client';

import dynamic from 'next/dynamic';
import { pickVrmUrl } from '@/config/avatar';

const ACTIVE_VRM = pickVrmUrl();

const AvatarCanvas = dynamic(() => import('@/app/avatar-agent/AvatarCanvas'), {
  ssr: false,
  loading: () => (
    <div
      className="flex h-screen w-screen items-center justify-center bg-[#1a1a2e] text-xl text-white"
      role="status"
    >
      ⏳ Loading Avatar…
    </div>
  ),
});

/**
 * Isolated diagnostic route: /test-avatar
 * No AvatarAgentClient modals — if 3D works here but not on /avatar-agent, suspect layout/stacking/HUD.
 */
export default function TestAvatarPage() {
  return (
    <div className="relative h-screen w-screen bg-[#1a1a2e]">
      <div className="absolute inset-0">
        <AvatarCanvas vrmUrl={ACTIVE_VRM} />
      </div>
      <p className="pointer-events-none absolute bottom-5 left-1/2 z-10 -translate-x-1/2 text-center text-sm text-lime-400">
        Test page — green text = route OK. No avatar? Check VRM path + WebGL console.
      </p>
    </div>
  );
}
