import { expect, test } from './fixtures';
import {
  captureRequests,
  composer,
  expectComposerHidden,
  SCENE,
  send,
  systemOf,
  waitForTurn,
} from './helpers';

/** The sheet that opens a chapter, and everything that hangs off it. */

test('a chapter cannot be written into until its scene is written', async ({ page, app }) => {
  await app.open({ scene: '' });

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

test('escaping the sheet keeps whatever was written', async ({ page, app }) => {
  await app.open({ scene: '' });

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
  app,
}) => {
  await app.seed({ scene: `${SCENE}\n\nNobody answers.` });
  const bodies = await captureRequests(page);
  await app.visit();

  await send(page, 'I walk up to the door.');
  await waitForTurn(page);

  const system = systemOf(bodies[0]);
  expect(system).toContain('Chapter 1. The scene:');
  expect(system).toContain(`${SCENE}\n\nNobody answers.`);
  // Untitled chapters are known by the scene's opening line.
  await expect(page.getByRole('button', { name: /Chapter 1 — The keeper/ })).toBeVisible();
});
