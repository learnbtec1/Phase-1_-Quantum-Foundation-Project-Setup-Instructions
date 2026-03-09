import type { Metadata } from 'next';
import { Suspense } from 'react';
import AvatarAgentClient from './AvatarAgentClient';

// [COPILOT_FORCE_DYNAMIC] Prevent stale RSC optimisation that causes 500 on HMR refresh
export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: 'Avatar Agent — NEXUS',
  description: 'محادثة صوتية مع الدكتور حمزة — النظام الذكي للتعلم التفاعلي',
};

export default function AvatarAgentPage() {
  return (
    <Suspense fallback={
      <div className="flex items-center justify-center min-h-screen bg-[#0a0a12] text-white text-sm">
        جاري التحميل...
      </div>
    }>
      <AvatarAgentClient />
    </Suspense>
  );
}