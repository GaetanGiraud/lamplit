import { expect, test } from '@playwright/test';
import {
  CHAPTER_ID,
  STORY_ID,
  seedConnectedSettings,
  seedStory,
  send,
  waitForTurn,
} from './helpers';
import { IS_BUILT, PersistenceServer } from './persistence-server';

const SCENE = 'The lantern room at dusk. The lamp is cold and the stairs are wet.';

/**
 * Step 3's acceptance run: the app served by the persistence server, and every
 * assertion made against the files on disk rather than against the screen.
 */
test.describe('persistence', () => {
  test.skip(!IS_BUILT, 'the app has not been built — run `npm run e2e`, which builds it first');

  let server: PersistenceServer;

  test.beforeEach(async () => {
    server = await PersistenceServer.create();
    await server.start();
  });

  test.afterEach(async () => {
    await server.dispose();
  });

  test('writes each document to its own file, as the app changes it', async ({ page }) => {
    await seedConnectedSettings(page);
    await seedStory(page, { scene: SCENE });
    await page.goto(server.url);

    // What the browser arrived with is uploaded: the first run with a server.
    await expect.poll(() => server.ids('stories')).toEqual([STORY_ID]);
    await expect.poll(() => server.ids('chapters')).toEqual([CHAPTER_ID]);

    const settings = await server.document<Record<string, any>>('settings');
    expect(settings?.['connection'].model).toBe('fake/storyteller-large');
    expect((await server.document('stories', STORY_ID))?.['title']).toBe('The Lighthouse');
    expect((await server.document('chapters', CHAPTER_ID))?.['scene']).toBe(SCENE);

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

  test('a browser that has never seen this story reads it off the server', async ({
    page,
    browser,
  }) => {
    await seedConnectedSettings(page);
    await seedStory(page, { scene: SCENE, title: 'The Lighthouse' });
    await page.goto(server.url);
    await send(page, 'Two lines, please.');
    await waitForTurn(page);
    await expect
      .poll(async () => (await server.document('chapters', CHAPTER_ID))?.['messages']?.length)
      .toBe(2);

    // A separate browser: nothing cached, no seeds. Everything it shows came
    // off disk, which is what a backend is for.
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
  }) => {
    await seedConnectedSettings(page);
    await seedStory(page, { scene: SCENE });
    await page.goto(server.url);
    await expect.poll(() => server.ids('stories')).toEqual([STORY_ID]);

    await server.stop();

    await send(page, 'Keep going without a disk.');
    await waitForTurn(page);

    const offline = page.getByRole('button', { name: 'Offline' });
    await expect(offline).toBeVisible({ timeout: 20_000 });
    // Nothing is lost while it is down: the page carries on as it always did.
    await expect(page.locator('article[data-role]')).toHaveCount(2);

    await server.start();
    await offline.click();

    await expect(offline).toBeHidden({ timeout: 20_000 });
    await expect
      .poll(async () => (await server.document('chapters', CHAPTER_ID))?.['messages']?.length)
      .toBe(2);
  });

  test('an edit made in one tab is there when the other reloads', async ({ page, context }) => {
    await seedConnectedSettings(page);
    await seedStory(page, { scene: SCENE });
    await page.goto(server.url);
    await expect.poll(() => server.ids('stories')).toEqual([STORY_ID]);

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

  test('deleting a story takes its files with it', async ({ page }) => {
    await seedConnectedSettings(page);
    await seedStory(page, { scene: SCENE });
    await page.goto(server.url);
    await expect.poll(() => server.ids('chapters')).toEqual([CHAPTER_ID]);

    await page.getByRole('button', { name: /The Lighthouse/ }).click();
    await page.getByRole('menuitem', { name: 'Delete story…' }).click();
    await page.getByRole('button', { name: 'Delete' }).click();

    // The story is replaced by a fresh one, so what matters is that the old
    // documents are gone from disk rather than that the folders are empty.
    await expect.poll(() => server.ids('stories')).not.toContain(STORY_ID);
    await expect.poll(() => server.ids('chapters')).not.toContain(CHAPTER_ID);
  });
});
