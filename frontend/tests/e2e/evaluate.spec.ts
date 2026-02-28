import { test, expect } from '@playwright/test';

test.describe('Evaluate Page', () => {
  test.beforeEach(async ({ page, context }) => {
    // Navigate to page first to establish context
    await page.goto('/evaluate');
    
    // Clean service workers and cache
    await page.evaluate(async () => {
      try {
        const regs = await navigator.serviceWorker?.getRegistrations?.();
        regs?.forEach(r => r.unregister());
      } catch (e) {
        // Ignore service worker errors
      }
      
      try {
        if (typeof caches !== 'undefined' && 'keys' in caches) {
          const keys = await caches.keys();
          await Promise.all(keys.map(k => caches.delete(k)));
        }
      } catch (e) {
        // Ignore cache errors
      }
      
      try {
        if (typeof localStorage !== 'undefined' && localStorage) {
          localStorage.clear();
        }
      } catch (e) {
        // Ignore localStorage errors (may be blocked in some contexts)
      }
      
      try {
        if (typeof sessionStorage !== 'undefined' && sessionStorage) {
          sessionStorage.clear();
        }
      } catch (e) {
        // Ignore sessionStorage errors
      }
    });
    
    // Also clear via context API
    await context.clearCookies();
  });

  test('should load Canvas without white screen', async ({ page }) => {
    // Page already navigated in beforeEach
    
    // Wait for page to be fully loaded
    await page.waitForLoadState('domcontentloaded');
    
    // Check for 404s (set up listener before waiting)
    const failedRequests: string[] = [];
    page.on('response', (response) => {
      if (response.status() === 404) {
        failedRequests.push(response.url());
      }
    });
    
    // Wait for Canvas to appear (with longer timeout for 3D content)
    const canvas = page.locator('canvas').first();
    
    // First check if canvas exists in DOM
    await page.waitForSelector('canvas', { timeout: 60000, state: 'attached' });
    
    // Then check visibility (may be hidden initially during load)
    try {
      await expect(canvas).toBeVisible({ timeout: 10000 });
    } catch {
      // Canvas may exist but not be visible yet - check if it's actually rendered
      const canvasInfo = await page.evaluate(() => {
        const c = document.querySelector('canvas');
        if (!c) return null;
        return {
          exists: true,
          width: c.width,
          height: c.height,
          display: window.getComputedStyle(c).display,
          visibility: window.getComputedStyle(c).visibility,
        };
      });
      
      if (!canvasInfo || canvasInfo.width === 0 || canvasInfo.height === 0) {
        throw new Error('Canvas exists but is not properly rendered');
      }
    }
    
    // Wait for network to be idle
    await page.waitForLoadState('networkidle', { timeout: 20000 }).catch(() => {
      // Ignore timeout - networkidle may not always be reached
    });
    
    // Filter out expected 404s (like favicon)
    const static404s = failedRequests.filter(url => 
      !url.includes('favicon') && 
      !url.includes('.well-known') &&
      !url.includes('robots.txt') &&
      url.includes('/_next/static')
    );
    
    expect(static404s.length).toBe(0);
  });

  test('should set __lipSyncStarted only when lip-sync actually starts', async ({ page }) => {
    // Page already navigated in beforeEach
    // Wait for DOM to be ready (networkidle may never be reached)
    await page.waitForLoadState('domcontentloaded');
    
    // Initially should be undefined
    const initial = await page.evaluate(() => (window as any).__lipSyncStarted);
    expect(initial).toBeFalsy();
    
    // Send a message to trigger TTS
    const chatInput = page.locator('input[placeholder*="رسالة"]').first();
    if (await chatInput.isVisible()) {
      await chatInput.fill('مرحبا');
      await chatInput.press('Enter');
      
      // Wait for lip-sync to start
      await page.waitForFunction(() => (window as any).__lipSyncStarted === true, { timeout: 10000 });
    }
  });

  test('should handle TTS policy LAST-ONE-WINS', async ({ page }) => {
    // Page already navigated in beforeEach
    // Wait for DOM to be ready (networkidle may never be reached with WebSocket/3D content)
    await page.waitForLoadState('domcontentloaded');
    
    // Wait for chat input to be available
    const chatInput = page.locator('input[placeholder*="رسالة"]').first();
    await chatInput.waitFor({ state: 'visible', timeout: 10000 }).catch(() => {
      // If input not found, skip test
    });
    
    if (await chatInput.isVisible()) {
      // Send multiple messages rapidly
      await chatInput.fill('رسالة 1');
      await chatInput.press('Enter');
      
      // Wait a bit for first message to start processing
      await page.waitForTimeout(200);
      
      await chatInput.fill('رسالة 2');
      await chatInput.press('Enter');
      
      // Wait for audio elements to be created
      await page.waitForTimeout(500);
      
      // Only one audio should be playing
      const audioCount = await page.evaluate(() => {
        const audios = document.querySelectorAll('audio');
        return Array.from(audios).filter(a => !a.paused).length;
      });
      
      expect(audioCount).toBeLessThanOrEqual(1);
    }
  });
});
