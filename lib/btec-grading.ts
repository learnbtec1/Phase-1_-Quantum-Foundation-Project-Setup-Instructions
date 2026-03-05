import type { GradingResult, GradeType } from '@/types';

// BTEC keywords and their importance scores
const btecKeywords = {
  high: ['PESTLE', 'SWOT', 'stakeholder', 'analysis', 'evaluation', 'strategy', 'impact', 'risk'],
  medium: ['business', 'market', 'customer', 'competitive', 'economic', 'social', 'technology'],
  low: ['company', 'organization', 'management', 'planning', 'development'],
};

export function calculateGrade(submission: string, unit: string): GradingResult {
  const text = submission.toLowerCase();
  const wordCount = submission.trim().split(/\s+/).length;
  
  // Calculate keyword scores
  let score = 0;
  const foundKeywords: string[] = [];
  
  // High-value keywords (3 points each)
  btecKeywords.high.forEach(keyword => {
    if (text.includes(keyword.toLowerCase())) {
      score += 3;
      foundKeywords.push(keyword);
    }
  });
  
  // Medium-value keywords (2 points each)
  btecKeywords.medium.forEach(keyword => {
    if (text.includes(keyword.toLowerCase())) {
      score += 2;
      foundKeywords.push(keyword);
    }
  });
  
  // Low-value keywords (1 point each)
  btecKeywords.low.forEach(keyword => {
    if (text.includes(keyword.toLowerCase())) {
      score += 1;
      foundKeywords.push(keyword);
    }
  });
  
  // Word count bonus
  if (wordCount > 500) score += 3;
  else if (wordCount > 300) score += 2;
  else if (wordCount > 150) score += 1;
  
  // Determine grade
  let grade: GradeType;
  let feedback: string;
  const strengths: string[] = [];
  const improvements: string[] = [];
  
  if (score >= 12) {
    grade = 'Distinction';
    feedback = 'تحليل ممتاز ومتعمق مع استخدام رائع للمصطلحات الأكاديمية';
    strengths.push('استخدام متقدم لأدوات التحليل مثل PESTLE و SWOT');
    strengths.push('تفصيل جيد وأمثلة واقعية');
    strengths.push('تقييم نقدي للمعلومات');
  } else if (score >= 8) {
    grade = 'Merit';
    feedback = 'تحليل جيد مع إمكانية للتحسين في العمق';
    strengths.push('تغطية جيدة للموضوع الأساسي');
    strengths.push('استخدام مصطلحات مناسبة');
    improvements.push('أضف المزيد من التحليل النقدي');
    improvements.push('استخدم أمثلة واقعية أكثر');
  } else if (score >= 4) {
    grade = 'Pass';
    feedback = 'التقرير يلبي الحد الأدنى من المتطلبات';
    strengths.push('المعلومات الأساسية موجودة');
    improvements.push('أضف تحليل PESTLE كامل');
    improvements.push('زد من عمق التحليل');
    improvements.push('استخدم مصطلحات أكاديمية أكثر');
  } else {
    grade = 'Referral';
    feedback = 'التقرير يحتاج إلى إعادة صياغة كاملة';
    improvements.push('أضف تحليل شامل باستخدام PESTLE');
    improvements.push('زد من عدد الكلمات (الحد الأدنى 200 كلمة)');
    improvements.push('استخدم أمثلة من الواقع');
    improvements.push('قدم تقييم نقدي للمعلومات');
  }
  
  return {
    grade,
    score: Math.min(15, score),
    feedback,
    strengths,
    improvements,
  };
}

export const btecCriteria = {
  unit1: {
    title: 'الوحدة 1: بيئة الأعمال',
    pass: [
      'وصف أنواع المنظمات',
      'شرح أهداف الأعمال',
      'تحديد أصحاب المصلحة',
      'وصف الهياكل التنظيمية',
      'شرح التأثيرات الخارجية',
    ],
    merit: [
      'تحليل تأثير PESTLE',
      'مقارنة بين المنظمات',
      'تقييم تأثير أصحاب المصلحة',
      'تحليل الهياكل التنظيمية',
      'استخدام أمثلة واقعية',
    ],
    distinction: [
      'تحليل نقدي متعمق',
      'تقييم استراتيجيات الأعمال',
      'ربط النظريات بالتطبيق',
      'توصيات عملية مدعومة',
      'تحليل مستقبلي وتوقعات',
    ],
  },
  unit11: {
    title: 'الوحدة 11: الأمن السيبراني',
    pass: [
      'وصف التهديدات السيبرانية',
      'تحديد إجراءات الحماية',
      'شرح مبادئ الأمن',
      'ذكر القوانين واللوائح',
      'وصف سياسات الأمان',
    ],
    merit: [
      'تحليل نقاط الضعف',
      'تقييم فعالية الإجراءات',
      'مقارنة أدوات الحماية',
      'تحليل حالات اختراق',
      'استخدام بيانات واقعية',
    ],
    distinction: [
      'تحليل مخاطر متكامل',
      'تصميم خطة حماية شاملة',
      'تقييم نقدي للتكنولوجيا',
      'حلول مبتكرة للتحديات',
      'توقعات مستقبلية للمخاطر',
    ],
  },
};
