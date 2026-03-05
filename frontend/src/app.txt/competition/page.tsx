'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import CompetitionDashboard from '@/components/competition/CompetitionDashboard';

export default function CompetitionPage() {
  const router = useRouter();

  useEffect(() => {
    const studentId = localStorage.getItem('studentId');
    if (!studentId) {
      router.replace('/competition-login');
    }
  }, [router]);

  return <CompetitionDashboard />;
}
