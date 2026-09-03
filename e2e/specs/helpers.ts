import { Locator, Page, expect } from '@playwright/test';

export const FAKE_API_URL = `http://localhost:${process.env.FAKE_API_PORT ?? 4310}/v1`;
export const FAKE_MODEL = 'fake/storyteller-large';

export const STORY_ID = 'story-under-test';
export const CHAPTER_ID = 'chapter-under-test';

/**
 * Seeds `settings.json` the way the app itself stores it, so specs start from a
 * connected app without walking the Connection modal every time. One spec does
 * walk it, which is what keeps this shape honest.
 */
export async function seedConnectedSettings(page: Page, apiKey = 'test-key'): Promise<void> {
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
    },
    ui: {
      theme: 'dark',
      bookStyleDialogue: true,
      fontSize: 18,
      showTokenCounts: true,
    },
    activeStoryId: STORY_ID,
  };
  await page.addInitScript(
    ([value]) => {
      if (window.localStorage.getItem('magicstories:settings') === null) {
        window.localStorage.setItem('magicstories:settings', value);
      }
    },
    [JSON.stringify(settings)],
  );
}

export interface SeedStory {
  title?: string;
  mode?: 'narrator' | 'roleplay';
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
export async function seedStory(page: Page, options: SeedStory = {}): Promise<void> {
  const story = {
    id: STORY_ID,
    title: options.title ?? 'The Lighthouse',
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    mode: options.mode ?? 'narrator',
    narrator: { useDefault: true, prompt: '' },
    characters: options.characters ?? [],
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
  // Init scripts run on every navigation, so seed only what is not there yet:
  // a reload has to show what the app stored, not what the spec started from.
  await page.addInitScript(
    ([storyId, chapterId, storyJson, chapterJson]) => {
      const seed = (key: string, value: string) => {
        if (window.localStorage.getItem(key) === null) window.localStorage.setItem(key, value);
      };
      seed(`magicstories:story:${storyId}`, storyJson);
      seed(`magicstories:chapter:${chapterId}`, chapterJson);
    },
    [STORY_ID, CHAPTER_ID, JSON.stringify(story), JSON.stringify(chapter)],
  );
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

/** Flips the book-style switch in the Reading menu and closes the menu. */
export async function setBookStyle(page: Page, on: boolean): Promise<void> {
  await page.getByRole('button', { name: 'Reading' }).click();
  const toggle = page.getByRole('switch', { name: 'Dialogue on its own line' });
  if ((await toggle.getAttribute('aria-checked')) !== String(on)) await toggle.click();
  await page.keyboard.press('Escape');
  await expect(toggle).toBeHidden();
}

/** Hovering is what reveals a message's toolbar. */
export async function act(message: Locator, name: string | RegExp): Promise<void> {
  await message.hover();
  await message.getByRole('button', { name }).click();
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
