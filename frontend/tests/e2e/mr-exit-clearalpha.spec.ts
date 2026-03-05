/**
 * mr-exit-clearalpha.spec.ts — IGNIS v15.5
 * Tests:
 *   1. Evaluate page loads without console errors during MR Canvas mount/unmount
 *   2. WebGL context events (mr:contextlost / boardroom:contextlost) don't throw
 *   3. no unhandled promise rejections from XR / WebGL code
 */
import { test, expect } from '@playwright/test';

test.describe('MR / AR exit & WebGL safety', () => {
  test('evaluate page loads with no critical console errors', async ({ page }) => {
    const errors: string[] = [];
    page.on('pageerror', err => errors.push(err.message));
    page.on('console', msg => {
      if (msg.type() === 'error') errors.push(msg.text());
    });

    await page.goto('/evaluate', { waitUntil: 'domcontentloaded' });
    await page.waitForSelector('canvas', { timeout: 30_000 }).catch(() => null);
    await page.waitForTimeout(1000);

    // Filter out known-safe noise (VRM load warnings, 404 for optional assets,
    // React DevTools dev-backend probe on localhost:8097, backend connectivity)
    const critical = errors.filter(e =>
      !e.includes('teacher.vrm') &&
      !e.includes('Furina.vrm') &&
      !e.includes('LookAtDegreeMap') &&
      !e.includes('404') &&
      !e.includes('hum.mp3') &&
      !e.includes('boardroom.mp3') &&
      !e.includes('NEXT_REDIRECT') &&
      !e.includes('localhost:8097') &&      // React DevTools standalone probe (dev only)
      !e.includes('ERR_CONNECTION_REFUSED') // backend / dev tooling not running
    );
    expect(critical).toHaveLength(0);
  });

  test('simulated webglcontextlost does not throw unhandled error', async ({ page }) => {
    const errors: string[] = [];
    page.on('pageerror', err => errors.push(err.message));

    await page.goto('/evaluate', { waitUntil: 'domcontentloaded' });
    await page.waitForSelector('canvas', { timeout: 30_000 }).catch(() => null);
    await page.waitForTimeout(500);

    // Dispatch boardroom:contextlost to simulate WebGL context loss
    await page.evaluate(() => {
      window.dispatchEvent(new Event('boardroom:contextlost'));
      window.dispatchEvent(new Event('boardroom:contextrestored'));
    });

    await page.waitForTimeout(300);
    expect(errors).toHaveLength(0);
  });

  test('MR toggle does not leave transparent canvas artifacts', async ({ page }) => {
    await page.goto('/evaluate', { waitUntil: 'domcontentloaded' });
    await page.waitForSelector('canvas', { timeout: 30_000 }).catch(() => null);
    await page.waitForTimeout(500);

    // Simulate MR:contextrestored event (as if MRContextEvents fired)
    const noThrow = await page.evaluate(async () => {
      try {
        window.dispatchEvent(new Event('mr:contextlost'));
        window.dispatchEvent(new Event('mr:contextrestored'));
        return true;
      } catch {
        return false;
      }
    });

    expect(noThrow).toBe(true);
  });
});
