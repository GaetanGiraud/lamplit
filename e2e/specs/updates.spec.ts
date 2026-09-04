import type { Page, Route } from '@playwright/test';
import { composer, openPreferences, seedConnectedSettings, seedStory } from './helpers';
import { expect, test } from './fixtures';

const SCENE = 'The keeper’s cottage, late afternoon, low tide. The door is unlatched.';

/**
 * What the server would answer if 0.2.0 had been published. The real request to
 * GitHub is the server's and is covered by the server's own tests; what these
 * check is the half a person sees — the pill, the sheet, and the switch that
 * stops it being asked for at all.
 */
const NEWER = {
  ok: true,
  enabled: true,
  checked: true,
  version: '0.0.0',
  latest: null,
  newer: [
    {
      tag: 'v0.2.0',
      version: '0.2.0',
      name: '0.2.0 — the second one',
      publishedAt: '2026-04-02T09:00:00.000Z',
      body: 'A line about what changed,\nwrapped the way a changelog wraps it.\n\n- And a bullet.',
      url: 'https://example.invalid/releases/v0.2.0',
      assets: [],
    },
  ],
  releases: [] as unknown[],
};

const NOTHING_NEWER = { ...NEWER, newer: [], releases: [NEWER.newer[0]] };

/** Answers /api/updates without the server ever reaching GitHub. */
async function fakeUpdates(page: Page, body: unknown): Promise<string[]> {
  const asked: string[] = [];
  await page.route('**/api/updates', async (route: Route) => {
    asked.push(route.request().url());
    await route.fulfill({ json: body });
  });
  return asked;
}

test.describe('a newer version', () => {
  test.beforeEach(async ({ server }) => {
    await seedConnectedSettings(server);
    await seedStory(server, { scene: SCENE });
  });

  const pill = (page: Page) => page.getByRole('button', { name: /available$/ });

  test('says so quietly in the top bar, and the sheet has the notes', async ({ page, server }) => {
    await fakeUpdates(page, NEWER);
    await page.goto(server.url);

    // Quiet: a pill, and nothing over the page being written on.
    await expect(pill(page)).toHaveText('0.2.0 available');
    await expect(page.getByRole('dialog')).toHaveCount(0);

    await pill(page).click();
    const sheet = page.getByRole('dialog');
    await expect(sheet.getByRole('heading', { name: /new/i })).toBeVisible();
    await expect(sheet).toContainText('0.2.0 — the second one');
    await expect(sheet).toContainText('And a bullet');
    await expect(sheet.locator('.notes li')).toHaveCount(1);

    // A changelog's wrapped line is one sentence, not two: release notes are
    // ordinary markdown, whatever the story prose beside them does with a
    // newline.
    await expect(sheet.locator('.notes br')).toHaveCount(0);
  });

  test('says nothing at all when this is the newest one', async ({ page, server }) => {
    await fakeUpdates(page, NOTHING_NEWER);
    await page.goto(server.url);

    await expect(page.locator('ms-top-bar')).toContainText('Chapters');
    await expect(pill(page)).toHaveCount(0);
  });

  test('is not asked for when the check is switched off', async ({ page, server }) => {
    const asked = await fakeUpdates(page, NEWER);
    await page.goto(server.url);
    await expect(pill(page)).toBeVisible();
    expect(asked.length).toBe(1);

    await openPreferences(page);
    const preferences = page.getByRole('dialog');
    await preferences.getByRole('button', { name: 'Advanced' }).click();
    await preferences.getByRole('switch', { name: /^Check for a new version/ }).click();
    await preferences.getByRole('button', { name: 'Done' }).click();

    await expect
      .poll(async () => {
        const settings = await server.document('settings');
        return (settings?.['ui'] as Record<string, unknown>)?.['checkForUpdates'];
      })
      .toBe(false);

    // The whole point: after a reload nothing asks, so the server never asks
    // GitHub either.
    await page.reload();
    await expect(page.locator('ms-top-bar')).toContainText('Chapters');
    await expect(pill(page)).toHaveCount(0);
    expect(asked.length).toBe(1);
  });

  test('carries on as before when nothing answers', async ({ page, server }) => {
    await page.route('**/api/updates', (route) => route.abort('failed'));
    await page.goto(server.url);

    // The app is the app: no pill, no error, and a chapter that can be written.
    await expect(pill(page)).toHaveCount(0);
    await expect(composer(page)).toBeVisible();
    await expect(page.locator('ms-top-bar')).toContainText('The Lighthouse');
  });
});

test.describe('the release notes', () => {
  test.beforeEach(async ({ server }) => {
    await seedConnectedSettings(server);
    await seedStory(server, { scene: SCENE });
  });

  test('are in About, with nothing pending', async ({ page, server }) => {
    await fakeUpdates(page, NOTHING_NEWER);
    await page.goto(server.url);
    await expect(page.locator('ms-top-bar')).toContainText('Chapters');

    await page.getByRole('button', { name: 'More actions' }).click();
    await page.getByRole('menuitem', { name: /^About Lamplit/ }).click();
    await page.getByRole('dialog').getByRole('button', { name: 'Release notes' }).click();

    const sheet = page.getByRole('dialog').last();
    await expect(sheet.getByRole('heading', { name: 'Release notes' })).toBeVisible();
    // The one release there is, even though it is not newer than this build.
    await expect(sheet).toContainText('0.2.0 — the second one');
  });

  test('say why they are missing rather than showing an empty sheet', async ({ page, server }) => {
    await fakeUpdates(page, { ...NEWER, enabled: false, checked: false, newer: [], releases: [] });
    await page.goto(server.url);
    await expect(page.locator('ms-top-bar')).toContainText('Chapters');

    await page.getByRole('button', { name: 'More actions' }).click();
    await page.getByRole('menuitem', { name: /^About Lamplit/ }).click();
    await page.getByRole('dialog').getByRole('button', { name: 'Release notes' }).click();

    const sheet = page.getByRole('dialog').last();
    await expect(sheet).toContainText(/switched off/);
    await expect(sheet.getByRole('link', { name: /releases, on GitHub/ })).toBeVisible();
  });
});
