import { defineConfig, devices } from '@playwright/test';

const API_PORT = Number(process.env.FAKE_API_PORT ?? 4310);

/**
 * Only one server is started for the suite: the fake model endpoint. The app's
 * own server is started per test by the `server` fixture, on its own port with
 * its own empty data folder, serving the production build — because that is the
 * only arrangement the app has. It reads its documents from the server when it
 * starts, so there is no dev-server-and-browser-storage mode left to test.
 *
 * The build is therefore a prerequisite: `npm run e2e` does it first.
 */
export default defineConfig({
  testDir: './specs',
  timeout: 45_000,
  expect: { timeout: 10_000 },
  fullyParallel: false,
  workers: 1,
  reporter: process.env.CI ? 'github' : [['list']],
  use: { trace: 'retain-on-failure' },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: [
    {
      command: `node fake-openai-server.mjs`,
      url: `http://localhost:${API_PORT}/v1/models`,
      env: { FAKE_API_PORT: String(API_PORT) },
      // Never reused, in CI or here. It keeps a counter of its own, so a run
      // that inherited one from an earlier run would not start where it
      // thought — and, worse, an edit to the fake would silently not be what
      // is under test until whoever made it noticed the old process.
      reuseExistingServer: false,
      stdout: 'pipe',
    },
  ],
});

export const FAKE_API_URL = `http://localhost:${API_PORT}/v1`;
