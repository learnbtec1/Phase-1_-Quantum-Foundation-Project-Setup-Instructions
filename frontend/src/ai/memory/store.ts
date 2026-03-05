/**
 * Short-term (in-memory) and long-term (localStorage) memory.
 * Stores language preference, pacing, mastered/weak topics.
 */
const STORAGE_KEY = 'avatar-memory';
const MAX_TURNS = 20;

export interface Turn {
  role: 'user' | 'assistant';
  content: string;
  ts: number;
}

export interface MemorySnapshot {
  language: string;
  turns: Turn[];
  masteredTopics: string[];
  weakTopics: string[];
}

let shortTerm: Turn[] = [];

export function getMemorySnapshot(studentId?: string): MemorySnapshot {
  const stored = typeof window !== 'undefined' && studentId
    ? tryParse(localStorage.getItem(`${STORAGE_KEY}-${studentId}`))
    : null;
  const turns = shortTerm.slice(-MAX_TURNS);
  const arr = (v: unknown): string[] => (Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : []);
  return {
    language: (typeof stored?.language === 'string' ? stored.language : 'ar'),
    turns,
    masteredTopics: arr(stored?.masteredTopics),
    weakTopics: arr(stored?.weakTopics),
  };
}

export function addTurn(role: 'user' | 'assistant', content: string): void {
  shortTerm.push({ role, content, ts: Date.now() });
  if (shortTerm.length > MAX_TURNS) shortTerm = shortTerm.slice(-MAX_TURNS);
}

export function setLanguage(lang: string, studentId?: string): void {
  if (typeof window === 'undefined' || !studentId) return;
  const key = `${STORAGE_KEY}-${studentId}`;
  const prev = tryParse(localStorage.getItem(key)) ?? {};
  localStorage.setItem(key, JSON.stringify({ ...prev, language: lang }));
}

function tryParse(s: string | null): Record<string, unknown> | null {
  if (!s) return null;
  try {
    return JSON.parse(s) as Record<string, unknown>;
  } catch {
    return null;
  }
}
