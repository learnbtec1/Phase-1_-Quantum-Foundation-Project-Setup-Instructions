'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/hooks/useAuth';
import MarketingSimulationWorld from '@/components/MarketingSimulationWorld';

export default function VRExperiencePage() {
  const router = useRouter();
  const { isAuthenticated } = useAuth();

  useEffect(() => {
    if (!isAuthenticated) {
      router.push('/auth/login');
    }
  }, [isAuthenticated, router]);

  if (!isAuthenticated) return null;

  return (
    <div className="min-h-screen bg-gradient-to-b from-background to-[#0a0a1a]">
      <div className="container mx-auto px-4 py-8">
        <div className="mb-6">
          <h1 className="text-4xl font-black text-gradient">الغرفة الافتراضية للتسويق</h1>
          <p className="text-gray-400">تحرك باستخدام WASD وتفاعل مع الشخصيات لإكمال التحديات.</p>
        </div>
        <MarketingSimulationWorld />
      </div>
    </div>
  );
}
