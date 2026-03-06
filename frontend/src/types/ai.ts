/**
 * Bridge: re-exports all Digital Human AI types from the repo-root types file.
 *
 * frontend/tsconfig.json maps "@/" → "src/", so "@/types/ai" resolves here.
 * The canonical types live at the repo root (types/ai.ts), three levels up.
 */
export * from '../../../types/ai';
