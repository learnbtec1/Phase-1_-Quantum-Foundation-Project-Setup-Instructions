/**
 * Next.js instrumentation — runs once on server startup (Node).
 * Confirms the canonical app is frontend/ when this file is loaded.
 */
export async function register(): Promise<void> {
  if (process.env.NEXT_RUNTIME === 'nodejs') {
    const mode =
      process.env.NODE_ENV === 'production' ? 'production mode' : 'development';
    console.log(`[Cogni] ACTIVE APP: frontend/ (${mode})`);
  }
}
