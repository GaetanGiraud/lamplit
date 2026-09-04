import { Locator, Page, expect } from '@playwright/test';
import type { PersistenceServer } from './persistence-server';

export const FAKE_API_URL = `http://localhost:${process.env.FAKE_API_PORT ?? 4310}/v1`;
export const FAKE_MODEL = 'fake/storyteller-large';

export const STORY_ID = 'story-under-test';
export const CHAPTER_ID = 'chapter-under-test';

/**
 * Writes `settings.json` into the server's data folder, so specs start from a
 * connected app without walking the Connection modal every time. One spec does
 * walk it, which is what keeps this shape honest.
 *
 * On disk rather than in the browser, because the browser keeps nothing: the
 * app reads every document from the server when it starts.
 */
export async function seedConnectedSettings(
  server: PersistenceServer,
  apiKey = 'test-key',
  generation: Record<string, unknown> = {},
): Promise<void> {
  const settings = {
    connection: {
      provider: 'custom',
      baseUrl: FAKE_API_URL,
      apiKey,
      model: FAKE_MODEL,
      modelsCache: [{ id: FAKE_MODEL, name: 'Storyteller Large', ownedBy: 'fake' }],
    },
    generation: {
      maxContextTokens: 16384,
      maxResponseTokens: 800,
      temperature: 0.9,
      topP: 1,
      frequencyPenalty: 0,
      presencePenalty: 0,
      stop: [],
      ...generation,
    },
    ui: {
      theme: 'dark',
      bookStyleDialogue: true,
      fontSize: 18,
      showTokenCounts: true,
    },
    activeStoryId: STORY_ID,
  };
  await server.seed({ settings });
}

/**
 * Turns developer mode on before the app starts.
 *
 * The context pill and the prompt preview behind it are only there when it is,
 * so any spec that reads the assembled prompt has to say so — and a spec that
 * does not is checking the app a writer actually sees.
 */
export async function seedDeveloperMode(server: PersistenceServer): Promise<void> {
  const settings = (await server.document('settings')) ?? {};
  const ui = (settings['ui'] as Record<string, unknown>) ?? {};
  await server.seed({ settings: { ...settings, ui: { ...ui, developerMode: true } } });
}

/** Opens What the model sees, which developer mode's pill is the only way into. */
export async function openPromptPreview(page: Page): Promise<void> {
  await page.getByRole('button', { name: /^context/ }).click();
  await expect(page.getByRole('heading', { name: 'What the model sees' })).toBeVisible();
  // The sheet grows into place, and anything measured or scrolled while it is
  // still growing is measured against geometry that is about to change — which
  // is how a click lands on the wrong element and a scroll ends up at the foot.
  await expect(page.locator('.mdc-dialog--opening')).toHaveCount(0);
}

export interface SeedStory {
  title?: string;
  mode?: 'narrator' | 'roleplay';
  /** Absent is what a story written before casting was a choice looks like. */
  roleplay?: { casting: 'ensemble' | 'one-at-a-time'; activeCharacterId: string };
  persona?: { name: string; description: string };
  characters?: { id: string; name: string; description: string; enabled: boolean }[];
  storySoFar?: string;
  entries?: {
    id: string;
    title: string;
    category?: 'fact' | 'person' | 'place' | 'other';
    keys: string[];
    content: string;
    enabled?: boolean;
    alwaysOn?: boolean;
  }[];
  /** The opening chapter's scene. Empty means the composer stays shut. */
  scene?: string;
  chapterTitle?: string;
}

/** Seeds one story with one chapter, the state most specs want to start from. */
export async function seedStory(server: PersistenceServer, options: SeedStory = {}): Promise<void> {
  const story = {
    id: STORY_ID,
    title: options.title ?? 'The Lighthouse',
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    mode: options.mode ?? 'narrator',
    narrator: { useDefault: true, prompt: '' },
    characters: options.characters ?? [],
    ...(options.roleplay ? { roleplay: options.roleplay } : {}),
    persona: options.persona ?? { name: '', description: '' },
    style: { dialogueOnOwnLine: true, replyLength: 'medium' },
    world: {
      storySoFar: options.storySoFar ?? '',
      entries: (options.entries ?? []).map((entry) => ({
        category: 'fact',
        enabled: true,
        alwaysOn: false,
        ...entry,
      })),
      scan: { depth: 4, caseSensitive: false, matchWholeWords: false },
    },
    activeChapterId: CHAPTER_ID,
    chapterCounter: 1,
  };
  const chapter = {
    id: CHAPTER_ID,
    storyId: STORY_ID,
    number: 1,
    title: options.chapterTitle ?? '',
    scene: options.scene ?? '',
    status: 'writing',
    summary: '',
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    messages: [],
  };
  await server.seed({
    [`story:${STORY_ID}`]: story,
    [`chapter:${CHAPTER_ID}`]: chapter,
  });
}

