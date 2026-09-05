import { ElectronApplication, Page, _electron as electron, expect, test } from '@playwright/test';
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { once } from 'node:events';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { IS_BUILT } from './persistence-server';

/**
 * The desktop shell, started the way a person starts it: one process, no port
 * to pick, no folder to choose.
 *
 * This is `npm run smoke` written down — the parts of it a machine can check.
 * It runs before anything is published, because everything it asserts is
 * something that can only break in the twenty lines that Electron adds: the
 * server starting in-process, the window finding it, and the documents landing
 * in the user's profile rather than beside a script.
 */

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, '..', '..');
const ELECTRON_DIR = join(ROOT, 'electron');

const ELECTRON_INSTALLED = existsSync(join(ROOT, 'node_modules', 'electron', 'path.txt'));

// The whole point of this spec is that it runs before a release. Skipping it
// because Electron's binary never downloaded would publish installers nothing
// had opened, so in CI a missing prerequisite is a failure, not a skip.
if (process.env['CI'] && !(IS_BUILT && ELECTRON_INSTALLED)) {
  throw new Error(
    `cannot check the desktop shell: built=${IS_BUILT}, electron=${ELECTRON_INSTALLED}`,
  );
}

test.skip(!IS_BUILT, 'the app has not been built — run `npm run e2e`, which builds it first');
test.skip(!ELECTRON_INSTALLED, 'Electron is not installed — run `npm install`');

test.describe.configure({ mode: 'serial' });

let app: ElectronApplication;
let window: Page;
let userData: string;
/** What the window was showing before the server it belongs to was listening. */
let splash: { shown: boolean; line: string };

