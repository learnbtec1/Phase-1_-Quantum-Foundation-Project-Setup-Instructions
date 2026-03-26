export interface Criterion {
  code: string;
  verdict: 'Achieved' | 'Not Achieved';
  reasons: string[];
  evidence: { quote: string; start: number; end: number }[];
  recommendations: string[];
}

export interface EvaluationResult {
  success: boolean;
  data: {
    summary: { totalCriteria: number; achievedCount: number; achievedPercent: number };
    criteria: Criterion[];
    final_grade?: string;
  };
  report: string;
}

/** Normalize evaluate / evaluate-multi-file payloads to EvaluationResult. */
export function normalizeIntegratedResult(payload: unknown): EvaluationResult {
  const p = payload as Record<string, unknown>;
  const rawCriteria = p?.criteria;

  const criteriaArray: Criterion[] = Array.isArray(rawCriteria)
    ? rawCriteria.map((item: Record<string, unknown>) => ({
        code: String(item?.code ?? '?'),
        verdict: (item?.verdict === 'Achieved' || item?.achieved) ? 'Achieved' : 'Not Achieved',
        reasons: Array.isArray(item?.reasons) ? (item.reasons as string[]) : (item?.feedback ? [String(item.feedback)] : []),
        evidence: Array.isArray(item?.evidence)
          ? (item.evidence as Criterion['evidence'])
          : (item?.evidence_quote
            ? [{ quote: String(item.evidence_quote), start: Number(item.start_index ?? 0), end: Number(item.end_index ?? 0) }]
            : []),
        recommendations: Array.isArray(item?.recommendations) ? (item.recommendations as string[]) : [],
      }))
    : Object.entries((rawCriteria as Record<string, Record<string, unknown>>) || {}).map(
        ([code, data]) => ({
          code,
          verdict: data?.achieved ? 'Achieved' : 'Not Achieved',
          reasons: Array.isArray(data?.reasons)
            ? (data.reasons as string[])
            : (data?.feedback ? [String(data.feedback)] : []),
          evidence: Array.isArray(data?.evidence)
            ? (data.evidence as Criterion['evidence'])
            : (data?.evidence_quote
              ? [{
                quote: String(data.evidence_quote),
                start: Number(data.start_index ?? 0),
                end: Number(data.end_index ?? 0),
              }]
              : []),
          recommendations: Array.isArray(data?.recommendations) ? (data.recommendations as string[]) : [],
        }),
      );

  const achievedCount = criteriaArray.filter((c) => c.verdict === 'Achieved').length;
  const totalCriteria = criteriaArray.length;

  return {
    success: true,
    data: {
      summary: {
        totalCriteria,
        achievedCount,
        achievedPercent: totalCriteria > 0 ? Math.round((achievedCount / totalCriteria) * 100) : 0,
      },
      criteria: criteriaArray,
      final_grade: (p?.final_grade as string) || 'PENDING',
    },
    report: typeof p?.consolidated_summary === 'string' && p.consolidated_summary
      ? String(p.consolidated_summary)
      : typeof p?.summary === 'string' ? String(p.summary) : '',
  };
}
