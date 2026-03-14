import type { Metadata } from 'next';
import { Suspense } from 'react';
import AvatarAgentClient from './AvatarAgentClient';

// [COPILOT_FORCE_DYNAMIC] Removed: force-dynamic caused Cache-Control: no-store which blocks bfcache.
// Using 'auto' lets Next.js cache the RSC shell while the 'use client' component handles its own state.
export const dynamic = 'auto';

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