import { apiBase, authHeaders } from '@/lib/auth';

export type RagQueryResponse = { results: string[] };

export async function fetchMarketingPlanCriteria(): Promise<RagQueryResponse> {
  const res = await fetch(`${apiBase()}/api/v1/rag/query`, {
    method: 'POST',
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