/**
 * Waits for the chapter under test to reach disk.
 *
 * A reload now starts again from the server, so a spec that reloads has to let
 * the write land first. The app says the same thing with the "Saving…" pill in
 * the top bar; this is the version that cannot race it.
 */
export async function waitForSaved(server: PersistenceServer, messageCount: number): Promise<void> {
  await expect
    .poll(async () => {
      const chapter = await server.document('chapters', CHAPTER_ID);
      return (chapter?.['messages'] as unknown[] | undefined)?.length ?? 0;
    })
    .toBe(messageCount);
}

export function messages(page: Page): Locator {
  return page.locator('article[data-role]');
}

export function userMessages(page: Page): Locator {
  return page.locator('article[data-role="user"]');
}

export function assistantMessages(page: Page): Locator {
  return page.locator('article[data-role="assistant"]');
}

export function composer(page: Page): Locator {
  return page.locator('ms-composer textarea');
}

/**
 * A chapter that cannot be written into has no box at all — only the reason
 * and the way out of it.
 */
export async function expectComposerHidden(page: Page, reason: RegExp): Promise<void> {
  await expect(composer(page)).toHaveCount(0);
  await expect(page.locator('ms-composer').getByRole('button', { name: reason })).toBeVisible();
}

export async function send(page: Page, text: string): Promise<void> {
  await composer(page).fill(text);
  await page.getByRole('button', { name: 'Send', exact: true }).click();
}

/** Waits for the turn to finish: the Stop button is only up while streaming. */
export async function waitForTurn(page: Page): Promise<void> {
  await expect(page.getByRole('button', { name: 'Stop' })).toBeHidden({
    timeout: 20_000,
  });
}

/** Opens Preferences, which arrives with Reading already open. */
export async function openPreferences(page: Page): Promise<void> {
  await page.getByRole('button', { name: 'Preferences' }).click();
  await expect(page.getByRole('heading', { name: 'Preferences' })).toBeVisible();
}

/** Flips the book-style switch under Preferences → Reading and closes the sheet. */
export async function setBookStyle(page: Page, on: boolean): Promise<void> {
  await openPreferences(page);
  const toggle = page.getByRole('switch', { name: 'Dialogue on its own line' });
  if ((await toggle.getAttribute('aria-checked')) !== String(on)) await toggle.click();
  await page.keyboard.press('Escape');
  await expect(toggle).toBeHidden();
}

/**
 * Hovering is what reveals a message's actions. They live in the right margin
 * at this width; below the measure, or on a touch screen, the same names are
 * behind the ⋯ under the message, which `actFromMenu` reaches instead.
 */
export async function act(message: Locator, name: string | RegExp): Promise<void> {
  await message.hover();
  await message.getByRole('button', { name }).click();
}

/** The same actions, from the ⋯ the narrow layout puts under the message. */
export async function actFromMenu(
  page: Page,
  message: Locator,
  name: string | RegExp,
): Promise<void> {
  await message.getByRole('button', { name: 'Message actions' }).click();
  await page.getByRole('menuitem', { name }).click();
}

/** Collects the request bodies the app sends, for prompt assertions. */
export async function captureRequests(page: Page): Promise<Record<string, any>[]> {
  const bodies: Record<string, any>[] = [];
  await page.route('**/chat/completions', async (route) => {
    bodies.push(route.request().postDataJSON());
    await route.continue();
  });
  return bodies;
}

/** The system message of the last request, which is where the prompt lives. */
export function systemOf(body: Record<string, any> | undefined): string {
  const message = (body?.['messages'] ?? []).find((m: { role: string }) => m.role === 'system');
  return message?.content ?? '';
}

/**
 * The system messages sent *between* the turns. The first system message is
 * the prompt itself; anything after it is the app telling the model that the
 * cast changed at that point in the chapter.
 */
export function notesOf(body: Record<string, any> | undefined): string[] {
  return ((body?.['messages'] ?? []) as { role: string; content: string }[])
    .filter((m) => m.role === 'system')
    .slice(1)
    .map((m) => m.content);
}
