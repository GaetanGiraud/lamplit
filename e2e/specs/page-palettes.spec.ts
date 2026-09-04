import { Page } from '@playwright/test';
import { expect, test } from './fixtures';
import {
  CHAPTER_ID,
  captureRequests,
  openPreferences,
  seedConnectedSettings,
  seedStory,
  send,
  waitForTurn,
} from './helpers';
import type { PersistenceServer } from './persistence-server';

/**
 * The model choosing the page from the scene: off unless the story says
 * otherwise, applied the moment the answer lands, and always overrulable by
 * hand.
 *
 * The fake endpoint reads the scene for a word the spec planted — snow is cold
 * and gets `frost` — so what is being checked is the whole path, from the scene
 * the sheet confirmed to the custom property on `<html>`.
 */

const WINTER = 'A monastery under snow. Midwinter, and the bell has not rung since Tuesday.';
const CLUB = 'A jazz club at two in the morning. Neon through the window, and nobody leaving.';

/** Frost and Nocturne, dark theme, as `page-palettes.ts` writes them. */
const FROST_PAGE = 'rgb(15, 20, 26)';
const NOCTURNE_PAGE = 'rgb(17, 16, 24)';

/**
 * What the page is actually drawn on, whoever put it there. Read off the body
 * rather than out of the custom property: the property is a `light-dark()` pair
 * until something overrides it, and this has to compare the two states.
 */
function pageColour(page: Page): Promise<string> {
  return page.evaluate(() => getComputedStyle(document.body).backgroundColor);
}

/** Writes the scene sheet and confirms it, which is what asks the question. */
async function writeScene(page: Page, scene: string): Promise<void> {
  const sheet = page.getByRole('dialog');
  await sheet.locator('textarea.scene').fill(scene);
  await sheet.getByRole('button', { name: /Open the chapter|Save the scene/ }).click();
  await expect(sheet).toBeHidden();
}

/** The chapter as it reached disk. */
async function chapter(server: PersistenceServer): Promise<Record<string, any>> {
  return (await server.document('chapters', CHAPTER_ID)) as Record<string, any>;
}

test('off: opening a chapter asks nothing and the page does not move', async ({ page, server }) => {
  await seedConnectedSettings(server);
  await seedStory(server);
  const requests = await captureRequests(page);
  await page.goto(server.url);

  const before = await pageColour(page);
  await writeScene(page, WINTER);

  // Something slower than the palette question, so that "it was not asked" is
  // an answer and not merely a question that has not arrived yet: the palette
  // is asked the moment the sheet closes, and a turn takes a whole round trip.
  await send(page, 'I climb the stairs.');
  await waitForTurn(page);

  expect(requests.filter((body) => body['stream'] === false)).toEqual([]);
  expect(await pageColour(page)).toBe(before);
});

test('on: a winter scene is read on a cold page, and the chapter keeps it', async ({
  page,
  server,
}) => {
  await seedConnectedSettings(server);
  await seedStory(server, { autoTheme: true });
  await page.goto(server.url);

  await writeScene(page, WINTER);

  await expect.poll(() => pageColour(page)).toBe(FROST_PAGE);
  await expect.poll(async () => (await chapter(server))['palette']).toBe('frost');
  // What it cost is written down too, for the scene sheet's footer.
  expect((await chapter(server))['paletteTokens']).toBeGreaterThan(0);

  // And it is the chapter's, not the app's: a reload reads it back off disk.
  await page.reload();
  await expect.poll(() => pageColour(page)).toBe(FROST_PAGE);
});

test('switching chapters switches pages', async ({ page, server }) => {
  await seedConnectedSettings(server);
  await seedStory(server, { autoTheme: true, scene: WINTER, palette: 'frost' });
  await page.goto(server.url);
  await expect.poll(() => pageColour(page)).toBe(FROST_PAGE);

  // A second chapter, with a scene of quite another mood.
  await page.getByRole('button', { name: 'More actions' }).click();
  await page.getByRole('menuitem', { name: 'New chapter…' }).click();
  await writeScene(page, CLUB);
  await expect.poll(() => pageColour(page)).toBe(NOCTURNE_PAGE);

  // Back to the first, which kept its own.
  await page.getByRole('button', { name: 'Chapters' }).click();
  await page.getByRole('dialog').locator('.row button.open').first().click();
  await expect(page.getByRole('dialog')).toBeHidden();
  await expect.poll(() => pageColour(page)).toBe(FROST_PAGE);
});

test('an endpoint that cannot do schemas is asked again without one', async ({ page, server }) => {
  await seedConnectedSettings(server);
  await seedStory(server, { autoTheme: true });
  const settings = (await server.document('settings'))!;
  const connection = settings['connection'] as Record<string, unknown>;
  await server.seed({
    settings: { ...settings, connection: { ...connection, model: 'fake/no-json-schema' } },
  });
  const requests = await captureRequests(page);
  await page.goto(server.url);

  await writeScene(page, WINTER);

  await expect.poll(() => pageColour(page)).toBe(FROST_PAGE);
  // Twice: the schema, refused, and the same question asked less formally.
  expect(requests).toHaveLength(2);
  expect(requests[0]['response_format']).toBeTruthy();
  expect(requests[1]['response_format']).toBeUndefined();
});

test('the palette row overrules the model, and says whose page it is editing', async ({
  page,
  server,
}) => {
  await seedConnectedSettings(server);
  await seedStory(server, { autoTheme: true, scene: WINTER, palette: 'frost' });
  await page.goto(server.url);
  await expect.poll(() => pageColour(page)).toBe(FROST_PAGE);

  await openPreferences(page);
  const sheet = page.getByRole('dialog');
  await sheet.getByRole('button', { name: 'Colours' }).click();
  await expect(sheet.getByText('Chapter 1 has a page of its own.')).toBeVisible();

  await sheet.getByRole('button', { name: 'Nocturne' }).click();
  await expect.poll(() => pageColour(page)).toBe(NOCTURNE_PAGE);
  await expect.poll(async () => (await chapter(server))['palette']).toBe('nocturne');
});
