import { expect, test } from '../fixtures';
import { assistantMessages, composer, fillProse, messages, waitForTurn } from '../helpers';

/**
 * The box, with a phone keyboard in front of it.
 *
 * Two things change, and neither is about width. A phone's Return key has no
 * Shift beside it, so Enter cannot mean "send" without costing the writer
 * every new line they wanted; and a key pressed with nothing focused cannot
 * happen at all, because the keyboard is only on screen once something has the
 * focus.
 */

test('Enter makes a new line, and Send is what sends', async ({ page, app }) => {
  await app.open();

  const box = composer(page);
  await box.focus();
  await box.pressSequentially('She climbs the stairs.');
  await box.press('Enter');
  await box.pressSequentially('The lamp is already lit.');

  // Nothing has been sent, and both lines are still in the box.
  await expect(messages(page)).toHaveCount(0);
  await expect(box).toContainText('She climbs the stairs.');
  await expect(box).toContainText('The lamp is already lit.');

  await page.getByRole('button', { name: 'Send', exact: true }).click();
  await waitForTurn(page);
  await expect(assistantMessages(page)).toHaveCount(1);
});

test('the author’s field takes Enter the same way', async ({ page, app }) => {
  await app.open();

  await page.getByRole('button', { name: 'Author' }).click();
  const direction = page.locator('li-composer .direction textarea');
  await direction.fill('Keep him from mentioning the lamp.');
  await direction.press('Enter');

  await expect(messages(page)).toHaveCount(0);
  await expect(direction).toHaveValue(/\n$/);
});

test('a key arriving with nothing focused is not put in the box', async ({ page, app }) => {
  await app.open();

  await page.locator('body').tap({ position: { x: 4, y: 4 } });
  await page.keyboard.press('S');

  // On a desktop this is the shortcut that saves a writer going to find the
  // box. Here there is no keyboard until the box has the focus, so a keystroke
  // that arrived without one came from somewhere the composer cannot reason
  // about, and it is left alone.
  await expect(composer(page)).toHaveText('');
});

test('the box is on screen with the keyboard up, and grows without leaving', async ({
  page,
  app,
}) => {
  await app.open();

  await fillProse(composer(page), Array.from({ length: 8 }, (_, i) => `line ${i + 1}`).join('\n'));

  const onScreen = await page.locator('li-composer .box').evaluate((el) => {
    const port = el.closest('.page')!.getBoundingClientRect();
    const own = el.getBoundingClientRect();
    return own.bottom > port.top && own.top < port.bottom;
  });
  expect(onScreen).toBe(true);
});
