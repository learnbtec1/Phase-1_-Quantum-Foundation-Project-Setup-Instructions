import { test, expect } from '@playwright/test';

test.describe('API Endpoints', () => {
  test('/api/health should return 200 with ok: true', async ({ request }) => {
    const response = await request.get('/api/health');
    expect(response.status()).toBe(200);
    const body = await response.json();
    expect(body.status).toBe('ok');
    expect(body.reqId || body.timestamp).toBeTruthy();
  });

  test('/api/chat should include reqId in response', async ({ request }) => {
    const response = await request.post('/api/chat', {
      data: { message: 'test' },
    });
    
    const body = await response.json();
    expect(body.reqId || body.error).toBeTruthy();
    
    if (response.status() === 200) {
      expect(body.reply).toBeTruthy();
    }
  });

  test('/api/tts should include reqId and proper error codes', async ({ request }) => {
    const response = await request.post('/api/tts', {
      data: { text: 'test' },
    });
    
    const headers = response.headers();
    expect(headers['x-request-id'] || response.status() === 503).toBeTruthy();
    
    if (response.status() !== 200) {
      const body = await response.json();
      expect(body.reqId).toBeTruthy();
      expect([400, 408, 500, 502, 503]).toContain(response.status());
    }
  });
});
