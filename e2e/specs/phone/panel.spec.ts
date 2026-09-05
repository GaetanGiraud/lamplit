import { Locator, Page } from '@playwright/test';
import { expect, test } from '../fixtures';
import { panelSection, send, waitForTurn } from '../helpers';
import { openPanelFromMenu, swipeInFromRightEdge } from './helpers';

/**
 * The chapter panel as a sheet: the one part of the app that is not the page
 * and is still offered on a phone, because the scene, the persona and who you
 * are playing are the chapter rather than the app around it.
 */

const CAST = [
  { id: 'nell', name: 'Nell', description: 'Kept the light with Tomas.', enabled: true },
  { id: 'tomas', name: 'Tomas', description: 'The keeper before her father.', enabled: true },
];

const cast = (page: Page): Locator => panelSection(page, 'cast');
const panel = (page: Page): Locator => page.locator('li-chapter-panel .panel');

test('there is no rail, and the sheet fills the screen when it opens', async ({ page, app }) => {
  await app.open();

  // The 1.9rem edge a desktop leaves to reopen it by is a fifteenth of this
  // screen, so it is not drawn: the menu is the way in.
  await expect(page.getByRole('button', { name: 'Open the chapter panel' })).toHaveCount(0);

  await openPanelFromMenu(page);
  const viewport = (await page.viewportSize())!;
  const box = (await panel(page).boundingBox())!;
  expect(Math.round(box.width)).toBe(viewport.width);
});

test('a swipe in from the right edge opens it', async ({ page, app }) => {
  await app.open();
  await expect(panel(page)).toHaveCount(0);

  await swipeInFromRightEdge(page);
  await expect(panel(page)).toBeVisible();
});

test('the back gesture closes it, and does not leave the story', async ({ page, app }) => {
  await app.open();
  await openPanelFromMenu(page);

  await page.goBack();
  await expect(panel(page)).toHaveCount(0);
  // Still the story, not whatever was open before it.
  await expect(page.locator('li-chapters-page')).toBeVisible();
});

test('closing it by its own button leaves the history where it was', async ({ page, app }) => {
  await app.open();
  await openPanelFromMenu(page);

  await page.getByRole('button', { name: 'Close the chapter panel' }).click();
  await expect(panel(page)).toHaveCount(0);

  // The entry that stood for the open sheet went with it, so the panel can be
  // opened and closed all afternoon without building a history to walk back.
  await openPanelFromMenu(page);
  await page.getByRole('button', { name: 'Close the chapter panel' }).click();
  await expect(panel(page)).toHaveCount(0);
  await expect(page.locator('li-chapters-page')).toBeVisible();
});

test('switching the played character works from the sheet', async ({ page, app }) => {
  await app.open({
    mode: 'roleplay',
    characters: CAST,
    roleplay: { casting: 'one-at-a-time', activeCharacterId: 'nell' },
  });

  await send(page, 'I climb the stairs.');
  await waitForTurn(page);

  await openPanelFromMenu(page);
  await cast(page).getByRole('button', { name: 'Play Tomas' }).click();
  await expect(cast(page)).toContainText('playing Tomas');
});
