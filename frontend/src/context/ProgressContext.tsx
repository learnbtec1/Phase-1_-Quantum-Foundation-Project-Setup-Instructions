"use client";
import React, { createContext, useContext, useState, useEffect } from 'react';

interface Evidence {
  id: string;
  type: string;
  title: string;
  content: string;
  category: 'primary' | 'secondary';
}

interface ProgressState {
  currentUnit: string | null;
  completedTasks: string[];
  totalPoints: number;
  collectedEvidence: Evidence[];
  pestleAnalysis: Record<string, string>;
  comparisonText: string;
  studentName: string;
}

interface ProgressContextType {
  progress: ProgressState;
  startUnit: (unitId: string) => void;
  completeTask: (taskId: string, points: number) => void;
  addEvidence: (evidence: Evidence) => void;
  savePESTLEAnalysis: (analysis: Record<string, string>) => void;
  saveComparison: (text: string) => void;
  setStudentName: (name: string) => void;
  autoGradeAnswer: (answer: string, keywords: string[]) => { score: number; feedback: string[] };
  resetProgress: () => void;
}

const ProgressContext = createContext<ProgressContextType | null>(null);

const STORAGE_KEY = 'btec_platform_progress';

export function ProgressProvider({ children }: { children: React.ReactNode }) {
  const [progress, setProgress] = useState<ProgressState>({
    currentUnit: null,
    completedTasks: [],
    totalPoints: 0,
    collectedEvidence: [],
    pestleAnalysis: {},
    comparisonText: '',
    studentName: ''
  });
  const [mounted, setMounted] = useState(false);

  // Load from localStorage after mount (client-only)
  useEffect(() => {
    try {
      const stored = localStorage.getItem(STORAGE_KEY);
      if (stored) {
        const parsed = JSON.parse(stored);
        setProgress(prev => ({ ...prev, ...parsed }));
      }
    } catch {
      // localStorage unavailable or data corrupt — ignore
    } finally {
      setMounted(true);
    }
  }, []);

  // Save to localStorage whenever progress changes, but only after initial load
  useEffect(() => {
    if (!mounted) return;
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(progress));
    } catch {
      // localStorage unavailable — ignore
    }
  }, [progress, mounted]);

  const startUnit = (unitId: string) => {
    setProgress(prev => ({ ...prev, currentUnit: unitId }));
  };

  const completeTask = (taskId: string, points: number) => {
    if (progress.completedTasks.includes(taskId)) return;
    setProgress(prev => ({
      ...prev,
      completedTasks: [...prev.completedTasks, taskId],
      totalPoints: prev.totalPoints + points
    }));
  };

  const addEvidence = (evidence: Evidence) => {
    setProgress(prev => ({
      ...prev,
      collectedEvidence: [...prev.collectedEvidence, evidence]
    }));
  };

  const savePESTLEAnalysis = (analysis: Record<string, string>) => {
    setProgress(prev => ({
      ...prev,
      pestleAnalysis: { ...prev.pestleAnalysis, ...analysis }
    }));
  };

  const saveComparison = (text: string) => {
    setProgress(prev => ({
      ...prev,
      comparisonText: text
    }));
  };

  const setStudentName = (name: string) => {
    setProgress(prev => ({
      ...prev,
      studentName: name
    }));
  };

  const autoGradeAnswer = (answer: string, keywords: string[]): { score: number; feedback: string[] } => {
    const lowerAnswer = answer.toLowerCase();
    let score = 0;
    const foundKeywords: string[] = [];
    const feedback: string[] = [];

    keywords.forEach(keyword => {
      if (lowerAnswer.includes(keyword.toLowerCase())) {
        const isDeepAnalysis = lowerAnswer.split(keyword.toLowerCase()).length > 2;
        const points = isDeepAnalysis ? 10 : 5;
        score += points;
        foundKeywords.push(keyword);
      }
    });

    const wordCount = answer.trim().split(/\s+/).length;
    if (wordCount > 150) {
      score += 15;
      feedback.push('تحليل مفصل جداً! (+15 نقطة)');
    } else if (wordCount > 100) {
      score += 10;
      feedback.push('تحليل جيد ومفصل (+10 نقاط)');
    } else if (wordCount > 50) {
      score += 5;
      feedback.push('تحليل مقبول (+5 نقاط)');
    } else {
      feedback.push('حاول كتابة المزيد من التفاصيل');
    }

    if (foundKeywords.length > 0) {
      feedback.push(`✓ كلمات مفتاحية رائعة: ${foundKeywords.join(', ')}`);
    } else {
      feedback.push('⚠ لم نجد كلمات مفتاحية كافية. حاول استخدام المصطلحات التقنية.');
    }

    return { score, feedback };
  };

  const resetProgress = () => {
    const initial: ProgressState = {
      currentUnit: null,
      completedTasks: [],
      totalPoints: 0,
      collectedEvidence: [],
      pestleAnalysis: {},
      comparisonText: '',
      studentName: ''
    };
    setProgress(initial);
    try {
      localStorage.removeItem(STORAGE_KEY);
    } catch {
      // localStorage unavailable — ignore
    }
  };

  return (
    <ProgressContext.Provider value={{
      progress,
      startUnit,
      completeTask,
      addEvidence,
      savePESTLEAnalysis,
      saveComparison,
      setStudentName,
      autoGradeAnswer,
      resetProgress
    }}>
      {children}
    </ProgressContext.Provider>
  );
}

export const useProgress = () => {
  const context = useContext(ProgressContext);
  if (!context) {
    throw new Error('useProgress must be used within a ProgressProvider');
  }
  return context;
};
