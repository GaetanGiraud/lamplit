import { Locator, Page } from '@playwright/test';
import { App, expect, test } from './fixtures';
import type { PersistenceServer } from './persistence-server';
import {
  captureRequests,
  CHAPTER_ID,
  openPromptPreview,
  promptBlocks,
  send,
  STORY_ID,
  systemOf,
  waitForTurn,
} from './helpers';

/**
 * The six blocks of the system prompt are in a fixed order, and four of them do
 * not have to be. The reordering lives in the preview because that is where a
 * person is when they form an opinion about it — and it is per story, because
 * it is a judgement about that story and the model behind it.
 */

const SECOND_STORY = 'the-jetty';

const DEFAULT_ORDER = ['Narrator', 'Persona', 'The story so far', 'This chapter', 'Style'];

/** A second story on disk, so "per story" can be checked as a fact. */
async function seedSecondStory(server: PersistenceServer): Promise<void> {
  const story = await server.document('stories', STORY_ID);
  const chapter = await server.document('chapters', CHAPTER_ID);
  await server.seed({
    ['story:' + SECOND_STORY]: {
      ...story,
      id: SECOND_STORY,
      title: 'The Jetty',
      activeChapterId: SECOND_STORY + '-ch',
    },
    ['chapter:' + SECOND_STORY + '-ch']: {
      ...chapter,
      id: SECOND_STORY + '-ch',
      storyId: SECOND_STORY,
    },
  });
}

const handleOf = (page: Page, label: string): Locator =>
  page.locator('.block.movable', { hasText: label }).locator('.handle');

/** A story with all five blocks in it, opened on the preview they are read in. */
async function open(fixtures: { page: Page; server: PersistenceServer; app: App }): Promise<void> {
  const { page, server, app } = fixtures;
  await app.seed({
    developerMode: true,
    storySoFar: 'Mara has just arrived on the island.',
    persona: { name: 'Mara', description: 'a marine biologist' },
  });
  // A one-line preamble instead of the shipped one, so that all five blocks
  // fit in the sheet without it scrolling: a drag has to be able to see
  // where it is going, and a scrolled sheet moves the target out of reach.
  const story = await server.document('stories', STORY_ID);
  await server.seed({
    ['story:' + STORY_ID]: {
      ...story,
      narrator: { useDefault: false, prompt: 'Tell the story.' },
    },
  });
  await seedSecondStory(server);
  await app.visit();
  await openPromptPreview(page);
}

test('a block moves, the preview rebuilds, and the request follows', async ({
  page,
  server,
  app,
}) => {
  await open({ page, server, app });
  expect(await promptBlocks(page)).toEqual(DEFAULT_ORDER);

  // A drag with a mouse, which is what the handle is there for.
  await dragAbove(page, handleOf(page, 'The story so far'), page.locator('.block.movable').first());
  await expect
    .poll(() => promptBlocks(page))
    .toEqual(['Narrator', 'The story so far', 'Persona', 'This chapter', 'Style']);

  // Live: the sheet rebuilt without being closed, and the file agrees. The
  // world block is empty in this story and so is not drawn — but it is still
  // named, and it has not moved out from between the two that did.
  await expect
    .poll(async () => (await server.document('stories', STORY_ID))?.['promptOrder'])
    .toEqual(['story-so-far', 'persona', 'lore', 'scene']);

  // And what is actually sent carries the same order.
  const requests = await captureRequests(page);
  await page.getByRole('button', { name: 'Done' }).click();
  await send(page, 'I climb the stairs.');
  await waitForTurn(page);

  const system = systemOf(requests[requests.length - 1]);
  expect(system.indexOf('The story so far:')).toBeLessThan(system.indexOf('The user plays Mara'));
  expect(system.indexOf('The user plays Mara')).toBeLessThan(system.indexOf('The scene:'));
});

test('the arrow keys move a block too, for anyone not using a mouse', async ({
  page,
  server,
  app,
}) => {
  await open({ page, server, app });

  await handleOf(page, 'The story so far').focus();
  await page.keyboard.press('ArrowUp');
  await expect
    .poll(() => promptBlocks(page))
    .toEqual(['Narrator', 'The story so far', 'Persona', 'This chapter', 'Style']);
});

test('reset puts the order back and leaves nothing in the document', async ({
  page,
  server,
  app,
}) => {
  await open({ page, server, app });

  // No reset offered until there is something to reset.
  await expect(page.getByRole('button', { name: 'Reset the order' })).toHaveCount(0);
  await handleOf(page, 'This chapter').focus();
  await page.keyboard.press('ArrowUp');
  await page.getByRole('button', { name: 'Reset the order' }).click();

  await expect.poll(() => promptBlocks(page)).toEqual(DEFAULT_ORDER);
  await expect
    .poll(async () => {
      const story = await server.document('stories', STORY_ID);
      return story !== null && 'promptOrder' in story;
    })
    .toBe(false);
  await expect(page.getByRole('button', { name: 'Reset the order' })).toHaveCount(0);
});

test('one story reordered leaves the other alone', async ({ page, server, app }) => {
  await open({ page, server, app });
  await handleOf(page, 'This chapter').focus();
  await page.keyboard.press('ArrowUp');
  await expect
    .poll(async () => (await server.document('stories', STORY_ID))?.['promptOrder'])
    .toBeDefined();
  await page.getByRole('button', { name: 'Done' }).click();

  await page.getByRole('button', { name: /The Lighthouse/ }).click();
  await page.getByRole('menuitem', { name: 'The Jetty' }).click();
  await openPromptPreview(page);

  expect(await promptBlocks(page)).toEqual(DEFAULT_ORDER);
  const other = await server.document('stories', SECOND_STORY);
  expect(other !== null && 'promptOrder' in other).toBe(false);
});

test('an order this build cannot make sense of is simply not used', async ({
  page,
  server,
  app,
}) => {
  await app.seed({
    developerMode: true,
    storySoFar: 'Mara has just arrived on the island.',
    persona: { name: 'Mara', description: 'a marine biologist' },
  });
  const story = await server.document('stories', STORY_ID);
  await server.seed({ ['story:' + STORY_ID]: { ...story, promptOrder: ['lore', 'bogus'] } });

  await app.visit();
  await openPromptPreview(page);
  expect(await promptBlocks(page)).toEqual(DEFAULT_ORDER);
});

/**
 * A CDK drag, by hand. `dragTo` presses and releases in two moves, which is
 * below the threshold the drop list starts tracking at; these are the moves a
 * pointer actually makes.
 */
async function dragAbove(page: Page, handle: Locator, target: Locator): Promise<void> {
  // From the top, so that both ends of the drag are on screen at once.
  await page.locator('mat-dialog-content').evaluate((el) => (el.scrollTop = 0));
  const from = await handle.boundingBox();
  const to = await target.boundingBox();
  if (!from || !to) throw new Error('nothing to drag');
  // The drop list sorts on where the pointer is relative to each item's middle,
  // so the last move has to land *inside* the target's upper half. Stopping
  // short of it — above the list altogether — leaves the block where it was.
  const settle = { x: to.x + to.width / 2, y: to.y + to.height * 0.25 };
  await page.mouse.move(from.x + from.width / 2, from.y + from.height / 2);
  await page.mouse.down();
  await page.mouse.move(from.x + from.width / 2, from.y - 10, { steps: 6 });
  await page.mouse.move(settle.x, settle.y, { steps: 20 });
  await page.mouse.move(settle.x, settle.y - 1, { steps: 2 });
  await page.mouse.up();
}
