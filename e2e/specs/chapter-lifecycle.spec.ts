import { expect, test } from './fixtures';
import {
  assistantMessages,
  captureRequests,
  CHAPTER_ID,
  closeChapter,
  composer,
  confirmClose,
  expectComposerHidden,
  openChapter,
  openPromptPreview,
  SCENE,
  send,
  STORY_ID,
  systemOf,
  waitForSaved,
  waitForTurn,
} from './helpers';

/**
 * A chapter opening and closing: what the close folds into the story so far,
 * what it leaves behind, and what a chapter is called once it is shut.
 */

test('closing a chapter keeps it, folds its summary in, and opens the next', async ({
  page,
  app,
}) => {
  await app.open({ storySoFar: 'Mara arrived on the island.' });

  await send(page, 'I knock.');
  await waitForTurn(page);

  await closeChapter(page, 'Mara knocked, and nobody came.');

  // The next chapter's sheet opens, pre-filled with the scene just closed.
  const sheet = page.getByRole('dialog');
  await expect(sheet.getByRole('heading', { name: /Chapter 2/ })).toBeVisible();
  await expect(sheet.locator('textarea.scene')).toHaveValue(SCENE);
  await openChapter(page, 'The lantern room, an hour later.');

  // Chapter 1 is still there, closed, with its messages.
  await page.getByRole('button', { name: 'Chapters' }).click();
  const list = page.getByRole('dialog');
  await expect(list.getByText('closed')).toBeVisible();
  await expect(list.getByText('2 messages')).toBeVisible();
  await list.getByRole('button', { name: 'Done' }).click();

  // And the summary is what the model now remembers of it.
  const bodies = await captureRequests(page);
  await send(page, 'I look up.');
  await waitForTurn(page);
  expect(systemOf(bodies[0])).toContain('Mara knocked, and nobody came.');
  expect(systemOf(bodies[0])).toContain('The lantern room, an hour later.');
  expect(systemOf(bodies[0])).not.toContain('low tide');
  // The summary replaced the story so far rather than being added to it.
  expect(systemOf(bodies[0])).not.toContain('Mara arrived on the island.');
});

test('the summary request carries the story so far and an editable instruction', async ({
  page,
  app,
}) => {
  await app.seed({ storySoFar: 'Mara arrived on the island.' });
  const bodies = await captureRequests(page);
  await app.visit();

  await send(page, 'I knock.');
  await waitForTurn(page);

  // Make the instruction the writer's own, from the World modal.
  await page.getByRole('button', { name: 'World', exact: true }).click();
  const world = page.getByRole('dialog');
  await world.getByRole('button', { name: /How a chapter is folded in/ }).click();
  await world.getByRole('switch', { name: 'Write my own instruction' }).click();
  // By where it lives, not by position in the dialog: the field only exists
  // once the switch is on, and "the last textarea" before then is the story
  // so far, which this test is about not overwriting.
  const instruction = world
    .locator('mat-expansion-panel', { hasText: 'How a chapter is folded in' })
    .locator('textarea');
  await instruction.fill('Answer with the word BISCUIT and nothing else.');
  await instruction.blur();
  await world.getByRole('button', { name: 'Done' }).click();

  await page.getByRole('button', { name: 'Close chapter' }).click();
  await expect(page.getByRole('dialog').locator('textarea').first()).not.toBeEmpty();

  const summaryRequest = bodies[bodies.length - 1];
  const user = summaryRequest['messages'].at(-1).content as string;
  expect(user).toContain('The story so far, as it stands:');
  expect(user).toContain('Mara arrived on the island.');
  expect(user).toContain('Answer with the word BISCUIT and nothing else.');
});

test('starting a new chapter closes the one being written first', async ({ page, app }) => {
  await app.open();

  await send(page, 'I knock.');
  await waitForTurn(page);

  // "New chapter" is the same act as closing this one: the model summarises
  // it, the summary is reviewed, and only then does the next chapter open.
  await page.getByRole('button', { name: 'Chapters' }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'New chapter' }).click();
  await expect(
    page.getByRole('dialog').getByRole('heading', { name: /Close Chapter 1/ }),
  ).toBeVisible();
  await confirmClose(page, 'Mara knocked, and nobody came.');

  const sheet = page.getByRole('dialog');
  await expect(sheet.getByRole('heading', { name: /Chapter 2/ })).toBeVisible();
  await openChapter(page, 'The lantern room, an hour later.');

  // The summary is in the story so far, and chapter 1 is closed.
  const bodies = await captureRequests(page);
  await send(page, 'I look up.');
  await waitForTurn(page);
  expect(systemOf(bodies[0])).toContain('Mara knocked, and nobody came.');

  await page.getByRole('button', { name: 'Chapters' }).click();
  await expect(page.getByRole('dialog')).toContainText('closed');
});

test('a new chapter after an empty one just opens', async ({ page, app }) => {
  await app.open();

  // Nothing was written, so there is nothing to summarise and nothing to ask.
  await page.getByRole('button', { name: 'Chapters' }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'New chapter' }).click();
  const sheet = page.getByRole('dialog');
  await expect(sheet.getByRole('heading', { name: /Chapter 2 — the scene/ })).toBeVisible();
});

