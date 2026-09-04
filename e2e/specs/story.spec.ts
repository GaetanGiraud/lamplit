import { Locator, Page } from '@playwright/test';
import { expect, test } from './fixtures';
import type { PersistenceServer } from './persistence-server';
import {
  CHAPTER_ID,
  FAKE_API_URL,
  STORY_ID,
  assistantMessages,
  captureRequests,
  composer,
  expectComposerHidden,
  openPromptPreview,
  seedConnectedSettings,
  seedDeveloperMode,
  seedStory,
  send,
  systemOf,
  waitForSaved,
  waitForTurn,
} from './helpers';

const NEWLINE = String.fromCharCode(10);

const SCENE = 'The keeper’s cottage, late afternoon, low tide. The door is unlatched.';

/** The sheet that opens a chapter, and everything that hangs off it. */
test.describe('the scene', () => {
  test('a chapter cannot be written into until its scene is written', async ({ page, server }) => {
    await seedConnectedSettings(server);
    await seedStory(server, { scene: '' });
    await page.goto(server.url);

    // The sheet opens by itself, and the composer waits behind it.
    const sheet = page.getByRole('dialog');
    await expect(sheet.getByRole('heading', { name: /the scene/ })).toBeVisible();
    const confirm = sheet.getByRole('button', { name: 'Open the chapter' });
    await expect(confirm).toBeDisabled();

    // Whitespace is not a scene.
    const field = sheet.locator('textarea.scene');
    await field.fill('   ');
    await expect(confirm).toBeDisabled();

    // One word is.
    await field.fill('Dusk.');
    await expect(confirm).toBeEnabled();

    await confirm.click();
    await expect(sheet).toBeHidden();
    await expect(composer(page)).toBeEnabled();
    await expect(page.getByRole('button', { name: /Chapter 1 — Dusk\./ })).toBeVisible();
  });

  test('escaping the sheet keeps whatever was written', async ({ page, server }) => {
    await seedConnectedSettings(server);
    await seedStory(server, { scene: '' });
    await page.goto(server.url);

    // Escape with nothing but whitespace: the chapter is still shut, and the
    // composer says so, with the way back to the sheet.
    const sheet = page.getByRole('dialog');
    await sheet.locator('textarea.scene').fill('   ');
    await page.keyboard.press('Escape');
    await expect(sheet).toBeHidden();
    await expectComposerHidden(page, /has no scene yet/);

    await page.getByRole('button', { name: /has no scene yet/ }).click();
    const reopened = page.getByRole('dialog');
    await reopened.locator('textarea.scene').fill('Half a thought.');
    await page.keyboard.press('Escape');
    await expect(reopened).toBeHidden();

    // Escape saved it, and any non-empty scene opens the chapter.
    await expect(composer(page)).toBeEnabled();
    await page.getByRole('button', { name: 'Edit scene' }).click();
    await expect(page.getByRole('dialog').locator('textarea.scene')).toHaveValue('Half a thought.');
  });

  test('the scene reaches the model verbatim, and the title falls back to its first line', async ({
    page,
    server,
  }) => {
    await seedConnectedSettings(server);
    await seedStory(server, { scene: `${SCENE}\n\nNobody answers.` });
    const bodies = await captureRequests(page);
    await page.goto(server.url);

    await send(page, 'I walk up to the door.');
    await waitForTurn(page);

    const system = systemOf(bodies[0]);
    expect(system).toContain('Chapter 1. The scene:');
    expect(system).toContain(`${SCENE}\n\nNobody answers.`);
    // Untitled chapters are known by the scene's opening line.
    await expect(page.getByRole('button', { name: /Chapter 1 — The keeper/ })).toBeVisible();
  });
});

