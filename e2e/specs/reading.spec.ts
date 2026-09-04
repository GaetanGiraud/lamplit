import { Page } from '@playwright/test';
import { expect, test } from './fixtures';
import {
  composer,
  fillProse,
  seedConnectedSettings,
  seedStory,
  send,
  waitForTurn,
} from './helpers';

/**
 * The composer is the end of the page, not a dock under it.
 *
 * Which makes reading the thing being checked here: what is on screen while a
 * long answer streams, what is on screen once the reader has scrolled up out of
 * it, and how a writer gets back to the box without going to look for it.
 */

const SCENE = 'The lantern room, an hour before dusk.';

/** The one scrollport. Everything in the chapter is inside it. */
function scroller(page: Page) {
  return page.locator('ms-chapters-page .page');
}

function metrics(page: Page): Promise<{ height: number; scrollHeight: number; top: number }> {
  return scroller(page).evaluate((el) => ({
    height: el.clientHeight,
    scrollHeight: el.scrollHeight,
    top: el.scrollTop,
  }));
}

/** Whether the box is in the scrollport at all, not merely in the document. */
async function composerOnScreen(page: Page): Promise<boolean> {
  const box = page.locator('ms-composer .box');
  if (!(await box.count())) return false;
  return box.evaluate((el) => {
    const port = el.closest('.page')!.getBoundingClientRect();
    const own = el.getBoundingClientRect();
    return own.bottom > port.top && own.top < port.bottom;
  });
}

const jump = (page: Page) => page.getByRole('button', { name: 'Jump to latest' });

test('pinned at the bottom, the composer is on screen the whole way through a long answer', async ({
  page,
  server,
}) => {
  await seedConnectedSettings(server);
  await seedStory(server, { scene: SCENE });
  await page.goto(server.url);

  await send(page, '!long');
  // Mid-stream, not only after it: the point is that it never goes away.
  await expect(page.locator('article[data-role="assistant"]')).toBeVisible();
  expect(await composerOnScreen(page)).toBe(true);
  await waitForTurn(page);

  expect(await composerOnScreen(page)).toBe(true);
  await expect(jump(page)).toBeHidden();

  // Pinned means the foot of the page, and the page is longer than the window.
  const { height, scrollHeight, top } = await metrics(page);
  expect(scrollHeight).toBeGreaterThan(height);
  expect(scrollHeight - top - height).toBeLessThan(8);
});

test('scrolled up, the page is text to the bottom edge, and Jump brings the end back', async ({
  page,
  server,
}) => {
  await seedConnectedSettings(server);
  await seedStory(server, { scene: SCENE });
  await page.goto(server.url);

  await send(page, '!long');
  await waitForTurn(page);

  await scroller(page).evaluate((el) => el.scrollTo(0, 0));
  await expect(jump(page)).toBeVisible();
  expect(await composerOnScreen(page)).toBe(false);

  await jump(page).click();
  await expect(jump(page)).toBeHidden();
  expect(await composerOnScreen(page)).toBe(true);
  // The end of the answer is in view with it, not scrolled past.
  await expect(page.locator('article[data-role="assistant"]').last()).toContainText(
    'Sentence 60 of the long passage.',
  );
});

test('a chapter opens at its end, however the last one was left', async ({ page, server }) => {
  await seedConnectedSettings(server);
  await seedStory(server, { scene: SCENE });
  await page.goto(server.url);

  await send(page, '!long');
  await waitForTurn(page);
  // Left half-way up, which is what the reader was doing there.
  await scroller(page).evaluate((el) => el.scrollTo(0, 0));
  await expect(jump(page)).toBeVisible();

  // A second chapter — which closes this one first, summary and all — long
  // enough to have an end that is not also its beginning.
  await page.getByRole('button', { name: 'Chapters' }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'New chapter' }).click();
  const review = page.getByRole('dialog');
  await expect(review.locator('textarea')).not.toBeEmpty();
  await review.getByRole('button', { name: 'Close the chapter' }).click();

  const sheet = page.getByRole('dialog');
  await sheet.locator('textarea.scene').fill('The harbour, after the storm.');
  await sheet.getByRole('button', { name: /Open the chapter/ }).click();
  await expect(sheet).toBeHidden();

  await send(page, '!long');
  await waitForTurn(page);

  // Reading it starts where it is being written, not where the last one was.
  await expect(jump(page)).toBeHidden();
  expect(await composerOnScreen(page)).toBe(true);
});

test('typing with nothing focused goes into the composer, wherever the reader is', async ({
  page,
  server,
}) => {
  await seedConnectedSettings(server);
  await seedStory(server, { scene: SCENE });
  await page.goto(server.url);

  await send(page, '!long');
  await waitForTurn(page);
  await scroller(page).evaluate((el) => el.scrollTo(0, 0));
  await expect(jump(page)).toBeVisible();

  // Nothing focused: this is the body's keystroke, not the box's.
  await page.locator('body').click({ position: { x: 4, y: 4 } });
  await page.keyboard.press('S');
  await page.keyboard.type('he waits.');

  await expect(composer(page)).toBeFocused();
  await expect(composer(page)).toHaveText('She waits.');
  expect(await composerOnScreen(page)).toBe(true);
  await expect(jump(page)).toBeHidden();
});

test('a letter pressed inside a dialog stays in the dialog', async ({ page, server }) => {
  await seedConnectedSettings(server);
  await seedStory(server, { scene: SCENE });
  await page.goto(server.url);

  await page.getByRole('button', { name: 'Story', exact: true }).click();
  const sheet = page.getByRole('dialog');
  await expect(sheet).toBeVisible();
  await page.keyboard.press('x');

  await expect(composer(page)).toHaveText('');
});

test('at 390px the chapter is text until the end of it', async ({ page, server }) => {
  await page.setViewportSize({ width: 390, height: 780 });
  await seedConnectedSettings(server);
  await seedStory(server, { scene: SCENE });
  await page.goto(server.url);

  await send(page, '!long');
  await waitForTurn(page);
  await scroller(page).evaluate((el) => el.scrollTo(0, 0));

  expect(await composerOnScreen(page)).toBe(false);
  // And nothing else is holding the foot of the screen either.
  const toolbar = await page.locator('ms-chapter-toolbar').evaluate((el) => {
    const port = el.closest('.page')!.getBoundingClientRect();
    const own = el.getBoundingClientRect();
    return own.bottom > port.top && own.top < port.bottom;
  });
  expect(toolbar).toBe(false);
});

test('the composer grows as it is written into without pushing itself off the page', async ({
  page,
  server,
}) => {
  await page.setViewportSize({ width: 900, height: 560 });
  await seedConnectedSettings(server);
  await seedStory(server, { scene: SCENE });
  await page.goto(server.url);

  await send(page, '!long');
  await waitForTurn(page);

  await fillProse(composer(page), Array.from({ length: 10 }, (_, i) => `line ${i + 1}`).join('\n'));
  // The page grew under a reader who had not moved, so it still ends where
  // they are looking.
  expect(await composerOnScreen(page)).toBe(true);
  const { height, scrollHeight, top } = await metrics(page);
  expect(scrollHeight - top - height).toBeLessThan(8);
});