test('a closed chapter opens read-only until it is continued', async ({ page, app }) => {
  await app.open();
  await send(page, 'I knock.');
  await waitForTurn(page);

  await closeChapter(page, 'A summary.');
  await openChapter(page, 'Later.');

  await page.getByRole('button', { name: 'Chapters' }).click();
  await page
    .getByRole('dialog')
    .locator('.title', { hasText: /The keeper/ })
    .click();

  await expectComposerHidden(page, /is closed/);
  await page.getByRole('button', { name: /is closed/ }).click();
  await expect(composer(page)).toBeEnabled();
});

/**
 * A bare `mat-dialog-close` closes with the empty string rather than with
 * nothing, so a cancel used to arrive at the caller looking like an answer —
 * and this one wrote it over the title. Both renames are here because the
 * story's was correct only by luck, `if (title)` where the chapter's asked
 * `!== undefined`.
 */
test('cancelling a rename changes nothing, in either place', async ({ page, server, app }) => {
  await app.open({ chapterTitle: 'A hundred and nine steps' });

  await page.getByRole('button', { name: 'Chapters' }).click();
  const list = page.getByRole('dialog');
  await list.getByRole('button', { name: 'Chapter actions' }).click();
  await page.getByRole('menuitem', { name: 'Rename' }).click();
  await page.getByRole('textbox', { name: 'Chapter title' }).fill('Something else');
  await page.getByRole('button', { name: 'Cancel' }).click();

  await expect(list.locator('.title')).toHaveText('A hundred and nine steps');
  await list.getByRole('button', { name: 'Done' }).click();

  await page.getByRole('button', { name: /The Lighthouse/ }).click();
  await page.getByRole('menuitem', { name: 'Rename…' }).click();
  await page.getByRole('textbox', { name: 'Title' }).fill('Something else');
  await page.getByRole('button', { name: 'Cancel' }).click();
  await expect(page.locator('ms-top-bar')).toContainText('The Lighthouse');

  // And nothing reached the file either way.
  const story = await server.document('stories', STORY_ID);
  expect(story?.['title']).toBe('The Lighthouse');
  const chapter = await server.document('chapters', CHAPTER_ID);
  expect(chapter?.['title']).toBe('A hundred and nine steps');
});

test('a chapter title can be given back, and the scene names it again', async ({
  page,
  server,
  app,
}) => {
  await app.open({ chapterTitle: 'A hundred and nine steps' });

  await page.getByRole('button', { name: 'Chapters' }).click();
  const list = page.getByRole('dialog');
  await list.getByRole('button', { name: 'Chapter actions' }).click();
  await page.getByRole('menuitem', { name: 'Rename' }).click();
  await page.getByRole('textbox', { name: 'Chapter title' }).fill('');
  await page.getByRole('button', { name: 'Save' }).click();

  // Emptied on purpose, which the scene sheet offers in as many words: the
  // chapter goes by its scene again rather than keeping the old name.
  await expect(list.locator('.title')).toHaveText(SCENE);
  await expect
    .poll(async () => (await server.document('chapters', CHAPTER_ID))?.['title'])
    .toBe('');
});

test('chapter numbers are never reused', async ({ page, app }) => {
  await app.open();

  // Two more chapters, so there is a middle one to delete.
  for (const scene of ['The lantern room.', 'The jetty.']) {
    await page.getByRole('button', { name: 'Chapters' }).click();
    await page.getByRole('dialog').getByRole('button', { name: 'New chapter' }).click();
    await openChapter(page, scene);
  }

  await page.getByRole('button', { name: 'Chapters' }).click();
  const list = page.getByRole('dialog');
  await list
    .locator('article', { hasText: 'The lantern room.' })
    .getByRole('button', { name: 'Chapter actions' })
    .click();
  await page.getByRole('menuitem', { name: 'Delete' }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Delete' }).click();

  // 1 and 3 remain, and 3 is still called 3.
  await expect(list.locator('article')).toHaveCount(2);
  await expect(list.locator('.title', { hasText: 'The jetty.' })).toBeVisible();
  await list.getByRole('button', { name: 'Done' }).click();
  await expect(page.getByRole('button', { name: /Chapter 3 — The jetty\./ })).toBeVisible();
});

test('story, chapters and scenes survive a reload', async ({ page, server, app }) => {
  await app.open({ developerMode: true, storySoFar: 'Mara has just arrived.' });

  await send(page, 'I knock.');
  await waitForTurn(page);
  await waitForSaved(server, 2);
  await page.reload();

  await expect(page.getByRole('button', { name: /The Lighthouse/ })).toBeVisible();
  await expect(assistantMessages(page)).toHaveCount(1);
  await openPromptPreview(page);
  const preview = page.getByRole('dialog');
  await expect(preview.getByText('Mara has just arrived.')).toBeVisible();
  await expect(preview.getByText(new RegExp(SCENE.slice(0, 24)))).toBeVisible();
});
