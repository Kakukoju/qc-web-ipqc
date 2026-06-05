import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: '.',
  testMatch: 'capture-screenshots.ts',
  timeout: 120_000,
  use: {
    baseURL: 'https://52-192-28-39.sslip.io',
    headless: true,
    screenshot: 'off',
    ignoreHTTPSErrors: true,
  },
});
