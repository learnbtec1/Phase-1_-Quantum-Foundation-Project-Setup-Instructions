import { authHeaders } from '@/lib/auth';
import { getApiBase } from '@/lib/api';

export type RagQueryResponse = { results: string[] };

export async function fetchMarketingPlanCriteria(): Promise<RagQueryResponse> {
  const res = await fetch(`${getApiBase()}/api/v1/rag/query`, {
    method: 'POST',
    credentials: 'include',
    headers: {
      'Content-Type': 'application/json',
      ...authHeaders(),
    },
    body: JSON.stringify({
      query: 'marketing plan assignment criteria',
      scope: 'assignments',
    }),
  });

  if (!res.ok) throw new Error(`RAG failed: ${res.status}`);

  return res.json() as Promise<RagQueryResponse>;
}
