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
  // In CI, `github` is what annotates the failing line in the diff, and the
  // HTML report is what a person opens afterwards. Both, because a run that
  // fails only on a machine nobody can log into is a run whose evidence has to
  // survive it: `.github/actions/verify` uploads this report and the traces
  // beside it as an artifact, which is what issue #45 spent three red runs
  // without.
  reporter: process.env.CI ? [['github'], ['html', { open: 'never' }]] : [['list']],
  use: { trace: 'retain-on-failure' },
  /**
   * Two projects, because there are two layouts and only one of them can be
   * had by making a desktop window narrow. `specs/phone/` is the phone: a
   * Pixel 7 profile, which brings a 412px viewport, a coarse pointer, touch
   * events and no hover — and it is that pointer, not the width, that decides
   * whether Enter sends, whether a message's actions are a rail or a menu, and
   * whether the app listens for a key pressed at nothing.
   *
   * Everything else stays on the desktop, and stays there deliberately: those
   * specs press Preferences, hover for a rail and drag the window about, none
   * of which a phone can do or is offered.
   */
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
      testIgnore: 'phone/**',
    },
    {
      name: 'phone',
      use: { ...devices['Pixel 7'] },
      testMatch: 'phone/**/*.spec.ts',
    },
  ],
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
