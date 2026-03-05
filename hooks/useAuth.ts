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

export const useAuthStore = create<AuthState>()(
  persist(
    (set) => ({
      user: null,
      isAuthenticated: false,
      login: async (email: string, password: string) => {
        // Simple mock authentication
        if (email === 'student@nexus.edu' && password === 'password123') {
          const user: User = {
            id: 'student-001',
            name: 'محمد أحمد',
            email: 'student@nexus.edu',
            role: 'student',
          };
          set({ user, isAuthenticated: true });
          return true;
        }
        return false;
      },
      logout: () => set({ user: null, isAuthenticated: false }),
    }),
    { name: 'nexus-auth' }
  )
);

export function useAuth() {
  return useAuthStore();
}
