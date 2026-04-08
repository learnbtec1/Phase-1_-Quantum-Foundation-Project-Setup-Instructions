'use client';

import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { Assessment, GradingResult } from '@/types';
import { calculateGrade } from '@/lib/btec-grading';

interface AssessmentState {
  assessments: Assessment[];
  evaluate: (submission: string, unit: string, openaiApiKey?: string) => Promise<GradingResult>;
  saveAssessment: (assessment: Omit<Assessment, 'id'>) => Assessment[];
  getAssessments: () => Assessment[];
}

export const useAssessmentStore = create<AssessmentState>()(
  persist(
    (set, get) => ({
      assessments: [],
      evaluate: async (submission: string, unit: string, openaiApiKey?: string) => {
        if (openaiApiKey) {
          // Use OpenAI API via Next.js route
          const res = await fetch('/api/openai-grade', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ submission, unit, openaiApiKey }),
          });
          if (!res.ok) {
            const err = await res.json();
            throw new Error(err.error || 'OpenAI grading failed');
          }
          return await res.json();
        } else {
          // Local grading fallback
          await new Promise(resolve => setTimeout(resolve, 2000));
          const result = calculateGrade(submission, unit);
          return result;
        }
      },
      saveAssessment: (assessment) => {
        const newAssessment: Assessment = {
          ...assessment,
          id: `assess-${Date.now()}`,
        };
        const updated = [...get().assessments, newAssessment];
        set({ assessments: updated });
        return updated;
      },
      getAssessments: () => get().assessments,
    }),
    { name: 'eduverse-assessments' }
  )
);

export function useAssessment() {
  return useAssessmentStore();
}