test.describe('the world', () => {
  const entries = [
    {
      id: 'tomas',
      title: 'Old Tomas',
      category: 'person' as const,
      keys: ['tomas', 'keeper'],
      content: 'The lighthouse keeper, missing since spring.',
    },
    {
      id: 'lantern',
      title: 'The Lantern Room',
      category: 'place' as const,
      keys: ['lantern', 'lamp room'],
      content: 'Reached by a hundred and nine iron steps.',
    },
  ];

  test('lore fires on the scene, and only on what is mentioned', async ({ page, server }) => {
    await seedConnectedSettings(server);
    await seedDeveloperMode(server);
    await seedStory(server, { scene: SCENE, entries, storySoFar: 'Mara has just arrived.' });
    await page.goto(server.url);

    await openPromptPreview(page);
    const preview = page.getByRole('dialog');
    await expect(preview.locator('li', { hasText: 'Old Tomas' })).toContainText(
      'fired on “keeper” in the scene',
    );
    await expect(preview.locator('li', { hasText: 'The Lantern Room' })).toHaveCount(0);
    await expect(preview.getByText('Mara has just arrived.')).toBeVisible();
    await preview.getByRole('button', { name: 'Done' }).click();

    // What the preview promised is what the request carries.
    const bodies = await captureRequests(page);
    await send(page, 'I look around.');
    await waitForTurn(page);
    const system = systemOf(bodies[0]);
    expect(system).toContain('missing since spring');
    expect(system).not.toContain('hundred and nine iron steps');
  });

  test('what the reader types can fire an entry too', async ({ page, server }) => {
    await seedConnectedSettings(server);
    await seedStory(server, { scene: SCENE, entries });
    const bodies = await captureRequests(page);
    await page.goto(server.url);

    await send(page, 'I climb to the lantern.');
    await waitForTurn(page);
    expect(systemOf(bodies[0])).toContain('hundred and nine iron steps');
  });

  test('closing the modal saves what was typed into it', async ({ page, server }) => {
    await seedConnectedSettings(server);
    await seedDeveloperMode(server);
    await seedStory(server, { scene: SCENE });
    await page.goto(server.url);

    await page.getByRole('button', { name: 'World', exact: true }).click();
    const world = page.getByRole('dialog');
    await world.locator('ms-editor-field textarea').fill('Mara has just arrived on the island.');
    // Escape closes and saves: there is no discard anywhere in the app.
    await page.keyboard.press('Escape');
    await expect(world).toBeHidden();

    await openPromptPreview(page);
    await expect(page.getByRole('dialog')).toContainText('Mara has just arrived on the island.');
  });

  test('an entry with nothing written in it says so', async ({ page, server }) => {
    await seedConnectedSettings(server);
    await seedStory(server, { scene: SCENE });
    await page.goto(server.url);

    await page.getByRole('button', { name: 'World', exact: true }).click();
    const world = page.getByRole('dialog');
    await world.getByRole('tab', { name: 'Lore' }).click();
    await world.getByRole('button', { name: 'Add an entry' }).click();
    await page.getByRole('menuitem', { name: 'Person' }).click();

    const card = world.locator('.entry');
    await expect(card).toHaveClass(/unwritten/);
    await expect(card).toContainText('nothing to say yet');

    const text = card.locator('ms-editor-field textarea');
    await text.fill('The lighthouse keeper, missing since spring.');
    await text.blur();
    await expect(card).not.toHaveClass(/unwritten/);
  });

  test('a new entry is on screen even when a search was in the way', async ({ page, server }) => {
    await seedConnectedSettings(server);
    await seedStory(server, { scene: SCENE, entries });
    await page.goto(server.url);

    await page.getByRole('button', { name: 'World', exact: true }).click();
    const world = page.getByRole('dialog');
    await world.getByRole('tab', { name: 'Lore' }).click();
    await world.getByRole('textbox', { name: 'Search' }).fill('tomas');
    await expect(world.locator('.entry')).toHaveCount(1);

    await world.getByRole('button', { name: 'Add an entry' }).click();
    await page.getByRole('menuitem', { name: 'Fact' }).click();

    // It has no title and no keys, so no search could have matched it.
    await expect(world.locator('.entry.open')).toHaveCount(1);
    await expect(world.locator('.entry.open')).toHaveClass(/unwritten/);
  });

  test('entries collapse to one line, and open one at a time', async ({ page, server }) => {
    await seedConnectedSettings(server);
    await seedStory(server, { scene: SCENE, entries });
    await page.goto(server.url);

    await page.getByRole('button', { name: 'World', exact: true }).click();
    const world = page.getByRole('dialog');
    await world.getByRole('tab', { name: 'Lore' }).click();

    // A world can hold dozens: they start closed, each one a single row.
    const cards = world.locator('.entry');
    await expect(cards).toHaveCount(2);
    await expect(world.locator('ms-editor-field')).toHaveCount(0);
    await expect(world.locator('.entry', { hasText: 'Old Tomas' })).toContainText('tomas, keeper');

    await world.locator('.disclose', { hasText: 'Old Tomas' }).click();
    await expect(world.locator('ms-editor-field')).toHaveCount(1);
    await expect(world.locator('.entry.open')).toContainText('What is true');

    await world.locator('.disclose', { hasText: 'Old Tomas' }).click();
    await expect(world.locator('ms-editor-field')).toHaveCount(0);
  });

  test('switching to role-play changes the system prompt', async ({ page, server }) => {
    await seedConnectedSettings(server);
    await seedStory(server, {
      scene: SCENE,
      persona: { name: 'Mara', description: 'a marine biologist' },
    });
    const bodies = await captureRequests(page);
    await page.goto(server.url);

    await send(page, 'Hello?');
    await waitForTurn(page);
    expect(systemOf(bodies[0])).toContain('You are the narrator');

    await page.getByRole('button', { name: 'Story', exact: true }).click();
    const story = page.getByRole('dialog');
    await story.getByRole('button', { name: /Role-play/ }).click();
    await story.getByRole('button', { name: 'Add a character' }).click();
    await story.getByLabel('Name').first().fill('Tomas');
    await story.getByLabel('Name').first().blur();
    await story.getByRole('button', { name: 'Done' }).click();

    await send(page, 'Hello again?');
    await waitForTurn(page);
    const system = systemOf(bodies[1]);
    expect(system).toContain('You are playing Tomas.');
    expect(system).toContain('never write words, thoughts or actions for Mara');
  });
});

