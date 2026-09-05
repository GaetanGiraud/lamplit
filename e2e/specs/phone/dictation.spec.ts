import type { CDPSession } from '@playwright/test';
import { expect, test } from '../fixtures';
import { assistantMessages, composer, userMessages, waitForTurn } from '../helpers';

/**
 * Dictating into the composer, which the app does not implement and never
 * will.
 *
 * The Web Speech API's recogniser only runs in a secure context, and Lamplit
 * is served over plain HTTP from an address on your own network — a phone
 * would refuse it with `not-allowed`, and the way out of that is a domain
 * name, DNS and a certificate a phone will trust, for a server that lives
 * inside a desktop app. So the microphone key on the phone's own keyboard is
 * the answer, and what is under test here is that the editor behaves under it.
 *
 * A keyboard dictating does not type. It opens a **composition** — a run of
 * text it owns and rewrites as the words are recognised — and commits it at
 * the end. That is the same mechanism every IME uses, so this is also the
 * check that Lamplit can be written in any language that needs one.
 *
 * Driven through the browser's own input protocol rather than through
 * synthesised events, because `compositionstart`/`update`/`end` dispatched by
 * hand are not composition: the browser has to believe it owns the text, which
 * is the whole of what the editor has to survive.
 */

/** One dictated phrase: recognised in stages, then committed. */
async function dictate(cdp: CDPSession, stages: string[], committed: string): Promise<void> {
  for (const text of stages) {
    await cdp.send('Input.imeSetComposition', {
      text,
      selectionStart: text.length,
      selectionEnd: text.length,
    });
  }
  await cdp.send('Input.insertText', { text: committed });
}

test('dictated words arrive once each, in the order they were said', async ({ page, app }) => {
  await app.open();
  const cdp = await page.context().newCDPSession(page);
  const box = composer(page);
  await box.focus();

  await dictate(
    cdp,
    ['She climbs', 'She climbs the', 'She climbs the stairs'],
    'She climbs the stairs.',
  );

  // Not "She climbs She climbs the stairs.", and not half of it: the editor
  // re-marks its speech after every change, and doing that inside a
  // composition is what doubles or eats a word.
  await expect(box).toHaveText('She climbs the stairs.');
});

test('speech dictated with its quotation marks is coloured once it is committed', async ({
  page,
  app,
}) => {
  await app.open();
  const cdp = await page.context().newCDPSession(page);
  const box = composer(page);
  await box.focus();

  await dictate(cdp, ['"Not today', '"Not today,"'], '"Not today," she said.');

  // The mark that could not be applied during the composition is applied after
  // it, so what was dictated is coloured exactly as what was typed would be.
  await expect(box.locator('.speech')).toHaveText('"Not today,"');
  await expect(box).toHaveText('"Not today," she said.');
});

test('a dictated line sends, and is the line that was spoken', async ({ page, app }) => {
  await app.open();
  const cdp = await page.context().newCDPSession(page);
  await composer(page).focus();

  await dictate(cdp, ['I take the key', 'I take the key off'], 'I take the key off the hook.');
  await page.getByRole('button', { name: 'Send', exact: true }).click();
  await waitForTurn(page);

  await expect(userMessages(page).first()).toContainText('I take the key off the hook.');
  await expect(assistantMessages(page)).toHaveCount(1);
  // And the box is empty afterwards, as it is after any other send.
  await expect(composer(page)).toHaveText('');
});

test('a second phrase is added to the first rather than over it', async ({ page, app }) => {
  await app.open();
  const cdp = await page.context().newCDPSession(page);
  const box = composer(page);
  await box.focus();

  await dictate(cdp, ['She waits'], 'She waits. ');
  await dictate(cdp, ['The lamp'], 'The lamp is already lit.');

  await expect(box).toHaveText('She waits. The lamp is already lit.');
});

/** The `[AUTHOR]` split is the one thing that answers a change by rewriting it. */
test('dictating the author tag still splits the message in two', async ({ page, app }) => {
  await app.open();
  const cdp = await page.context().newCDPSession(page);
  await composer(page).focus();

  await dictate(cdp, ['[AUTHOR] Keep him'], '[AUTHOR] Keep him from mentioning the lamp.');

  await expect(page.locator('li-composer .direction textarea')).toHaveValue(
    'Keep him from mentioning the lamp.',
  );
  await expect(composer(page)).toHaveText('');
});
