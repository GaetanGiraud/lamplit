import type { Page } from '@playwright/test';
import { openPreferences, seedConnectedSettings, seedStory, send, waitForTurn } from './helpers';
import { expect, test } from './fixtures';

const SCENE = 'The lantern room at dusk. The lamp is cold and the stairs are wet.';

/**
 * What the page is actually painted in.
 *
 * The body's background is `var(--ms-page)`, so this is the token resolved all
 * the way through `light-dark()` by the browser — reading the custom property
 * itself would hand back the unresolved `light-dark(…, …)` and say the same
 * thing in both themes.
 */
function paperColour(page: Page): Promise<string> {
  return page.evaluate(() => getComputedStyle(document.body).backgroundColor);
}

/** A hex as the browser reports it back. */
function rgb(hex: string): string {
  const value = parseInt(hex.slice(1), 16);
  return `rgb(${(value >> 16) & 255}, ${(value >> 8) & 255}, ${value & 255})`;
}

/**
 * The colours are a stylesheet the reader is allowed to edit, so the assertions
 * here are made against the computed style rather than a screenshot: what
 * matters is that the page is *drawn* in the colour, and that it is still the
 * colour after a reload, which is the only place the setting could have been.
 *
 * These start from 0.1.0's settings file — `seedConnectedSettings` writes the
 * four reading fields and nothing else — so the upgrade path is checked on
 * every run of the suite rather than once in a spec of its own.
 */
test.describe('preferences', () => {
  test.beforeEach(async ({ server }) => {
    await seedConnectedSettings(server);
    await seedStory(server, { scene: SCENE });
  });

  /** The native picker is not clickable, so the value is set the way a browser would. */
  function paint(page: Page, colour: string): Promise<void> {
    return page
      .getByLabel(/^Page/)
      .first()
      .evaluate((input: HTMLInputElement, value) => {
        input.value = value;
        input.dispatchEvent(new Event('input', { bubbles: true }));
      }, colour);
  }

  test('opens on Reading, holding what the Reading menu held', async ({ page, server }) => {
    await page.goto(server.url);
    await openPreferences(page);

    // The first section is open on arrival, with all four of its settings.
    await expect(page.getByRole('switch', { name: 'Dark theme' })).toBeVisible();
    await expect(page.getByRole('switch', { name: 'Dialogue on its own line' })).toBeVisible();
    await expect(page.getByRole('switch', { name: 'Show token counts' })).toBeVisible();
    await expect(page.getByRole('slider')).toBeVisible();

    await page.getByRole('switch', { name: 'Show token counts' }).click();
    await expect
      .poll(async () => {
        const settings = await server.document('settings');
        return (settings?.['ui'] as Record<string, unknown>)?.['showTokenCounts'];
      })
      .toBe(false);
  });

  test('a colour is on the page at once, and on disk after a reload', async ({ page, server }) => {
    await page.goto(server.url);
    const shipped = await paperColour(page);

    await openPreferences(page);
    await page.getByRole('button', { name: 'Colours' }).first().click();
    await paint(page, '#123456');

    // Immediately, with the dialog still open over it.
    await expect.poll(() => paperColour(page)).toBe(rgb('#123456'));
    expect(shipped).not.toBe(rgb('#123456'));

    await expect
      .poll(async () => {
        const settings = await server.document('settings');
        const ui = settings?.['ui'] as { colours?: Record<string, Record<string, string>> };
        return ui?.colours?.['dark']?.['page'];
      })
      .toBe('#123456');

    // The browser keeps nothing of its own, so this is the file coming back.
    await page.reload();
    await expect.poll(() => paperColour(page)).toBe(rgb('#123456'));
  });

  test('each theme keeps its own set, and reset returns the shipped one', async ({
    page,
    server,
  }) => {
    await page.goto(server.url);
    await openPreferences(page);
    await page.getByRole('button', { name: 'Colours' }).first().click();

    await paint(page, '#123456');
    await page.getByRole('switch', { name: 'Dark theme' }).click();

    // Switching the theme switched the palette with it: light is untouched.
    await expect.poll(() => paperColour(page)).not.toBe(rgb('#123456'));
    const shippedLight = await paperColour(page);
    await paint(page, '#fedcba');
    await expect.poll(() => paperColour(page)).toBe(rgb('#fedcba'));

    await page.getByRole('button', { name: 'Reset the light colours' }).click();
    await page.getByRole('button', { name: 'Reset', exact: true }).click();

    // Exactly the shipped colour, because the override is gone rather than
    // replaced by a copy of it.
    await expect.poll(() => paperColour(page)).toBe(shippedLight);

    // And the dark set survived the reset of the light one.
    await page.getByRole('switch', { name: 'Dark theme' }).click();
    await expect.poll(() => paperColour(page)).toBe(rgb('#123456'));
  });

  test('the reading font changes the story and leaves the app alone', async ({ page, server }) => {
    await page.goto(server.url);
    // The reading face is only visible on prose, so there has to be some.
    await send(page, 'Two lines, please.');
    await waitForTurn(page);

    await openPreferences(page);
    await page.getByRole('button', { name: 'Colours' }).first().click();
    await page.getByRole('combobox', { name: 'Reading font' }).click();
    await page.getByRole('option', { name: 'Monospace' }).click();
    await page.getByRole('button', { name: 'Done' }).click();
    await expect(page.getByRole('heading', { name: 'Preferences' })).toBeHidden();

    const faceOf = (selector: string) =>
      page
        .locator(selector)
        .first()
        .evaluate((el) => getComputedStyle(el).fontFamily);

    await expect.poll(() => faceOf('.story-prose')).toMatch(/Cascadia|Consolas|monospace/i);
    // The wordmark is app furniture and stays in the serif it always was.
    await expect.poll(() => faceOf('ms-top-bar .wordmark')).toMatch(/Iowan|Palatino|serif/i);
  });
});
