import { Locator, Page } from '@playwright/test';
import { expect, test } from './fixtures';
import type { PersistenceServer } from './persistence-server';
import {
  captureRequests,
  CHAPTER_ID,
  composer,
  fillProse,
  seedConnectedSettings,
  seedStory,
  send,
  systemOf,
  waitForTurn,
} from './helpers';

/**
 * The chapter panel: the scene, the narrator, the persona and the cast, beside
 * the page rather than over it.
 */

const SCENE = 'The keeper’s cottage, late afternoon, low tide. The door is unlatched.';
const LANTERN = 'The lantern room, an hour before dusk. The lamp is already lit.';

function panel(page: Page): Locator {
  return page.locator('ms-chapter-panel');
}

function section(page: Page, name: string): Locator {
  return panel(page).locator(`[data-section="${name}"]`);
}

async function openPanel(page: Page): Promise<void> {
  await page.getByRole('button', { name: 'Open the chapter panel' }).click();
  await expect(panel(page).getByRole('button', { name: 'Close the chapter panel' })).toBeVisible();
}

/** The settings document has to land before a reload can read it back. */
async function waitForUi(server: PersistenceServer, field: string, value: unknown): Promise<void> {
  await expect
    .poll(async () => {
      const settings = await server.document('settings');
      return (settings?.['ui'] as Record<string, unknown> | undefined)?.[field];
    })
    .toEqual(value);
}

test('the scene is edited beside the page, and the next request carries it', async ({
  page,
  server,
}) => {
  await seedConnectedSettings(server);
  await seedStory(server, { scene: SCENE });
  const bodies = await captureRequests(page);
  await page.goto(server.url);

  await openPanel(page);
  const scene = section(page, 'scene').locator('textarea');
  await expect(scene).toHaveValue(SCENE);

  // The mark appears once the text differs from the document, and leaving the
  // field is what commits it — the same bargain every other field here makes.
  await scene.fill(LANTERN);
  await expect(section(page, 'scene').getByRole('button', { name: 'Save' })).toBeVisible();
  await scene.blur();
  await expect(section(page, 'scene').getByRole('button', { name: 'Save' })).toHaveCount(0);

  await send(page, 'I climb the stairs.');
  await waitForTurn(page);
  expect(systemOf(bodies[0])).toContain(LANTERN);
});

test('a closed chapter shows its scene and will not take a change to it', async ({
  page,
  server,
}) => {
  await seedConnectedSettings(server);
  await seedStory(server, { scene: SCENE });
  const chapter = (await server.document('chapters', CHAPTER_ID))!;
  await server.seed({ [`chapter:${CHAPTER_ID}`]: { ...chapter, status: 'closed' } });
  await page.goto(server.url);

  await openPanel(page);
  const scene = section(page, 'scene').locator('textarea');
  await expect(scene).toHaveValue(SCENE);
  await expect(scene).toHaveJSProperty('readOnly', true);
  await expect(section(page, 'scene')).toContainText('closed');
});

test('it is where it was left, folds and all, after a reload', async ({ page, server }) => {
  await seedConnectedSettings(server);
  await seedStory(server, { scene: SCENE });
  await page.goto(server.url);

  await openPanel(page);
  await section(page, 'persona').getByRole('button', { name: 'Persona' }).click();
  await expect(section(page, 'persona').locator('textarea')).toHaveCount(0);
  await waitForUi(server, 'sidebarOpen', true);
  await waitForUi(server, 'sidebarSections', { persona: false });

  await page.reload();
  await expect(panel(page).getByRole('button', { name: 'Close the chapter panel' })).toBeVisible();
  // Scene is open because nothing was said about it; persona is shut because
  // something was.
  await expect(section(page, 'scene').locator('textarea')).toBeVisible();
  await expect(section(page, 'persona').locator('textarea')).toHaveCount(0);
});

test('narrow, it comes over the page and Escape gives the page back', async ({ page, server }) => {
  await seedConnectedSettings(server);
  await seedStory(server, { scene: SCENE });
  await page.setViewportSize({ width: 900, height: 800 });
  await page.goto(server.url);

  await openPanel(page);
  await expect(panel(page).locator('.scrim')).toBeVisible();

  // The composer is under the scrim but not gone: the chapter is still being
  // written, and what is in the box stays there.
  await fillProse(composer(page), 'I do not move.');
  await expect(composer(page)).toHaveText('I do not move.');

  await page.keyboard.press('Escape');
  await expect(panel(page).locator('.scrim')).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Open the chapter panel' })).toBeVisible();
  // Escape closed the panel and nothing else.
  await expect(composer(page)).toHaveText('I do not move.');
});

test('wide, it takes its width out of the page and covers none of it', async ({ page, server }) => {
  await seedConnectedSettings(server);
  await seedStory(server, { scene: SCENE });
  await page.setViewportSize({ width: 1400, height: 900 });
  await page.goto(server.url);

  const reading = page.locator('ms-chapters-page');
  const before = (await reading.boundingBox())!.width;

  await openPanel(page);
  await expect(panel(page).locator('.scrim')).toHaveCount(0);

  const narrowed = (await reading.boundingBox())!;
  const sheet = (await panel(page).locator('.panel').boundingBox())!;
  expect(narrowed.width).toBeLessThan(before);
  // Beside, not on top: the page ends where the panel begins.
  expect(narrowed.x + narrowed.width).toBeLessThanOrEqual(sheet.x + 1);
});

test('the narrator default is adopted by writing into it, and given back by the link', async ({
  page,
  server,
}) => {
  await seedConnectedSettings(server);
  await seedStory(server, { scene: SCENE });
  await page.goto(server.url);
  await openPanel(page);

  const narrator = section(page, 'narrator').locator('textarea');
  await expect(narrator).toHaveValue(/You are the narrator of an ongoing story/);

  await narrator.fill('Write it as a diary, in the first person.');
  await narrator.blur();
  await expect(section(page, 'narrator')).toContainText('your own');

  // The Story sheet is the same document, seen from the other side.
  await page.getByRole('button', { name: 'Story', exact: true }).click();
  const override = page.getByRole('switch', { name: 'Write my own narrator instructions' });
  await expect(override).toHaveAttribute('aria-checked', 'true');
  await page.keyboard.press('Escape');
  await expect(override).toBeHidden();

  await section(page, 'narrator').getByRole('button', { name: 'Back to the default' }).click();
  await expect(narrator).toHaveValue(/You are the narrator of an ongoing story/);
  await expect(section(page, 'narrator')).toContainText('default');
});

test('a cast row says who they are, and the edit mark opens the sheet on them', async ({
  page,
  server,
}) => {
  await seedConnectedSettings(server);
  await seedStory(server, {
    scene: SCENE,
    mode: 'roleplay',
    characters: [
      {
        id: 'nell',
        name: 'Nell',
        description: 'Kept the light with Tomas.\nSpeaks plainly, and never twice.',
        enabled: true,
      },
    ],
  });
  await page.goto(server.url);
  await openPanel(page);

  const row = section(page, 'cast').locator('.cast-row');
  await expect(row).toContainText('Nell');
  await expect(row).toContainText('Kept the light with Tomas.');
  // One line of it, not the paragraph: the row is a mention, not the record.
  await expect(row).not.toContainText('never twice');

  await row.getByRole('button', { name: 'Edit Nell' }).click();
  const sheet = page.getByRole('dialog');
  await expect(sheet.locator('[data-character="nell"] input').first()).toBeFocused();
});
