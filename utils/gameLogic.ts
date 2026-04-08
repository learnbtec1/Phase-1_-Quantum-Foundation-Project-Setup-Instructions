import type { SavedProgress } from '@/types/gameTypes';

const STORAGE_KEY = 'eduverse-vr-sim';

export function saveProgress(data: SavedProgress) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
}

export function loadProgress(): SavedProgress | null {
  const raw = localStorage.getItem(STORAGE_KEY);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as SavedProgress;
  } catch {
    return null;
  }
}
