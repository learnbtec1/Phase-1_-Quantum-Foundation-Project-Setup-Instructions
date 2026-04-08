import { test, expect } from '@playwright/test';

test.describe('API Endpoints', () => {
  test('/api/health should return 200 with ok: true', async ({ request }) => {
    const response = await request.get('/api/health');
    expect(response.status()).toBe(200);
    const body = await response.json();
    expect(body.status).toBe('ok');
    expect(body.reqId || body.timestamp).toBeTruthy();
  });

  test('/api/chat returns 401 without Authorization Bearer', async ({ request }) => {
    const response = await request.post('/api/chat', {
      data: { message: 'test' },
    });
    expect(response.status()).toBe(401);
    const body = await response.json();
    expect(body.error).toBeTruthy();
  });

  test('/api/chat with E2E_JWT may reach upstream (optional)', async ({ request }) => {
    const token = process.env.E2E_JWT;
    test.skip(!token, 'Set E2E_JWT to exercise authenticated BFF → backend');
    const response = await request.post('/api/chat', {
      data: { message: 'test' },
      headers: { Authorization: `Bearer ${token}` },
    });
    const body = await response.json();
    expect(body.reqId || body.error || body.reply).toBeTruthy();
    expect([200, 401, 403, 429, 502, 503]).toContain(response.status());
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
