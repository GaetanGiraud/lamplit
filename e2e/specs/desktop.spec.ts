import { ElectronApplication, Page, _electron as electron, expect, test } from '@playwright/test';
import { existsSync } from 'node:fs';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
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

test.skip(!IS_BUILT, 'the app has not been built — run `npm run e2e`, which builds it first');
test.skip(
  !existsSync(join(ROOT, 'node_modules', 'electron', 'path.txt')),
  'Electron is not installed — run `npm install`',
);

test.describe.configure({ mode: 'serial' });

let app: ElectronApplication;
let window: Page;
let userData: string;

test.beforeAll(async () => {
  // A profile of its own, so this is a first run every time — which is the
  // only state where the connection sheet is the thing on screen.
  userData = await mkdtemp(join(tmpdir(), 'lamplit-desktop-'));
  app = await electron.launch({
    args: [ELECTRON_DIR],
    env: { ...process.env, LAMPLIT_USER_DATA: userData },
  });
  window = await app.firstWindow();
  await window.waitForLoadState('domcontentloaded');
});

test.afterAll(async () => {
  await app?.close();
  await rm(userData, { recursive: true, force: true });
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

test('opens on the connection sheet, as a fresh install does', async () => {
  await expect(window.getByRole('heading', { name: /somewhere to send the story/ })).toBeVisible({
    timeout: 20_000,
  });
});

test('writes its documents into the profile, not beside the app', async () => {
  const dialog = window.getByRole('dialog');
  await dialog.getByLabel('API key').fill('a-key-typed-in-the-desktop-app');

  const settings = join(userData, 'data', 'settings.json');
  await expect.poll(() => existsSync(settings), { timeout: 15_000 }).toBe(true);

  const written = JSON.parse(await readFile(settings, 'utf8'));
  expect(written.connection.apiKey).toBe('a-key-typed-in-the-desktop-app');
});
