'use client';

import { useCallback } from 'react';
import { useAssessment } from './useAssessment';

/**
 * Hook لتقييم حلول متعددة الملفات
 * 
 * مثال:
 * const { evaluateMultiFile, isLoading } = useEvaluateMultiFile();
 * 
 * await evaluateMultiFile({
 *   assignment_text: "الواجب...",
 *   solutions: [
 *     {
 *       file_label: "TalkMateAI",
 *       file_content: "محتوى...",
 *       description: "وصف اختياري"
 *     },
 *     {
 *       file_label: "Phase-1",
 *       file_content: "محتوى...",
 *       description: "وصف اختياري"
 *     }
 *   ]
 * });
 */
export interface SolutionFile {
  file_label: string;
  file_content: string;
  description?: string;
}

export interface MultiFileEvaluationRequest {
  assignment_text: string;
  solutions: SolutionFile[];
}

export interface MultiFileEvaluationResult {
  success: boolean;
  final_grade?: string;
  files_evaluated?: number;
  consolidated_summary?: string;
  file_distribution?: Record<string, Record<string, boolean>>;
  criteria?: Record<string, any>;
  error?: string;
}

export function useEvaluateMultiFile() {
  const assessment = useAssessment();
  
  const evaluateMultiFile = useCallback(
    async (
      request: MultiFileEvaluationRequest
    ): Promise<MultiFileEvaluationResult> => {
      try {
        console.log(`📁 تقييم متكامل لـ ${request.solutions.length} ملف(ات)`);
        
        // التحقق من صحة البيانات
        if (!request.assignment_text?.trim()) {
          throw new Error('نص الواجب فارغ');
        }
        
        if (!Array.isArray(request.solutions) || request.solutions.length === 0) {
          throw new Error('يجب إرسال ملف واحد على الأقل');
        }
        
        for (let i = 0; i < request.solutions.length; i++) {
          const sol = request.solutions[i];
          if (!sol.file_label) {
            throw new Error(`الملف رقم ${i + 1}: يجب توفير اسم الملف`);
          }
          if (!sol.file_content || sol.file_content.length < 50) {
            throw new Error(`الملف "${sol.file_label}": المحتوى قصير جداً`);
          }
        }
        
        // استدعاء الـ API الجديد
        const response = await fetch('/api/evaluate-multi-file', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify(request),
        });

        if (!response.ok) {
          const errorData = await response.json();
          throw new Error(errorData.detail || 'فشل التقييم');
        }

        const result: MultiFileEvaluationResult = await response.json();
        
        console.log(`✅ التقييم مكتمل - النتيجة: ${result.final_grade}`);
        console.log(`📊 عدد الملفات: ${result.files_evaluated}`);
        
        return {
          success: true,
          ...result
        };

      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        console.error('❌ خطأ في التقييم:', errorMessage);
        
        return {
          success: false,
          error: errorMessage
        };
      }
    },
    []
  );

  return {
    evaluateMultiFile,
    isLoading: false // يمكن إضافة حالة تحميل لاحقاً إذا لزم الأمر
  };
}

export default useEvaluateMultiFile;
