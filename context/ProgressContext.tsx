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

  // Load from localStorage on mount
  useEffect(() => {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored) {
      try {
        const parsed = JSON.parse(stored);
        setProgress(prev => ({ ...prev, ...parsed }));
        console.log('📦 تحميل التقدم من localStorage');
      } catch (e) {
        console.warn('فشل تحميل البيانات المحفوظة');
      }
    }
  }, []);

  // Save to localStorage whenever progress changes
  useEffect(() => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(progress));
  }, [progress]);

  const startUnit = (unitId: string) => {
    console.log(`🎬 بدء الوحدة: ${unitId}`);
    setProgress(prev => ({ ...prev, currentUnit: unitId }));
  };

  const completeTask = (taskId: string, points: number) => {
    if (progress.completedTasks.includes(taskId)) return;
    console.log(`✅ مهمة مكتملة: ${taskId} (+${points} نقاط)`);
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
    console.log(`📝 دليل مضاف: ${evidence.title}`);
  };

  const savePESTLEAnalysis = (analysis: Record<string, string>) => {
    setProgress(prev => ({
      ...prev,
      pestleAnalysis: { ...prev.pestleAnalysis, ...analysis }
    }));
    console.log('📊 تحليل PESTLE محفوظ');
  };

  const saveComparison = (text: string) => {
    setProgress(prev => ({
      ...prev,
      comparisonText: text
    }));
    console.log('📋 مقارنة الشركات محفوظة');
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

    console.log(`🎯 التصحيح التلقائي: ${score} نقطة | كلمات: ${foundKeywords.join(', ')}`);
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
    localStorage.removeItem(STORAGE_KEY);
    console.log('🔄 تم إعادة تعيين التقدم');
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