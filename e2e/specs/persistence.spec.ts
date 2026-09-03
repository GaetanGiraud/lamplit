import {
  CHAPTER_ID,
  STORY_ID,
  seedConnectedSettings,
  seedStory,
  send,
  waitForTurn,
} from './helpers';
import { expect, test } from './fixtures';

const SCENE = 'The lantern room at dusk. The lamp is cold and the stairs are wet.';

/**
 * The disk is the story. Every assertion here is made against the JSON files
 * rather than the screen, because the screen can be right while the file is
 * wrong — and the file is the only copy there is.
 */
test.describe('persistence', () => {
  test('writes each document to its own file, as the app changes it', async ({ page, server }) => {
    await seedConnectedSettings(server);
    await seedStory(server, { scene: SCENE });
    await page.goto(server.url);

    // What was seeded is what the app opened; nothing was invented alongside it.
    expect(await server.ids('stories')).toEqual([STORY_ID]);
    expect(await server.ids('chapters')).toEqual([CHAPTER_ID]);
    await expect(page.locator('ms-top-bar')).toContainText('The Lighthouse');

    await send(page, 'Two lines, please.');
    await waitForTurn(page);

    // The chapter document on disk is the conversation, in order.
    await expect
      .poll(async () => {
        const chapter = await server.document('chapters', CHAPTER_ID);
        return (chapter?.['messages'] as { role: string }[] | undefined)?.map((m) => m.role);
      })
      .toEqual(['user', 'assistant']);

    const chapter = await server.document('chapters', CHAPTER_ID);
    const messages = chapter?.['messages'] as { role: string; content: string }[];
    expect(messages[0].content).toBe('Two lines, please.');
    expect(messages[1].content.length).toBeGreaterThan(0);
  });

  test('a reload comes back to what is on disk, and only that', async ({ page, server }) => {
    await seedConnectedSettings(server);
    await seedStory(server, { scene: SCENE });
    await page.goto(server.url);

    await send(page, 'Two lines, please.');
    await waitForTurn(page);
    await expect
      .poll(async () => (await server.document('chapters', CHAPTER_ID))?.['messages']?.length)
      .toBe(2);

    // Delete the chapter behind the app's back, then reload: the browser has no
    // copy of its own to fall back on, so what comes up is the disk as it now
    // stands rather than the disk as it was.
    await server.remove('chapters', CHAPTER_ID);
    await page.reload();

    await expect(page.locator('article[data-role]')).toHaveCount(0);
    await expect.poll(() => server.ids('chapters')).toHaveLength(1);
    expect((await server.ids('chapters'))[0]).not.toBe(CHAPTER_ID);
  });

  test('a second browser sees the same story, because there is only one', async ({
    page,
    browser,
    server,
  }) => {
    await seedConnectedSettings(server);
    await seedStory(server, { scene: SCENE, title: 'The Lighthouse' });
    await page.goto(server.url);
    await send(page, 'Two lines, please.');
    await waitForTurn(page);
    await expect
      .poll(async () => (await server.document('chapters', CHAPTER_ID))?.['messages']?.length)
      .toBe(2);

    const fresh = await browser.newContext();
    const other = await fresh.newPage();
    await other.goto(server.url);

    await expect(other.locator('ms-top-bar')).toContainText('The Lighthouse');
    await expect(other.locator('article[data-role]')).toHaveCount(2);
    await expect(other.locator('article[data-role="user"]')).toContainText('Two lines, please.');
    await fresh.close();
  });

  test('keeps writing while the server is down, and catches up when it is back', async ({
    page,
    server,
  }) => {
    await seedConnectedSettings(server);
    await seedStory(server, { scene: SCENE });
    await page.goto(server.url);

    await server.stop();

    await send(page, 'Keep going without a disk.');
    await waitForTurn(page);

    const offline = page.getByRole('button', { name: 'Offline' });
    await expect(offline).toBeVisible({ timeout: 20_000 });
    // The session has everything it needs in memory; only the disk is behind.
    await expect(page.locator('article[data-role]')).toHaveCount(2);

    await server.start();
    await offline.click();

    await expect(offline).toBeHidden({ timeout: 20_000 });
    await expect
      .poll(async () => (await server.document('chapters', CHAPTER_ID))?.['messages']?.length)
      .toBe(2);
  });

  test('an edit made in one tab is there when the other reloads', async ({
    page,
    context,
    server,
  }) => {
    await seedConnectedSettings(server);
    await seedStory(server, { scene: SCENE });
    await page.goto(server.url);

    const second = await context.newPage();
    await second.goto(server.url);
    await second.getByRole('button', { name: /The Lighthouse/ }).click();
    await second.getByRole('menuitem', { name: 'Rename…' }).click();
    await second.getByRole('textbox', { name: 'Title' }).fill('The Lantern Room');
    await second.getByRole('button', { name: 'Save' }).click();

    await expect
      .poll(() => server.document('stories', STORY_ID).then((story) => story?.['title']))
      .toBe('The Lantern Room');

    await page.reload();
    await expect(page.locator('ms-top-bar')).toContainText('The Lantern Room');
    await second.close();
  });

  test('deleting a story takes its files with it', async ({ page, server }) => {
    await seedConnectedSettings(server);
    await seedStory(server, { scene: SCENE });
    await page.goto(server.url);

    await page.getByRole('button', { name: /The Lighthouse/ }).click();
    await page.getByRole('menuitem', { name: 'Delete story…' }).click();
    await page.getByRole('button', { name: 'Delete' }).click();

    // The story is replaced by a fresh one, so what matters is that the old
    // documents are gone from disk rather than that the folders are empty.
    await expect.poll(() => server.ids('stories')).not.toContain(STORY_ID);
    await expect.poll(() => server.ids('chapters')).not.toContain(CHAPTER_ID);
  });

  test('says so plainly when the documents cannot be read', async ({ page, server }) => {
    await seedConnectedSettings(server);
    await seedStory(server, { scene: SCENE });
    // The app is served; the documents behind it are not.
    await page.route(/\/api\/docs\//, (route) => route.abort());
    await page.goto(server.url);

    // No documents means no app: an empty one would look like a fresh install
    // and would be written over the real story on the next keystroke.
    await expect(page.getByRole('heading', { name: /cannot reach its server/ })).toBeVisible({
      timeout: 20_000,
    });
    await expect(page.locator('ms-top-bar')).toHaveCount(0);
    expect(await server.ids('stories')).toEqual([STORY_ID]);
  });
});
