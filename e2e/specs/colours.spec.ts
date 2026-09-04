import { Locator, Page } from '@playwright/test';
import { expect, test } from './fixtures';
import { STORY_ID, seedConnectedSettings, seedStory } from './helpers';

/**
 * A colour per character: handed out without anyone choosing, kept across a
 * reload, and changed from the swatch beside the name.
 */

const SCENE = 'The lantern room, an hour before dusk.';

/** As 0.1.0 wrote them: a name, a description, and nothing about colour. */
const CAST = [
  { id: 'nell', name: 'Nell', description: 'Kept the light with Tomas.', enabled: true },
  { id: 'tomas', name: 'Tomas', description: 'The keeper before her father.', enabled: true },
  { id: 'isa', name: 'Isa', description: 'The harbourmaster’s daughter.', enabled: true },
  { id: 'tam', name: 'Tam', description: 'The boatman.', enabled: true },
];

function dots(page: Page): Locator {
  return page.locator('ms-character-swatch .dot');
}

/** The colour each swatch is actually drawn in, in order. */
async function colours(swatches: Locator): Promise<string[]> {
  return swatches.evaluateAll((nodes) =>
    nodes.map((node) => getComputedStyle(node).backgroundColor),
  );
}

/** Idempotent: a reload brings the panel back open, because it remembers. */
async function openPanel(page: Page): Promise<void> {
  const handle = page.getByRole('button', { name: 'Open the chapter panel' });
  if (await handle.count()) await handle.click();
  await expect(
    page.locator('ms-chapter-panel').getByRole('button', { name: 'Close the chapter panel' }),
  ).toBeVisible();
}

test('four characters get four colours, and nobody was asked', async ({ page, server }) => {
  await seedConnectedSettings(server);
  await seedStory(server, { scene: SCENE, mode: 'roleplay' });
  await page.goto(server.url);

  const sheet = page.getByRole('dialog');
  await page.getByRole('button', { name: 'Story', exact: true }).click();
  for (let i = 0; i < 4; i++) await sheet.getByRole('button', { name: 'Add a character' }).click();

  const seen = await colours(dots(sheet));
  expect(seen).toHaveLength(4);
  expect(new Set(seen).size).toBe(4);
});

test('the eleventh character wraps round to the first colour', async ({ page, server }) => {
  await seedConnectedSettings(server);
  // Ten already, coloured on load from their place in the cast.
  await seedStory(server, {
    scene: SCENE,
    mode: 'roleplay',
    characters: Array.from({ length: 10 }, (_, i) => ({
      id: `c${i}`,
      name: `Character ${i}`,
      description: '',
      enabled: true,
    })),
  });
  await page.goto(server.url);

  const sheet = page.getByRole('dialog');
  await page.getByRole('button', { name: 'Story', exact: true }).click();
  const ten = await colours(dots(sheet));
  expect(new Set(ten).size).toBe(10);

  await sheet.getByRole('button', { name: 'Add a character' }).click();
  const eleven = await colours(dots(sheet));
  expect(eleven).toHaveLength(11);
  // Sharing with the first beats having none at all.
  expect(eleven[10]).toBe(eleven[0]);
});

test('a story from before the palette opens coloured, and stays that way', async ({
  page,
  server,
}) => {
  await seedConnectedSettings(server);
  await seedStory(server, { scene: SCENE, mode: 'roleplay', characters: CAST });
  await page.goto(server.url);

  await openPanel(page);
  const before = await colours(dots(page));
  expect(new Set(before).size).toBe(4);

  // Worked out from each character's place in the cast, so it is the same
  // answer every time — and the store writes it down on the way past.
  await expect
    .poll(async () => {
      const story = await server.document('stories', STORY_ID);
      return (story?.['characters'] as { colour?: string }[]).map((c) => c.colour);
    })
    .toEqual(['ember', 'jade', 'iris', 'moss']);

  await page.reload();
  await openPanel(page);
  expect(await colours(dots(page))).toEqual(before);
});

test('changing a colour from the swatch redraws the row at once', async ({ page, server }) => {
  await seedConnectedSettings(server);
  await seedStory(server, {
    scene: SCENE,
    mode: 'roleplay',
    characters: CAST,
    roleplay: { casting: 'one-at-a-time', activeCharacterId: 'nell' },
  });
  await page.goto(server.url);
  await openPanel(page);

  const swatch = page.getByRole('button', { name: 'Nell is Ember. Change it.' });
  const row = page.locator('.cast-row').first();
  const tint = async () => row.evaluate((el) => getComputedStyle(el).backgroundColor);
  const emberTint = await tint();

  await swatch.click();
  // Ten to choose from, and no way to invent an eleventh here.
  await expect(page.locator('.mat-mdc-menu-panel .choice')).toHaveCount(10);
  await page.getByRole('button', { name: 'Cobalt', exact: true }).click();

  await expect(page.getByRole('button', { name: 'Nell is Cobalt. Change it.' })).toBeVisible();
  // The row Nell is being played on is tinted with her own colour, so it moved
  // with the dot.
  expect(await tint()).not.toBe(emberTint);
});

test('a colour of their own is set under Preferences, and given back there', async ({
  page,
  server,
}) => {
  await seedConnectedSettings(server);
  await seedStory(server, { scene: SCENE, mode: 'roleplay', characters: CAST });
  await page.goto(server.url);
  await openPanel(page);

  await page.getByRole('button', { name: 'Preferences' }).click();
  const sheet = page.getByRole('dialog');
  await sheet.getByRole('button', { name: 'Colours' }).click();

  const nell = sheet.locator('.swatch', { hasText: 'Nell' });
  await expect(nell).toContainText('Ember');
  await nell.locator('input[type="color"]').evaluate((input: HTMLInputElement) => {
    input.value = '#3399ff';
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
  await expect(nell).toContainText('A colour of their own');

  // It beats the palette everywhere the character is drawn, at once — the
  // panel is behind this sheet, and its dot has already moved.
  await expect(dots(page).first()).toHaveCSS('background-color', 'rgb(51, 153, 255)');

  await nell.getByRole('button', { name: 'Back to the palette' }).click();
  await expect(nell).toContainText('Ember');
  // Ember, in the dark theme these specs run in.
  await expect(dots(page).first()).toHaveCSS('background-color', 'rgb(240, 152, 133)');

  await page.keyboard.press('Escape');
  await expect(sheet).toBeHidden();
  await expect(page.getByRole('button', { name: 'Nell is Ember. Change it.' })).toHaveCount(1);
});
