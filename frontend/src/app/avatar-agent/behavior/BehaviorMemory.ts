/**
 * Level 6.1 — Short-term behavior memory (anti-repetition, personality consistency).
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
