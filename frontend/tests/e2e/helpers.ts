import { Page } from '@playwright/test';

const PW_MODE = process.env.PW_MODE || 'live';

export const isMockMode = (): boolean => PW_MODE === 'mock';

function minimalTTSWithTimingBody(): string {
  const samples = 2400;
  const pcm = new Uint8Array(samples * 2);
  const b64 = Buffer.from(pcm).toString('base64');
  return JSON.stringify({
    audio_base64: b64,
    word_timings: [{ word: 'مرحبا', start_time: 0, end_time: 0.1 }],
    sample_rate: 24000,
  });
}

export async function setupMockRoutes(page: Page): Promise<void> {
  if (!isMockMode()) return;
  await page.route('**/api/chat', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ reply: 'مرحبا' }),
    })
  );
  await page.route('**/api/tts-with-timing', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: minimalTTSWithTimingBody(),
    })
  );
  await page.route('**/api/tts', (route) => route.fulfill({ status: 503 }));
}

export async function clearStorage(page: Page): Promise<void> {
  await page.goto('about:blank');
  await page.evaluate(async () => {
    try {
      const regs = await navigator.serviceWorker?.getRegistrations?.();
      regs?.forEach((r) => r.unregister());
    } catch {}
    try {
      const keys = await caches.keys();
      await Promise.all(keys.map((k) => caches.delete(k)));
    } catch {}
    try {
      localStorage.clear();
      sessionStorage.clear();
    } catch {}
  });
}
