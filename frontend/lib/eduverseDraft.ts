/** Cross-page handoff: Workspace → Assessment / Plagiarism (Golden Flow). */
export const EDUVERSE_DRAFT_TEXT_KEY = "eduverse_draft_text";

/**
 * Read and clear one-shot draft from `localStorage` (client-only).
 * Returns `null` if missing or empty.
 */
export function consumeEduverseDraftText(): string | null {
  if (typeof window === "undefined") return null;
  try {
    const v = localStorage.getItem(EDUVERSE_DRAFT_TEXT_KEY);
    if (v && v.trim()) {
      localStorage.removeItem(EDUVERSE_DRAFT_TEXT_KEY);
      return v;
    }
  } catch {
    /* ignore */
  }
  return null;
}

export function setEduverseDraftText(text: string): void {
  if (typeof window === "undefined") return;
  try {
    localStorage.setItem(EDUVERSE_DRAFT_TEXT_KEY, text);
  } catch {
    /* ignore */
  }
}
