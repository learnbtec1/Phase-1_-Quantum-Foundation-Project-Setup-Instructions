import { test, expect, ConsoleMessage } from '@playwright/test';
import * as fs from 'fs';
import * as path from 'path';

/**
 * DrHamzaOrb Avatar + /evaluate Diagnostic Test Suite
 * Captures console logs, screenshots, and validates rendering
 */

// Console log collector
const consoleLogs: { type: string; text: string; location: string; url: string }[] = [];
const consoleErrors: string[] = [];

test.describe('DrHamzaOrb Avatar Diagnostics', () => {
  
  // Setup: Capture console logs
  test.beforeEach(async ({ page }) => {
    page.on('console', (msg: ConsoleMessage) => {
      const type = msg.type();
      const text = msg.text();
      const location = msg.location();
      const url = page.url();
      
      consoleLogs.push({
        type,
        text,
        location: `${location.url}:${location.lineNumber}:${location.columnNumber}`,
        url
      });
      
      if (type === 'error') {
        consoleErrors.push(`[${url}] ${text}`);
      }
    });
    
    // Also capture page errors
    page.on('pageerror', (error) => {
      consoleErrors.push(`[PAGE ERROR at ${page.url()}] ${error.message}\n${error.stack}`);
    });
  });

  test('Dashboard: Avatar should render and be visible', async ({ page }) => {
    console.log('🧪 TEST 1/3: Navigating to /dashboard...');
    
    await page.goto('/dashboard', { waitUntil: 'networkidle' });
    
    // Wait a bit for client-side hydration
    await page.waitForTimeout(2000);
    
    // Take screenshot
    const screenshotPath = path.join(process.cwd(), 'artifacts', 'dashboard.png');
    await page.screenshot({ path: screenshotPath, fullPage: true });
    console.log(`📸 Screenshot saved: ${screenshotPath}`);
    
    // Check for avatar presence
    const avatar = page.locator('[data-testid="avatar-orb"]');
    const avatarExists = await avatar.count();
    
    console.log(`🔍 Avatar elements found: ${avatarExists}`);
    
    if (avatarExists > 0) {
      const isVisible = await avatar.first().isVisible();
      console.log(`👁️ Avatar visibility: ${isVisible}`);
      
      // Get computed styles
      const styles = await avatar.first().evaluate((el) => {
        const computed = window.getComputedStyle(el);
        return {
          display: computed.display,
          opacity: computed.opacity,
          visibility: computed.visibility,
          width: computed.width,
          height: computed.height,
          background: computed.background,
          zIndex: computed.zIndex,
        };
      });
      console.log('🎨 Avatar computed styles:', JSON.stringify(styles, null, 2));
      
      expect(isVisible).toBe(true);
    } else {
      console.log('❌ Avatar element NOT found in DOM');
      expect(avatarExists).toBeGreaterThan(0);
    }
  });

  test('Evaluate: Page should render without white screen', async ({ page }) => {
    console.log('🧪 TEST 2/3: Navigating to /evaluate...');
    
    await page.goto('/evaluate', { waitUntil: 'networkidle' });
    
    // Wait for hydration
    await page.waitForTimeout(2000);
    
    // Take screenshot
    const screenshotPath = path.join(process.cwd(), 'artifacts', 'evaluate.png');
    await page.screenshot({ path: screenshotPath, fullPage: true });
    console.log(`📸 Screenshot saved: ${screenshotPath}`);
    
    // Check explicit teacher label in HTML fallback card
    const teacherLabel = page.getByText('المعلم حمزة');
    await expect(teacherLabel).toBeVisible();
    console.log('👁️ Teacher label visibility: true');
    
    // Check if page is completely white (no meaningful content)
    const bodyText = await page.locator('body').innerText();
    const hasContent = bodyText.trim().length > 0;
    console.log(`📄 Page has text content: ${hasContent} (${bodyText.length} chars)`);
    
    // Teacher avatar scene should exist (R3F canvas)
    const canvas = page.locator('canvas');
    const canvasExists = await canvas.count();
    console.log(`🔍 Teacher scene canvas exists: ${canvasExists > 0}`);
    expect(canvasExists).toBeGreaterThan(0);

    // Check for teacher fallback avatar (main marker)
    const teacherFallback = page.locator('[data-testid="teacher-fallback-avatar"]');
    const fallbackExists = await teacherFallback.count();
    console.log(`🔍 Teacher fallback avatar exists: ${fallbackExists > 0}`);
    
    if (fallbackExists > 0) {
      await expect(teacherFallback).toBeVisible();
      await teacherFallback.click();
      await expect(teacherFallback).toHaveAttribute('aria-pressed', 'true');
      console.log('✅ Teacher fallback avatar is visible and interactive');
    }
    
    await expect(teacherLabel).toBeVisible();
  });

  test('Student: Baseline test for comparison', async ({ page }) => {
    console.log('🧪 TEST 3/3: Navigating to /student (baseline)...');
    
    await page.goto('/student', { waitUntil: 'networkidle' });
    await page.waitForTimeout(2000);
    
    // Take screenshot
    const screenshotPath = path.join(process.cwd(), 'artifacts', 'student.png');
    await page.screenshot({ path: screenshotPath, fullPage: true });
    console.log(`📸 Screenshot saved: ${screenshotPath}`);
    
    // Check if page renders at all
    const bodyText = await page.locator('body').innerText();
    console.log(`📄 Student page rendered: ${bodyText.length > 100}`);
    
    expect(bodyText.length).toBeGreaterThan(50);
  });

  // Cleanup: Export console logs
  test.afterAll(async () => {
    const artifactsDir = path.join(process.cwd(), 'artifacts');
    
    // Ensure artifacts directory exists
    if (!fs.existsSync(artifactsDir)) {
      fs.mkdirSync(artifactsDir, { recursive: true });
    }
    
    // Save console logs
    const consoleLogPath = path.join(artifactsDir, 'console-logs.json');
    fs.writeFileSync(consoleLogPath, JSON.stringify(consoleLogs, null, 2));
    console.log(`📋 Console logs saved: ${consoleLogPath}`);
    
    // Save errors separately
    if (consoleErrors.length > 0) {
      const errorLogPath = path.join(artifactsDir, 'console-errors.txt');
      fs.writeFileSync(errorLogPath, consoleErrors.join('\n\n'));
      console.log(`❌ Console errors saved: ${errorLogPath}`);
      console.log(`\n🔴 FOUND ${consoleErrors.length} CONSOLE ERRORS:\n`);
      consoleErrors.forEach((err, i) => {
        console.log(`[${i + 1}] ${err}\n`);
      });
    } else {
      console.log('✅ No console errors detected');
    }
  });
});
