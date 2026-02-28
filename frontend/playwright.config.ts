import { defineConfig, devices } from '@playwright/test';

const PW_MODE = process.env.PW_MODE || 'live';
const SKIP_WEBSERVER = process.env.SKIP_WEBSERVER === '1' || process.env.PW_SKIP_WEBSERVER === '1';

export default defineConfig({
  timeout: 60_000,
  testDir: './tests/e2e',
  fullyParallel: false,
  use: {
    baseURL: process.env.PW_BASE_URL || 'http://127.0.0.1:3011',
    trace: 'retain-on-failure',
    video: 'retain-on-failure',
  },
  ...(SKIP_WEBSERVER
    ? {}
    : {
        webServer: {
          command: 'npm run dev -- -p 3011',
          url: 'http://127.0.0.1:3011',
          timeout: 120_000,
          reuseExistingServer: !process.env.CI,
          env: { PW_MODE },
        },
      }),
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
});
