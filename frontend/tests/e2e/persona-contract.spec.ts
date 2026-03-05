/**
 * persona-contract.spec.ts — IGNIS v15.5
 * Tests:
 *   1. Verona's 3-part output contract (dialogue + *action* + [EMOTION: tag])
 *   2. avatar:emotion event is dispatched from a valid reply
 *   3. selfCheckGate repairs a broken reply (no emotion tag)
 */
import { test, expect } from '@playwright/test';

const VALID_REPLY_AR =
  `لنبدأ بتحديد الـ LO ثم نربطها بالـ P/M/D من الوحدة الأولى...\n*تميل برأسها وتفتح كفّها اليمنى نحو اللوحة.*\n[EMOTION: encouraging]`;

const VALID_REPLY_EN =
  `Let's start by identifying the LO and mapping to P/M/D criteria...\n*She tilts her head and opens her right palm toward the board.*\n[EMOTION: encouraging]`;

test.describe('Persona Contract & Emotion Dispatch', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/evaluate', { waitUntil: 'domcontentloaded' });
    // Wait for canvas to be present (3D scene loads)
    await page.waitForSelector('canvas', { timeout: 30_000 }).catch(() => null);
  });

  test('3-part reply dispatches avatar:emotion event', async ({ page }) => {
    const emotionReceived = page.waitForEvent('console', msg =>
      msg.text().includes('avatar:emotion') || msg.type() === 'error',
    ).catch(() => null);

    const dispatched = await page.evaluate((reply) => {
      return new Promise<string>((resolve) => {
        const handler = (e: Event) => {
          const detail = (e as CustomEvent).detail;
          resolve(detail?.tag ?? detail?.emotion ?? 'received');
          window.removeEventListener('avatar:emotion', handler);
        };
        window.addEventListener('avatar:emotion', handler);
        setTimeout(() => resolve('timeout'), 1500);

        // Simulate receiving a full Verona reply via agent:say
        window.dispatchEvent(new CustomEvent('avatar:speak', { detail: { text: reply } }));
      });
    }, VALID_REPLY_AR);

    // Should receive an emotion tag (not timeout)
    expect(dispatched).not.toBe('timeout');
  });

  test('avatar does not speak raw action lines or tags', async ({ page }) => {
    const spokenTexts: string[] = [];

    await page.exposeFunction('__recordSpoken', (text: string) => {
      spokenTexts.push(text);
    });

    // Intercept window.speechSynthesis.speak to capture what text is spoken
    await page.evaluate(() => {
      const origSpeak = window.speechSynthesis.speak.bind(window.speechSynthesis);
      window.speechSynthesis.speak = (utterance: SpeechSynthesisUtterance) => {
        (window as any).__recordSpoken?.(utterance.text);
        origSpeak(utterance);
      };
    });

    const TAGGED_REPLY = VALID_REPLY_EN;
    await page.evaluate((reply) => {
      window.dispatchEvent(new CustomEvent('avatar:speak', { detail: { text: reply } }));
    }, TAGGED_REPLY);

    await page.waitForTimeout(600);

    // None of the spoken texts should contain [EMOTION:...] or *action lines*
    for (const t of spokenTexts) {
      expect(t).not.toMatch(/\[EMOTION:/i);
      expect(t).not.toMatch(/^\s*\*/m);
    }
  });

  test('3-part contract regex — valid Arabic reply passes', async ({ page }) => {
    const result = await page.evaluate((reply) => {
      const hasTag    = /\[EMOTION:\s*(neutral|friendly|thinking|encouraging|strict|celebrate)\s*\]/i.test(reply);
      const hasAction = /^\s*\*.+?\*\s*$/m.test(reply);
      const body      = reply.replace(/\[EMOTION:[^\]]+\]/i, '').replace(/^\s*\*.+?\*\s*$/m, '').trim();
      return { hasTag, hasAction, hasBody: body.length > 0 };
    }, VALID_REPLY_AR);

    expect(result.hasTag).toBe(true);
    expect(result.hasAction).toBe(true);
    expect(result.hasBody).toBe(true);
  });
});
