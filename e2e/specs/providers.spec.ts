import { expect, test } from './fixtures';
import { FAKE_API_URL, seedConnectedSettings, seedStory } from './helpers';

/**
 * The provider list is data (`app/src/app/core/providers.ts`), and the unit
 * tests check the data. What only a browser can show is that choosing a row
 * actually rewrites the modal: the URL, the key link, and the model list that
 * belonged to the endpoint just left.
 */
test.describe('choosing a provider', () => {
  test.beforeEach(async ({ page, server }) => {
    await seedConnectedSettings(server);
    await seedStory(server, { scene: 'A quiet room.' });
    await page.goto(server.url);
    await page.keyboard.press('Control+k');
    await expect(page.getByRole('dialog').getByText('Connection')).toBeVisible();
  });

  /**
   * The select's panel is an overlay with a backdrop of its own, so the next
   * click has to wait for it to be gone or it lands on the backdrop instead.
   */
  async function choose(page: import('@playwright/test').Page, name: string | RegExp) {
    await page.getByRole('dialog').getByRole('combobox', { name: 'Provider' }).click();
    await page.getByRole('option', { name, exact: typeof name === 'string' }).click();
    await expect(page.getByRole('option')).toHaveCount(0);
  }

  test('swaps the URL and the place to get a key', async ({ page }) => {
    const dialog = page.getByRole('dialog');
    const url = dialog.getByLabel('Endpoint URL');

    await choose(page, 'OpenRouter');
    await expect(url).toHaveValue('https://openrouter.ai/api/v1');
    await expect(url).toHaveJSProperty('readOnly', true);
    await expect(dialog.getByRole('link', { name: /Get a key from OpenRouter/ })).toHaveAttribute(
      'href',
      'https://openrouter.ai/keys',
    );

    await choose(page, 'Anthropic');
    await expect(url).toHaveValue('https://api.anthropic.com/v1');
    await expect(dialog.getByRole('link', { name: /Get a key from Anthropic/ })).toBeVisible();

    // The model list belonged to the endpoint just left, so it goes with it.
    await expect(dialog.getByRole('combobox', { name: 'Model' })).toHaveCount(0);
  });

  test('lets a local endpoint be picked without a key, and Custom be typed', async ({ page }) => {
    const dialog = page.getByRole('dialog');
    const url = dialog.getByLabel('Endpoint URL');

    await choose(page, 'Ollama');
    await expect(url).toHaveValue('http://localhost:11434/v1');
    await expect(dialog.getByText('This one works without a key')).toBeVisible();

    await choose(page, /^Custom/);
    await expect(url).toHaveJSProperty('readOnly', false);
    await url.fill(FAKE_API_URL);
    await dialog.getByRole('button', { name: 'Fetch models' }).click();
    await expect(dialog.getByText('3 models', { exact: true })).toBeVisible();
  });

  test('gives Perplexity its built-in list instead of a Fetch button', async ({ page }) => {
    const dialog = page.getByRole('dialog');

    await choose(page, 'Perplexity');
    await expect(dialog.getByRole('button', { name: /Fetch models|Refresh models/ })).toHaveCount(
      0,
    );

    await dialog.getByRole('combobox', { name: 'Model' }).click();
    await page.getByRole('option', { name: 'Sonar Pro' }).click();
    await expect(dialog.getByRole('combobox', { name: 'Model' })).toContainText('Sonar Pro');
  });
});

/**
 * Ctrl+K is the way to the Connection sheet, and one sheet is what it opens.
 * A shortcut that answers while its own sheet is on screen stacks a second
 * one over the first — and a key held down stacks one per repeat.
 */
test('opens one Connection sheet however many times it is asked for', async ({ page, server }) => {
  await seedConnectedSettings(server);
  await seedStory(server, { scene: 'A quiet room.' });
  await page.goto(server.url);

  await page.keyboard.press('Control+k');
  await expect(page.locator('mat-dialog-container')).toHaveCount(1);

  await page.keyboard.press('Control+k');
  await page.keyboard.press('Control+k');

  await expect(page.locator('mat-dialog-container')).toHaveCount(1);
  // And one Escape puts the reader back on the page, not one sheet deeper.
  await page.keyboard.press('Escape');
  await expect(page.locator('mat-dialog-container')).toHaveCount(0);
});
