import rubricTemplate from '@/config/rubric.json';

export type RubricCriterion = {
  code: string;
  level: string;
  description: string;
  keywords: string[];
  allowPartialCredit?: boolean;
};

export type RubricConfig = {
  rubricId: string;
  version: string;
  title: string;
  criteria: RubricCriterion[];
};

export type CriterionResult = {
  code: string;
  level: string;
  achieved: boolean;
  matchedKeywords: string[];
  missedKeywords: string[];
  score: number;
  feedback: string;
};

export type StrictEvaluationResult = {
  rubricId: string;
  version: string;
  strictMode: boolean;
  totalCriteria: number;
  achievedCount: number;
  achievedPercent: number;
  overallBand: 'DISTINCTION' | 'MERIT' | 'PASS' | 'FAIL';
  criteria: CriterionResult[];
};

export function getDefaultRubric(): RubricConfig {
  return rubricTemplate as RubricConfig;
}

function normalize(text: string): string {
  return text.toLowerCase().replace(/\s+/g, ' ').trim();
}

function getBand(criteria: CriterionResult[]): StrictEvaluationResult['overallBand'] {
  const pass = criteria.filter((c) => c.level.toLowerCase() === 'pass');
  const merit = criteria.filter((c) => c.level.toLowerCase() === 'merit');
  const distinction = criteria.filter((c) => c.level.toLowerCase() === 'distinction');

  const allPass = pass.length > 0 && pass.every((c) => c.achieved);
  const allMerit = merit.length > 0 && merit.every((c) => c.achieved);
  const allDistinction = distinction.length > 0 && distinction.every((c) => c.achieved);

  if (allPass && allMerit && allDistinction) return 'DISTINCTION';
  if (allPass && allMerit) return 'MERIT';
  if (allPass) return 'PASS';
  return 'FAIL';
}

export function evaluateWithRubric(
  answer: string,
  rubric: RubricConfig,
  strictMode: boolean
): StrictEvaluationResult {
  const normalizedAnswer = normalize(answer);

  const criteria = rubric.criteria.map((criterion) => {
    const normalizedKeywords = criterion.keywords.map((keyword) => normalize(keyword));
    const matchedKeywords = normalizedKeywords.filter((keyword) => normalizedAnswer.includes(keyword));
    const missedKeywords = normalizedKeywords.filter((keyword) => !normalizedAnswer.includes(keyword));

    const strictAchieved = missedKeywords.length === 0;
    const looseRatio = normalizedKeywords.length === 0 ? 0 : matchedKeywords.length / normalizedKeywords.length;
    const looseAchieved = looseRatio >= 0.6;

    const achieved = strictMode ? strictAchieved : looseAchieved;

    const rawScore = strictMode
      ? strictAchieved
        ? 100
        : 0
      : criterion.allowPartialCredit === false
      ? looseAchieved
        ? 100
        : 0
      : Math.round(looseRatio * 100);

    return {
      code: criterion.code,
      level: criterion.level,
      achieved,
      matchedKeywords,
      missedKeywords,
      score: rawScore,
      feedback: achieved
        ? `تم تحقيق ${criterion.code} بنجاح (${matchedKeywords.length}/${normalizedKeywords.length} كلمات مطابقة).`
        : `لم يتم تحقيق ${criterion.code}. الكلمات غير المطابقة: ${missedKeywords.join(', ') || 'لا توجد بيانات كافية'}.`,
    } satisfies CriterionResult;
  });

  const achievedCount = criteria.filter((criterion) => criterion.achieved).length;

  return {
    rubricId: rubric.rubricId,
    version: rubric.version,
    strictMode,
    totalCriteria: criteria.length,
    achievedCount,
    achievedPercent: criteria.length === 0 ? 0 : Math.round((achievedCount / criteria.length) * 100),
    overallBand: getBand(criteria),
    criteria,
  };
}
