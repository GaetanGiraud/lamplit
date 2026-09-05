import { expect, test } from '../fixtures';
import { actFromMenu, assistantMessages, send, waitForTurn } from '../helpers';
import { clearSpeech, fakeVoices, spoken, spokenText } from '../speech';
import { openMenu } from './helpers';

/**
 * Listening on the phone, which is what read-aloud is for: propped against
 * something across the room, hands free, the story arriving out loud.
 *
 * The switch is in the bar's one menu rather than behind Preferences, because
 * Preferences is not offered on a phone at all — and because unlike the text
 * size or the palette, this is a decision about *this* reading rather than
 * about the app, and it is made where the listening happens.
 */

test.beforeEach(async ({ page }) => {
  await fakeVoices(page);
});

test('a message is read from its own ⋯, with no margin to hold a button', async ({ page, app }) => {
  await app.open();
  await send(page, 'Two lines, please.');
  await waitForTurn(page);

  await actFromMenu(page, assistantMessages(page).first(), 'Listen');

  const said = await spokenText(page);
  expect(said).toContain('smaller than the songs promised');
  expect(said).not.toContain('*');
});

test('the one menu carries the switch, and says which way it is set', async ({ page, app }) => {
  await app.open();

  await openMenu(page);
  const item = page.getByRole('menuitem', { name: /Read replies aloud/ });
  // Off, and saying nothing about itself beyond its own name.
  await expect(item).toHaveText('Read replies aloud');
  await item.click();

  await openMenu(page);
  await expect(page.getByRole('menuitem', { name: /Read replies aloud/ })).toHaveText(
    '✓ Read replies aloud',
  );
  await page.keyboard.press('Escape');
});

test('with it on, the reply that lands is read without being asked for', async ({ page, app }) => {
  await app.open();

  await openMenu(page);
  await page.getByRole('menuitem', { name: /Read replies aloud/ }).click();
  await clearSpeech(page);

  await send(page, 'Two lines, please.');
  await waitForTurn(page);

  await expect.poll(() => spokenText(page)).toContain('smaller than the songs promised');
});

test('switching it off silences what is already being read', async ({ page, app }) => {
  // On before the app starts, the way a phone finds it: `settings.json` is the
  // same file on every device that has scanned the code.
  await app.open({ readAloud: true });

  await send(page, 'Two lines, please.');
  await waitForTurn(page);
  await expect.poll(() => spoken(page).then((pieces) => pieces.length)).toBeGreaterThan(0);

  // Being read: the message offers to stop rather than to start.
  const message = assistantMessages(page).first();
  await message.getByRole('button', { name: 'Message actions' }).click();
  await expect(page.getByRole('menuitem', { name: 'Stop reading' })).toBeVisible();
  await page.keyboard.press('Escape');

  await openMenu(page);
  await page.getByRole('menuitem', { name: /Read replies aloud/ }).click();

  await message.getByRole('button', { name: 'Message actions' }).click();
  await expect(page.getByRole('menuitem', { name: 'Listen' })).toBeVisible();
});
