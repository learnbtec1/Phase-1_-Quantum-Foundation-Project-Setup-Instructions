/**
 * Level 6.1 — **Ultra-short** behavior memory (sliding window, ~8s).
 *
 * **Purpose:** Used only inside {@link BehaviorBrainHost} to avoid repeating the same
 * motion *intent class* back-to-back in the Level-6 pipeline (anti-repetition).
 *
 * **Not the same as:**
 * - **`useBrainStore.longTermMemory`** — persistent user profile (interests, important moments);
 *   session-scoped, updated via `learnInterest` / `addImportantMoment` / EmotionalMemoryManager.
 * - **`useBrainStore.emotionalMemory`** — rolling emotional *trajectory* entries for analytics
 *   and LLM context; managed by {@link EmotionalMemoryManager}.
 *
 * This class is **not** persisted, not sent to the LLM, and not user-specific narrative memory.
 */

export type BehaviorMemoryEntry = {
  intentType: string;
  emotion: string;
  timestamp: number;
};

const MEMORY_WINDOW_MS = 8000;

export class BehaviorMemory {
  private memory: BehaviorMemoryEntry[] = [];

  add(entry: BehaviorMemoryEntry): void {
    this.memory.push(entry);
    this.cleanup();
  }

  private cleanup(): void {
    const now = Date.now();
    this.memory = this.memory.filter((m) => now - m.timestamp < MEMORY_WINDOW_MS);
  }

  /** True if this intent type appeared in the sliding window. */
  wasRecentlyUsed(intentType: string): boolean {
    this.cleanup();
    return this.memory.some((m) => m.intentType === intentType);
  }

  clear(): void {
    this.memory = [];
  }
}
