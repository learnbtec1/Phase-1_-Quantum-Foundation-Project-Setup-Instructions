import { test, expect } from '@playwright/test';

/**
 * E2E: `/avatar-agent` mounts AvatarAgentClient → Canvas → VRMSkeletonManager + LipSyncManager.
 * Validates UI + WebGL canvas; optionally observes WebSocket attempts (CI build sets agent WS URL).
 * Full R3F/motion graphs are not asserted in Node integration tests — see brainMotionPipeline.integration.test.ts.
 */
test.describe('Avatar agent pipeline (UI + canvas)', () => {
  test('loads /avatar-agent with a visible R3F canvas', async ({ page }) => {
    const pageErrors: string[] = [];
    page.on('pageerror', (err) => pageErrors.push(err.message));

    await page.goto('/avatar-agent', {
      waitUntil: 'domcontentloaded',
      timeout: 90_000,
    });

    const canvas = page.locator('canvas').first();
    await expect(canvas).toBeVisible({ timeout: 60_000 });

    await page.waitForTimeout(3000);

    const fatal = pageErrors.filter(
      (m) =>
        !m.includes('ResizeObserver') &&
        !m.includes('Non-Error promise rejection') &&
        !m.includes('WebSocket'),
    );
    expect(fatal, `page errors: ${fatal.join(' | ')}`).toHaveLength(0);
  });

  test('canvas has non-zero layout size (WebGL surface)', async ({ page }) => {
    await page.goto('/avatar-agent', {
      waitUntil: 'domcontentloaded',
      timeout: 90_000,
    });
    const canvas = page.locator('canvas').first();
    await expect(canvas).toBeVisible({ timeout: 60_000 });
    const box = await canvas.boundingBox();
    expect(box, 'canvas bounding box').toBeTruthy();
    expect(box!.width, 'canvas width').toBeGreaterThan(0);
    expect(box!.height, 'canvas height').toBeGreaterThan(0);
  });

  test('may initiate WebSocket connections (agent pipeline)', async ({ page }) => {
    const wsUrls: string[] = [];
    page.on('websocket', (ws) => {
      wsUrls.push(ws.url());
    });

    await page.goto('/avatar-agent', {
      waitUntil: 'domcontentloaded',
      timeout: 90_000,
    });
    await page.locator('canvas').first().waitFor({ state: 'visible', timeout: 60_000 });
    await page.waitForTimeout(5000);

    if (wsUrls.length > 0) {
      expect(
        wsUrls.some((u) => /^wss?:\/\//u.test(u)),
        `expected at least one ws: or wss: URL, got: ${wsUrls.join(', ')}`,
      ).toBe(true);
    }
  });
});
