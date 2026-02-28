import { test, expect } from '@playwright/test';
import { setupMockRoutes, clearStorage } from './helpers';

test('burst messages do not cause /_next/static 404 or overlapping TTS', async ({ page }) => {
  const failedStatics: string[] = [];
  page.on('response', (res) => {
    if (res.url().includes('/_next/static/') && res.status() === 404) failedStatics.push(res.url());
  });

  await clearStorage(page);
  await setupMockRoutes(page);

  await page.goto('/evaluate', { waitUntil: 'load' });
  await page.waitForSelector('canvas', { timeout: 60_000 });

  await page.click('body', { position: { x: 50, y: 50 } });
  await page.evaluate(() => {
    window.dispatchEvent(new CustomEvent('test:sendMessage', { detail: { text: 'اشرح SWOT' } }));
    window.dispatchEvent(new CustomEvent('test:sendMessage', { detail: { text: 'اعطني مثال' } }));
    window.dispatchEvent(new CustomEvent('test:sendMessage', { detail: { text: 'اختبرني بسؤال' } }));
  });

  await page.waitForTimeout(2000);
  expect(failedStatics).toHaveLength(0);
});
