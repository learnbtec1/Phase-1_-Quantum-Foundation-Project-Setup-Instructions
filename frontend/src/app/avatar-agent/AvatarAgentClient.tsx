'use client';

import dynamic from 'next/dynamic';

const AvatarCanvas = dynamic(() => import('./AvatarCanvas'), {
  ssr: false,
  loading: () => (
    <div className="flex items-center justify-center min-h-screen bg-[#0a0a12] text-white text-sm">
      جاري تحميل الدكتور حمزة...
    </div>
  ),
});

export default function AvatarAgentClient() {
  return (
    <main className="w-full h-screen overflow-hidden" dir="rtl">
      <AvatarCanvas vrmUrl="/models/teach.vrm" />
    </main>
  );
}