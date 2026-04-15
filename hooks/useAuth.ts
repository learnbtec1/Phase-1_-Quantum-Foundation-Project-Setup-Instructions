'use client';

import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { User } from '@/types';

interface AuthState {
  user: User | null;
  isAuthenticated: boolean;
  login: (email: string, password: string) => Promise<boolean>;
  logout: () => void;
}

/** Mock credentials only when dev build OR explicit opt-in (never default in production). */
function isMockAuthAllowed(): boolean {
  if (process.env.NODE_ENV !== 'production') return true;
  return process.env.NEXT_PUBLIC_ALLOW_MOCK_AUTH === 'true';
}

export const useAuthStore = create<AuthState>()(
  persist(
    (set) => ({
      user: null,
      isAuthenticated: false,
      login: async (email: string, password: string) => {
        if (!isMockAuthAllowed()) {
          console.warn('[useAuth] Mock login is disabled in this build. Set NEXT_PUBLIC_ALLOW_MOCK_AUTH=true only for controlled demos.');
          return false;
        }
        // Simple mock authentication (dev / explicit demo only)
        if (email === 'student@eduverse.edu' && password === 'password123') {
          const user: User = {
            id: 'student-001',
            name: 'محمد أحمد',
            email: 'student@eduverse.edu',
            role: 'student',
          };
          set({ user, isAuthenticated: true });
          return true;
        }
        return false;
      },
      logout: () => set({ user: null, isAuthenticated: false }),
    }),
    { name: 'eduverse-auth' }
  )
);

export function useAuth() {
  return useAuthStore();
}
