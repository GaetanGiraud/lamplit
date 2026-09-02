import { defineConfig, devices } from '@playwright/test';

const APP_PORT = Number(process.env.APP_PORT ?? 4210);
const API_PORT = Number(process.env.FAKE_API_PORT ?? 4310);

export default defineConfig({
  testDir: './specs',
  timeout: 45_000,
  expect: { timeout: 10_000 },
  fullyParallel: false,
  workers: 1,
  reporter: process.env.CI ? 'github' : [['list']],
  use: {
    baseURL: `http://localhost:${APP_PORT}`,
    trace: 'retain-on-failure',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: [
    {
      command: `node fake-openai-server.mjs`,
      url: `http://localhost:${API_PORT}/v1/models`,
      env: { FAKE_API_PORT: String(API_PORT) },
      reuseExistingServer: !process.env.CI,
      stdout: 'pipe',
    },
    {
      command: `npm run start -w app -- --port ${APP_PORT}`,
      url: `http://localhost:${APP_PORT}`,
      cwd: '..',
      reuseExistingServer: !process.env.CI,
      timeout: 180_000,
    },
  ],
});

export const FAKE_API_URL = `http://localhost:${API_PORT}/v1`;