test.describe('chapters', () => {
  test('closing a chapter keeps it, folds its summary in, and opens the next', async ({
    page,
    server,
  }) => {
    await seedConnectedSettings(server);
    await seedStory(server, { scene: SCENE, storySoFar: 'Mara arrived on the island.' });
    await page.goto(server.url);

    await send(page, 'I knock.');
    await waitForTurn(page);

    await page.getByRole('button', { name: 'Close chapter' }).click();
    const review = page.getByRole('dialog');
    const summary = review.locator('textarea');
    await expect(summary).not.toBeEmpty();
    await summary.fill('Mara knocked, and nobody came.');
    await review.getByRole('button', { name: 'Close the chapter' }).click();

    // The next chapter's sheet opens, pre-filled with the scene just closed.
    const sheet = page.getByRole('dialog');
    await expect(sheet.getByRole('heading', { name: /Chapter 2/ })).toBeVisible();
    await expect(sheet.locator('textarea.scene')).toHaveValue(SCENE);
    await sheet.locator('textarea.scene').fill('The lantern room, an hour later.');
    await sheet.getByRole('button', { name: 'Open the chapter' }).click();

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
    server,
  }) => {
    await seedConnectedSettings(server);
    await seedStory(server, { scene: SCENE, storySoFar: 'Mara arrived on the island.' });
    const bodies = await captureRequests(page);
    await page.goto(server.url);

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

  test('starting a new chapter closes the one being written first', async ({ page, server }) => {
    await seedConnectedSettings(server);
    await seedStory(server, { scene: SCENE });
    await page.goto(server.url);

    await send(page, 'I knock.');
    await waitForTurn(page);

    // "New chapter" is the same act as closing this one: the model summarises
    // it, the summary is reviewed, and only then does the next chapter open.
    await page.getByRole('button', { name: 'Chapters' }).click();
    await page.getByRole('dialog').getByRole('button', { name: 'New chapter' }).click();

    const review = page.getByRole('dialog');
    await expect(review.getByRole('heading', { name: /Close Chapter 1/ })).toBeVisible();
    const summary = review.locator('textarea');
    await expect(summary).not.toBeEmpty();
    await summary.fill('Mara knocked, and nobody came.');
    await review.getByRole('button', { name: 'Close the chapter' }).click();

    const sheet = page.getByRole('dialog');
    await expect(sheet.getByRole('heading', { name: /Chapter 2/ })).toBeVisible();
    await sheet.locator('textarea.scene').fill('The lantern room, an hour later.');
    await sheet.getByRole('button', { name: 'Open the chapter' }).click();

    // The summary is in the story so far, and chapter 1 is closed.
    const bodies = await captureRequests(page);
    await send(page, 'I look up.');
    await waitForTurn(page);
    expect(systemOf(bodies[0])).toContain('Mara knocked, and nobody came.');

    await page.getByRole('button', { name: 'Chapters' }).click();
    await expect(page.getByRole('dialog')).toContainText('closed');
  });

  test('a new chapter after an empty one just opens', async ({ page, server }) => {
    await seedConnectedSettings(server);
    await seedStory(server, { scene: SCENE });
    await page.goto(server.url);

    // Nothing was written, so there is nothing to summarise and nothing to ask.
    await page.getByRole('button', { name: 'Chapters' }).click();
    await page.getByRole('dialog').getByRole('button', { name: 'New chapter' }).click();
    const sheet = page.getByRole('dialog');
    await expect(sheet.getByRole('heading', { name: /Chapter 2 — the scene/ })).toBeVisible();
  });

  test('a closed chapter opens read-only until it is continued', async ({ page, server }) => {
    await seedConnectedSettings(server);
    await seedStory(server, { scene: SCENE });
    await page.goto(server.url);
    await send(page, 'I knock.');
    await waitForTurn(page);

    await page.getByRole('button', { name: 'Close chapter' }).click();
    const review = page.getByRole('dialog');
    await review.locator('textarea').fill('A summary.');
    await review.getByRole('button', { name: 'Close the chapter' }).click();

    const sheet = page.getByRole('dialog');
    await sheet.locator('textarea.scene').fill('Later.');
    await sheet.getByRole('button', { name: 'Open the chapter' }).click();

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
  test('cancelling a rename changes nothing, in either place', async ({ page, server }) => {
    await seedConnectedSettings(server);
    await seedStory(server, { scene: SCENE, chapterTitle: 'A hundred and nine steps' });
    await page.goto(server.url);

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
  }) => {
    await seedConnectedSettings(server);
    await seedStory(server, { scene: SCENE, chapterTitle: 'A hundred and nine steps' });
    await page.goto(server.url);

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

  test('chapter numbers are never reused', async ({ page, server }) => {
    await seedConnectedSettings(server);
    await seedStory(server, { scene: SCENE });
    await page.goto(server.url);

    // Two more chapters, so there is a middle one to delete.
    for (const scene of ['The lantern room.', 'The jetty.']) {
      await page.getByRole('button', { name: 'Chapters' }).click();
      await page.getByRole('dialog').getByRole('button', { name: 'New chapter' }).click();
      const sheet = page.getByRole('dialog');
      await sheet.locator('textarea.scene').fill(scene);
      await sheet.getByRole('button', { name: 'Open the chapter' }).click();
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

  test('story, chapters and scenes survive a reload', async ({ page, server }) => {
    await seedConnectedSettings(server);
    await seedDeveloperMode(server);
    await seedStory(server, { scene: SCENE, storySoFar: 'Mara has just arrived.' });
    await page.goto(server.url);

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
});

test.describe('a new story', () => {
  test('asks for mode and persona before the first scene', async ({ page, server }) => {
    await seedConnectedSettings(server);
    await seedStory(server, { scene: SCENE });
    const bodies = await captureRequests(page);
    await page.goto(server.url);

    await page.getByRole('button', { name: /The Lighthouse/ }).click();
    await page.getByRole('menuitem', { name: 'New story…' }).click();

    const setup = page.getByRole('dialog');
    await setup.getByLabel('Title').fill('The Jetty');
    await setup.getByLabel('Name').fill('Ines');
    await setup.getByRole('button', { name: 'Write the first scene' }).click();

    const sheet = page.getByRole('dialog');
    await expect(sheet.getByRole('heading', { name: /Chapter 1 — the scene/ })).toBeVisible();
    // A new story starts on a blank scene: nothing is carried over from the last one.
    await expect(sheet.locator('textarea.scene')).toHaveValue('');
    await sheet.locator('textarea.scene').fill('The jetty, first light.');
    await sheet.getByRole('button', { name: 'Open the chapter' }).click();

    await expect(page.getByRole('button', { name: /The Jetty · Chapter 1/ })).toBeVisible();
    await send(page, 'I wait.');
    await waitForTurn(page);
    expect(systemOf(bodies[0])).toContain('The user plays Ines');
    expect(systemOf(bodies[0])).toContain('The jetty, first light.');
  });

  test('the persona box grows with what is typed, even in a short window', async ({
    page,
    server,
  }) => {
    // A short window is what made this fail: the sheet overflowed, and a flex
    // column shrinks its children rather than scrolling, so the box was pinned
    // at one line however much was typed into it.
    await page.setViewportSize({ width: 900, height: 520 });
    await seedConnectedSettings(server);
    await seedStory(server, { scene: SCENE });
    await page.goto(server.url);

    await page.getByRole('button', { name: /The Lighthouse/ }).click();
    await page.getByRole('menuitem', { name: 'New story…' }).click();
    const box = page.getByRole('dialog').locator('textarea');
    await box.waitFor();
    // The dialog scales up as it opens, which moves the numbers this measures.
    // Waiting for the animation to be over says that; a sleep says "probably
    // by now", and is the one thing every flaky suite has in common.
    await expect(page.locator('.mdc-dialog--opening')).toHaveCount(0);

    const state = () =>
      box.evaluate((el: HTMLTextAreaElement) => ({
        drawn: el.getBoundingClientRect().height,
        // Squashed by the flex column, the box would scroll its own text.
        scrolling: el.scrollHeight > el.clientHeight + 4,
      }));
    const short = await state();
    await box.fill(Array.from({ length: 9 }, (_, i) => `line ${i + 1}`).join(NEWLINE));
    const tall = await state();
    expect(tall.drawn).toBeGreaterThan(short.drawn + 80);
    expect(tall.scrolling).toBe(false);
  });

  test('backing out of the sheet creates nothing', async ({ page, server }) => {
    await seedConnectedSettings(server);
    await seedStory(server, { scene: SCENE });
    await page.goto(server.url);

    await page.getByRole('button', { name: /The Lighthouse/ }).click();
    await page.getByRole('menuitem', { name: 'New story…' }).click();
    await page.getByRole('dialog').getByLabel('Title').fill('Never mind');
    await page.keyboard.press('Escape');

    await expect(page.getByRole('button', { name: /The Lighthouse · Chapter 1/ })).toBeVisible();
    await page.getByRole('button', { name: /The Lighthouse/ }).click();
    await expect(page.getByRole('menuitem', { name: 'Never mind' })).toHaveCount(0);
  });
});

test.describe('first run', () => {
  test('asks for the connection, then who tells it, then for a scene', async ({ page, server }) => {
    await page.goto(server.url);

    // Nothing is stored, so the connection is the first thing on screen: no
    // other question means anything until the app has somewhere to send the
    // story, and this sheet does not take Escape for an answer.
    const dialog = page.getByRole('dialog');
    await expect(
      dialog.getByRole('heading', { name: /somewhere to send the story/ }),
    ).toBeVisible();
    await expect(dialog.getByRole('button', { name: 'Done' })).toBeDisabled();
    await page.keyboard.press('Escape');
    await expect(
      dialog.getByRole('heading', { name: /somewhere to send the story/ }),
    ).toBeVisible();

    await dialog.getByRole('combobox', { name: 'Provider' }).click();
    await page.getByRole('option', { name: /Custom/ }).click();
    await dialog.getByLabel('Endpoint URL').fill(FAKE_API_URL);

    await dialog.getByRole('button', { name: 'Fetch models' }).click();
    await expect(dialog.getByText('3 models', { exact: true })).toBeVisible();

    await dialog.getByRole('combobox', { name: 'Model' }).click();
    await page.getByRole('option', { name: /Storyteller Large/ }).click();

    await dialog.getByRole('button', { name: 'Test' }).click();
    await expect(dialog.getByText(/The model answered/)).toBeVisible({ timeout: 20_000 });

    // Answered, so the way on lights up.
    const done = dialog.getByRole('button', { name: 'Done' });
    await expect(done).toBeEnabled();
    await done.click();

    // Only then the story questions.
    const setup = page.getByRole('dialog');
    await expect(setup.getByRole('heading', { name: 'Your first story' })).toBeVisible();
    await setup.getByLabel('Title').fill('The Lighthouse');
    await setup.getByRole('button', { name: /Role-play/ }).click();
    await setup.getByLabel('Name').fill('Mara');
    await setup.getByRole('button', { name: 'Write the first scene' }).click();

    // Then the scene sheet, and only then can anything be written.
    const sheet = page.getByRole('dialog');
    await expect(sheet.getByRole('heading', { name: /Chapter 1 — the scene/ })).toBeVisible();
    await sheet.locator('textarea.scene').fill(SCENE);
    await sheet.getByRole('button', { name: 'Open the chapter' }).click();

    await expect(page.getByRole('button', { name: /The Lighthouse/ })).toBeVisible();
    await expect(composer(page)).toBeEnabled();

    const bodies = await captureRequests(page);
    await send(page, 'Begin.');
    await waitForTurn(page);
    await expect(assistantMessages(page)).toHaveCount(1);
    // What the first sheet asked for is in the very first request.
    expect(systemOf(bodies[0])).toContain('never write words, thoughts or actions for Mara');
  });

  test('the way out of the connection sheet leaves the app blocked, and says so', async ({
    page,
    server,
  }) => {
    await page.goto(server.url);

    const dialog = page.getByRole('dialog');
    await expect(
      dialog.getByRole('heading', { name: /somewhere to send the story/ }),
    ).toBeVisible();
    await dialog.getByRole('button', { name: 'Not now' }).click();

    // The flow carries on from where it was: the story questions, then the
    // scene.
    const setup = page.getByRole('dialog');
    await expect(setup.getByRole('heading', { name: 'Your first story' })).toBeVisible();
    await setup.getByRole('button', { name: 'Cancel' }).click();

    const sheet = page.getByRole('dialog');
    await expect(sheet.getByRole('heading', { name: /Chapter 1 — the scene/ })).toBeVisible();
    await sheet.locator('textarea.scene').fill(SCENE);
    await sheet.getByRole('button', { name: 'Open the chapter' }).click();

    // With a scene written and still nowhere to send it, the composer is the
    // one saying so — rather than a modal that cannot be dismissed.
    await expectComposerHidden(page, /Pick a model|endpoint URL/);
  });
});
/**
 * The six blocks of the system prompt are in a fixed order, and four of them do
 * not have to be. The reordering lives in the preview because that is where a
 * person is when they form an opinion about it — and it is per story, because
 * it is a judgement about that story and the model behind it.
 */
test.describe('the order of the prompt', () => {
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

  const handleOf = (page: Page, label: string) =>
    page.locator('.block.movable', { hasText: label }).locator('.handle');

  /**
   * The blocks of the system message, top to bottom; the rest of the sheet is
   * not one. Read as text content rather than as rendered text, because the
   * headings are set in small capitals by the stylesheet.
   */
  const order = (page: Page) =>
    page
      .locator('mat-dialog-content .block')
      .filter({ has: page.locator('.handle, .why') })
      .locator('.name')
      .allTextContents()
      .then((names) => names.map((name) => name.trim()));

  async function open(server: PersistenceServer, page: Page): Promise<void> {
    await seedConnectedSettings(server);
    await seedDeveloperMode(server);
    await seedStory(server, {
      scene: SCENE,
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
    await page.goto(server.url);
    await openPromptPreview(page);
  }

  test('a block moves, the preview rebuilds, and the request follows', async ({ page, server }) => {
    await open(server, page);
    expect(await order(page)).toEqual(DEFAULT_ORDER);

    // A drag with a mouse, which is what the handle is there for.
    await dragAbove(
      page,
      handleOf(page, 'The story so far'),
      page.locator('.block.movable').first(),
    );
    await expect
      .poll(() => order(page))
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
  }) => {
    await open(server, page);

    await handleOf(page, 'The story so far').focus();
    await page.keyboard.press('ArrowUp');
    await expect
      .poll(() => order(page))
      .toEqual(['Narrator', 'The story so far', 'Persona', 'This chapter', 'Style']);
  });

  test('reset puts the order back and leaves nothing in the document', async ({ page, server }) => {
    await open(server, page);

    // No reset offered until there is something to reset.
    await expect(page.getByRole('button', { name: 'Reset the order' })).toHaveCount(0);
    await handleOf(page, 'This chapter').focus();
    await page.keyboard.press('ArrowUp');
    await page.getByRole('button', { name: 'Reset the order' }).click();

    await expect.poll(() => order(page)).toEqual(DEFAULT_ORDER);
    await expect
      .poll(async () => {
        const story = await server.document('stories', STORY_ID);
        return story !== null && 'promptOrder' in story;
      })
      .toBe(false);
    await expect(page.getByRole('button', { name: 'Reset the order' })).toHaveCount(0);
  });

  test('one story reordered leaves the other alone', async ({ page, server }) => {
    await open(server, page);
    await handleOf(page, 'This chapter').focus();
    await page.keyboard.press('ArrowUp');
    await expect
      .poll(async () => (await server.document('stories', STORY_ID))?.['promptOrder'])
      .toBeDefined();
    await page.getByRole('button', { name: 'Done' }).click();

    await page.getByRole('button', { name: /The Lighthouse/ }).click();
    await page.getByRole('menuitem', { name: 'The Jetty' }).click();
    await openPromptPreview(page);

    expect(await order(page)).toEqual(DEFAULT_ORDER);
    const other = await server.document('stories', SECOND_STORY);
    expect(other !== null && 'promptOrder' in other).toBe(false);
  });

  test('an order this build cannot make sense of is simply not used', async ({ page, server }) => {
    await seedConnectedSettings(server);
    await seedDeveloperMode(server);
    await seedStory(server, {
      scene: SCENE,
      storySoFar: 'Mara has just arrived on the island.',
      persona: { name: 'Mara', description: 'a marine biologist' },
    });
    const story = await server.document('stories', STORY_ID);
    await server.seed({ ['story:' + STORY_ID]: { ...story, promptOrder: ['lore', 'bogus'] } });

    await page.goto(server.url);
    await openPromptPreview(page);
    expect(await order(page)).toEqual(DEFAULT_ORDER);
  });
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