test.beforeAll(async () => {
  // A profile of its own, so this is a first run every time — which is the
  // only state where the connection sheet is the thing on screen.
  userData = await mkdtemp(join(tmpdir(), 'lamplit-desktop-'));
  app = await electron.launch({
    args: [ELECTRON_DIR],
    env: { ...process.env, LAMPLIT_USER_DATA: userData },
  });
  window = await app.firstWindow();

  // The window is created and shown before the server is so much as imported,
  // so the first document in it is the shell's own page. What this spec has to
  // say about it is recorded here rather than in a test of its own, because by
  // the time that test ran the app would rightly have replaced it.
  await window.waitForURL(/splash\.html$/);
  splash = {
    shown: await app.evaluate(
      ({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]?.isVisible() ?? false,
    ),
    line: await window.locator('.booting-line').innerText(),
  };

  await window.waitForURL(/^http:\/\/127\.0\.0\.1:\d+\//, { timeout: 30_000 });
  await window.waitForLoadState('domcontentloaded');
});

test.afterAll(async () => {
  await app?.close();
  await rm(userData, { recursive: true, force: true });
});

/**
 * Clicking the icon used to do nothing visible for as long as it took to import
 * the server, open the store, listen, and load and bootstrap Angular — long
 * enough that people clicked again, or decided it was broken. The window now
 * comes first and says what it is doing.
 */
test('is on screen, saying so, before its server is listening', () => {
  expect(splash.shown).toBe(true);
  // The same words `app/src/index.html` shows until Angular boots, so nothing
  // on screen changes when the window navigates from one page to the other.
  expect(splash.line).toBe('Lighting the lamp…');
});

/**
 * The behaviour that made the slow start look broken: a second click. It quits
 * at once and hands the window it did not open to the copy that did — including
 * while that window is still the splash, which is the whole point of it being
 * up early.
 */
test('hands a second launch back to the window already open', async () => {
  const binary = join(
    ROOT,
    'node_modules',
    'electron',
    'dist',
    (await readFile(join(ROOT, 'node_modules', 'electron', 'path.txt'), 'utf8')).trim(),
  );
  const asked = app.evaluate(
    ({ app: electronApp }) =>
      new Promise<boolean>((resolve_) => electronApp.once('second-instance', () => resolve_(true))),
  );

  const second = spawn(binary, [ELECTRON_DIR], {
    env: { ...process.env, LAMPLIT_USER_DATA: userData },
    stdio: 'ignore',
  });
  const [code] = (await once(second, 'exit')) as [number | null];

  expect(code).toBe(0);
  await expect(asked).resolves.toBe(true);
  expect(await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().length)).toBe(1);
});

test('starts its own server on a port it picked, and answers on it', async () => {
  const url = new URL(window.url());
  expect(url.hostname).toBe('127.0.0.1');
  // Port 0 was asked for, so any port at all is the point; 4177 would mean the
  // window found the zip's server rather than starting one of its own.
  expect(Number(url.port)).toBeGreaterThan(1024);

  const health = await window.evaluate(async () =>
    fetch('/api/health').then((response) => response.json()),
  );
  expect(health).toMatchObject({ ok: true, name: 'lamplit' });
  expect(health.dataDir).toBe(join(userData, 'data'));
});

/**
 * Chromium's default is the machine's proxy configuration, and on Windows that
 * means WPAD: it looks for a `wpad` host and, on a corporate network or a VPN,
 * finds one and waits — twenty-one seconds, measured — for a PAC file. Every
 * request waits with it, loopback included, because the bypass rules are not
 * consulted until the configuration has resolved. So the window that serves its
 * own page has to start direct, and does; the proxy is opt-in from Preferences.
 *
 * Asserted as configuration rather than as a duration: a machine with no `wpad`
 * host has nothing to be slow about, and this has to fail on that machine too.
 */
test('starts without a proxy, so nothing waits on finding one', async () => {
  const resolved = await app.evaluate(async ({ session }) => ({
    loopback: await session.defaultSession.resolveProxy('http://127.0.0.1/'),
    provider: await session.defaultSession.resolveProxy('https://api.openai.com/'),
  }));
  expect(resolved).toEqual({ loopback: 'DIRECT', provider: 'DIRECT' });
});

/**
 * And the switch that gives it back, which crosses the glass because the shell
 * may not read settings.json. Asserted on what the shell was asked for rather
 * than on what a proxy then did: a machine with no proxy resolves `system` and
 * `direct` to the same DIRECT, so only the ask can tell them apart.
 */
test('takes the proxy back when the page says so, and gives it up again', async () => {
  await app.evaluate(({ session }) => {
    const asked: unknown[] = [];
    (globalThis as { proxies?: unknown[] }).proxies = asked;
    session.defaultSession.setProxy = (async (config: unknown) => {
      asked.push(config);
    }) as typeof session.defaultSession.setProxy;
  });

  type Bridge = { useSystemProxy(enabled: boolean): Promise<void> };
  const ask = (enabled: boolean) =>
    window.evaluate(
      (on) => (globalThis as unknown as { lamplit: Bridge }).lamplit.useSystemProxy(on),
      enabled,
    );
  await ask(true);
  await ask(false);

  expect(await app.evaluate(() => (globalThis as { proxies?: unknown[] }).proxies ?? [])).toEqual([
    { mode: 'system' },
    { mode: 'direct' },
  ]);
});

/**
 * Electron grants every permission Chromium can ask for unless it is told not
 * to, so a packaged Lamplit answered `granted` for the camera, the microphone
 * and the reader's location — none of which it has ever asked for. The one
 * exception is the silent grant behind the Copy buttons.
 */
test('asks the browser for nothing it does not use', async () => {
  const states = await window.evaluate(async () => {
    const names = [
      'geolocation',
      'notifications',
      'camera',
      'microphone',
      'clipboard-read',
      'clipboard-write',
    ];
    const answers: Record<string, string> = {};
    for (const name of names) {
      answers[name] = await navigator.permissions.query({ name: name as PermissionName }).then(
        (status) => status.state,
        () => 'not asked',
      );
    }
    return answers;
  });

  expect(states).toEqual({
    geolocation: 'denied',
    notifications: 'denied',
    camera: 'denied',
    microphone: 'denied',
    'clipboard-read': 'denied',
    // Copy, on a message and on the prompt preview. Writing the clipboard on a
    // click is the whole of what this app asks the browser for.
    'clipboard-write': 'granted',
  });
});

test('opens on the connection sheet, as a fresh install does', async () => {
  await expect(window.getByRole('heading', { name: /somewhere to send the story/ })).toBeVisible({
    timeout: 20_000,
  });
});

test('keeps the browser’s own files out of the way of the writing', async () => {
  // Moving the profile moves Chromium's caches with it. On a stick — the
  // portable build's whole point — that is fifteen folders of churn beside
  // `data`, which docs/desktop.md says holds the stories and the backups.
  const sessionData = await app.evaluate(({ app: electronApp }) =>
    electronApp.getPath('sessionData'),
  );
  expect(sessionData).toBe(join(userData, 'browser'));
  expect(existsSync(join(userData, 'Cache'))).toBe(false);
});

test('writes its documents into the profile, not beside the app', async () => {
  const dialog = window.getByRole('dialog');
  await dialog.getByLabel('API key').fill('a-key-typed-in-the-desktop-app');

  // Wait for the key, not for the file. settings.json appears before this write
  // does — the app puts activeStoryId in it the moment it makes the first story —
  // so polling for the file and then reading it is a race, and the runner lost it
  // where this machine happened to win.
  const settings = join(userData, 'data', 'settings.json');
  await expect
    .poll(
      async () => {
        try {
          return JSON.parse(await readFile(settings, 'utf8')).connection?.apiKey ?? null;
        } catch {
          return null; // not written yet, or caught mid-rename
        }
      },
      { timeout: 15_000 },
    )
    .toBe('a-key-typed-in-the-desktop-app');
});

/**
 * A page that refuses to unload shows no dialog of its own in Electron: the
 * shell is asked instead, through `will-prevent-unload`, and a shell that does
 * not answer is a close button that silently does nothing. The app refuses
 * exactly once — while its save queue is failing — which is the moment a
 * window that will not close and will not say why is at its worst.
 */
test('answers the page when it refuses to close, rather than ignoring the button', async () => {
  // The dialog is native and cannot be clicked from out here, so this stands in
  // for the person: it records that it was asked, and keeps the window open.
  await app.evaluate(({ dialog }) => {
    const asked: string[] = [];
    (globalThis as { asked?: string[] }).asked = asked;
    dialog.showMessageBoxSync = ((...args: unknown[]) => {
      const options = (args.length > 1 ? args[1] : args[0]) as { message?: string };
      asked.push(options.message ?? '');
      return 0; // Keep Lamplit open
    }) as typeof dialog.showMessageBoxSync;
  });

  await window.evaluate(() => {
    const refuse = (event: BeforeUnloadEvent) => event.preventDefault();
    (window as { refuse?: (event: BeforeUnloadEvent) => void }).refuse = refuse;
    window.addEventListener('beforeunload', refuse);
  });

  // Electron answers the "leave site?" prompt itself, through the handler under
  // test. Without a listener here Playwright would try to dismiss a dialog that
  // by then no longer exists, and fail on that rather than on the app.
  window.on('dialog', () => undefined);
  await window.evaluate(() => window.close());

  await expect
    .poll(() => app.evaluate(() => (globalThis as { asked?: string[] }).asked ?? []), {
      timeout: 10_000,
    })
    .toEqual([expect.stringContaining('not been saved')]);
  // Answered "keep open", so the window is still here to say so.
  expect(await window.evaluate(() => document.title)).toBeTruthy();

  await window.evaluate(() => {
    const refuse = (window as { refuse?: (event: BeforeUnloadEvent) => void }).refuse;
    if (refuse) window.removeEventListener('beforeunload', refuse);
  });
});
