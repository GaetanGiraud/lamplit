import { Locator, Page, expect } from '@playwright/test';

export const FAKE_API_URL = `http://localhost:${process.env.FAKE_API_PORT ?? 4310}/v1`;
export const FAKE_MODEL = 'fake/storyteller-large';

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
    activeStoryId: null,
  };
  await page.addInitScript(
    ([value]) => window.localStorage.setItem('magicstories:settings', value),
    [JSON.stringify(settings)],
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
