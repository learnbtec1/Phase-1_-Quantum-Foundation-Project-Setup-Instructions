'use client';

import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { Evidence } from '@/types';

interface VRState {
  collectedEvidence: string[];
  missionProgress: number;
  isMissionComplete: boolean;
  collectEvidence: (id: string) => void;
  resetMission: () => void;
  saveProgress: () => void;
}

export const useVRStore = create<VRState>()(
  persist(
    (set, get) => ({
      collectedEvidence: [],
      missionProgress: 0,
      isMissionComplete: false,
      collectEvidence: (id: string) => set((state) => {
        if (state.collectedEvidence.includes(id)) return state;
        const newEvidence = [...state.collectedEvidence, id];
        const progress = (newEvidence.length / 4) * 100; // 4 total evidence items
        return {
          collectedEvidence: newEvidence,
          missionProgress: progress,
          isMissionComplete: progress === 100,
        };
      }),
      resetMission: () => set({
        collectedEvidence: [],
        missionProgress: 0,
        isMissionComplete: false,
      }),
      saveProgress: () => {
        // Progress is automatically saved via persist
        console.log('Progress saved');
      },
    }),
    { name: 'nexus-vr' }
  )
);

export function useVR() {
  return useVRStore();
}
