/**
 * RAG mini-KB: load JSON/MD from /public/knowledge/**
 * Minimal indexing; returns relevant snippets for prompt injection.
 */
const KNOWLEDGE_BASE = '/knowledge';

export interface KnowledgeSnippet {
  id: string;
  content: string;
  source: string;
}

const snippetsCache: KnowledgeSnippet[] = [];
let loaded = false;

export async function loadKnowledge(): Promise<KnowledgeSnippet[]> {
  if (loaded && snippetsCache.length > 0) return snippetsCache;

  const files = ['btec-basics.md', 'pestle-intro.md', 'swot-intro.md'];
  for (const f of files) {
    try {
      const res = await fetch(`${KNOWLEDGE_BASE}/${f}`);
      if (res.ok) {
        const text = await res.text();
        snippetsCache.push({
          id: f,
          content: text.slice(0, 1500),
          source: f,
        });
      }
    } catch {
      /* skip missing */
    }
  }
  loaded = true;
  return snippetsCache;
}

export function getRelevantSnippets(query: string, limit = 2): KnowledgeSnippet[] {
  const q = query.toLowerCase();
  return snippetsCache
    .filter((s) => s.content.toLowerCase().includes(q) || s.source.toLowerCase().includes(q))
    .slice(0, limit);
}
