import type { Locator } from '@playwright/test';
import { expect, test } from './fixtures';
import {
  FAKE_MODEL,
  act,
  actFromMenu,
  assistantMessages,
  composer,
  messages,
  seedConnectedSettings,
  seedDeveloperMode,
  seedStory,
  send,
  setBookStyle,
  userMessages,
  waitForSaved,
  waitForTurn,
} from './helpers';

const SCENE = 'The keeper’s cottage, late afternoon, low tide. The door is unlatched.';

test.describe('writing a chapter', () => {
  test.beforeEach(async ({ page, server }) => {
    await seedConnectedSettings(server);
    await seedStory(server, { scene: SCENE });
    await page.goto(server.url);
  });

  test('streams an answer, styles speech and reports tokens', async ({ page, server }) => {
    await send(page, 'Two lines between a knight and a dragon.');

    const answer = assistantMessages(page).first();
    // Text arrives before the turn ends, which is the point of streaming.
    await expect(answer).toContainText('knight', { timeout: 15_000 });
    await waitForTurn(page);

    await expect(answer.locator('.speech').first()).toContainText('smaller than the songs');
    await expect(answer.locator('.action').first()).toBeVisible();
    await expect(answer.locator('footer')).toContainText(FAKE_MODEL);
    await expect(answer.locator('footer')).toContainText('out');
  });

  test('book style gives each spoken line its own paragraph', async ({ page, server }) => {
    await send(page, 'A scene, please.');
    await waitForTurn(page);

    const answer = assistantMessages(page).first();
    const spokenParagraphs = answer.locator('p:has(> span.speech)');
    await expect(spokenParagraphs).toHaveCount(2);
    // Each spoken paragraph starts with the quote, nothing before it.
    for (const paragraph of await spokenParagraphs.all()) {
      expect((await paragraph.innerText()).trim().startsWith('"')).toBe(true);
    }
  });

  test('the book style switch splits and rejoins a single-paragraph answer', async ({
    page,
    server,
  }) => {
    // `!prose` answers in one paragraph, the only shape the switch can change.
    await send(page, '!prose all in one paragraph');
    await waitForTurn(page);

    const paragraphs = assistantMessages(page).first().locator('.story-prose > p');
    await expect(paragraphs).toHaveCount(3);

    await setBookStyle(page, false);
    await expect(paragraphs).toHaveCount(1);
    await expect(paragraphs.first()).toContainText('You are smaller than the songs');

    await setBookStyle(page, true);
    await expect(paragraphs).toHaveCount(3);
  });

  test('stop keeps the partial answer and marks it', async ({ page, server }) => {
    await send(page, '!slow tell me slowly');

    const answer = assistantMessages(page).first();
    await expect(answer).toContainText('knight', { timeout: 15_000 });
    await page.getByRole('button', { name: 'Stop' }).click();
    await waitForTurn(page);

    await expect(answer.locator('.story-prose')).not.toBeEmpty();
    await expect(answer.locator('footer')).toContainText('stopped');
  });

  test('editing a user message and replaying re-asks from there', async ({ page, server }) => {
    await send(page, 'First attempt.');
    await waitForTurn(page);
    const firstAnswer = await assistantMessages(page).first().innerText();

    const userMessage = userMessages(page).first();
    await act(userMessage, 'Edit');
    await userMessage.locator('textarea').fill('Second attempt.');
    await userMessage.getByRole('button', { name: 'Save' }).click();
    await expect(userMessage).toContainText('Second attempt.');

    await act(userMessages(page).first(), 'Replay from here');
    await waitForTurn(page);

    await expect(messages(page)).toHaveCount(2);
    await expect(userMessages(page).first()).toContainText('Second attempt.');
    expect(await assistantMessages(page).first().innerText()).not.toBe(firstAnswer);
  });

  test('regenerate replaces the answer in place', async ({ page, server }) => {
    await send(page, 'Once more.');
    await waitForTurn(page);
    const first = await assistantMessages(page).first().innerText();

    await act(assistantMessages(page).first(), 'Regenerate');
    await waitForTurn(page);

    await expect(assistantMessages(page)).toHaveCount(1);
    expect(await assistantMessages(page).first().innerText()).not.toBe(first);
  });

  test('deleting a message removes just that message', async ({ page, server }) => {
    await send(page, 'A line to delete.');
    await waitForTurn(page);
    await expect(messages(page)).toHaveCount(2);

    await act(assistantMessages(page).first(), 'Delete');
    await expect(messages(page)).toHaveCount(1);
    await expect(userMessages(page)).toHaveCount(1);
  });

  test('a rejected key reads as a rejected key, and nothing crashes', async ({ page, server }) => {
    await send(page, '!401 this should fail');
    await waitForTurn(page);

    const answer = assistantMessages(page).first();
    await expect(answer.locator('.error')).toContainText('API key was rejected');
    await expect(answer.locator('.error')).toContainText('Incorrect API key provided');
    // The composer stays usable.
    await expect(composer(page)).toBeEnabled();
  });

  test('a provider error is reported with the provider’s own words', async ({ page, server }) => {
    await send(page, '!error break it');
    await waitForTurn(page);

    await expect(assistantMessages(page).first().locator('.error')).toContainText(
      'upstream model is on fire',
    );
  });

  test('the chapter and the connection survive a reload', async ({ page, server }) => {
    await send(page, 'Remember me.');
    await waitForTurn(page);
    const answer = await assistantMessages(page).first().innerText();
    await waitForSaved(server, 2);

    await page.reload();

    await expect(userMessages(page).first()).toContainText('Remember me.');
    expect(await assistantMessages(page).first().innerText()).toBe(answer);
    await expect(page.getByRole('button', { name: /Storyteller Large/ })).toBeVisible();
  });

  test('the composer grows with the text, without ever scrolling it', async ({ page, server }) => {
    const box = composer(page);
    await box.click();

    // The box is resized from change detection, so it grows on the frame after
    // the keystroke. Measuring two frames on gives it that frame and no more:
    // any later than that and the line being written is out of sight.
    const state = () =>
      box.evaluate(
        (el: HTMLTextAreaElement) =>
          new Promise<{ height: number; scrolling: boolean }>((settled) => {
            requestAnimationFrame(() =>
              requestAnimationFrame(() =>
                settled({
                  height: Math.round(el.getBoundingClientRect().height),
                  scrolling: el.scrollHeight > el.clientHeight + 4,
                }),
              ),
            );
          }),
      );

    const resting = await state();
    expect(resting.scrolling).toBe(false);

    for (let i = 0; i < 60; i++) {
      await page.keyboard.type('word ');
      expect((await state()).scrolling).toBe(false);
    }
    expect((await state()).height).toBeGreaterThan(resting.height);
  });

  /**
   * The whole point of the move: a reader crossing the page with the pointer
   * should never have a word taken away from them. Measured rather than looked
   * at, because "it looks fine on my screen" is how it got there in the first
   * place.
   */
  for (const width of [1280, 1440]) {
    test(`at ${width}px the message actions sit outside the text`, async ({ page }) => {
      await page.setViewportSize({ width, height: 800 });
      await send(page, 'Two lines, please.');
      await waitForTurn(page);

      const message = assistantMessages(page).first();
      await message.hover();

      const rail = message.locator('.rail');
      const prose = message.locator('.story-prose');
      await expect(rail).toBeVisible();

      /** How far the left edge of something is past the end of the text. */
      const clearance = async (what: Locator) => {
        const box = (await what.boundingBox())!;
        const text = (await prose.boundingBox())!;
        return Math.round(box.x - (text.x + text.width));
      };

      // The rail slides in over 120ms, so this is measured where it comes to
      // rest. Touching the column's edge is the point — the rail bridges the
      // gap so the pointer can reach it — but nothing of it is over a word.
      await expect.poll(() => clearance(rail)).toBeGreaterThanOrEqual(0);

      for (const name of ['Edit', 'Regenerate', 'Copy', 'Delete']) {
        expect(await clearance(message.getByRole('button', { name }))).toBeGreaterThan(0);
      }

      // And the ⋯ is not doubling up on it at this width.
      await expect(message.getByRole('button', { name: 'Message actions' })).toBeHidden();
    });
  }

  test('at 390px nothing is over the text and the ⋯ opens the actions', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 800 });
    await send(page, 'Two lines, please.');
    await waitForTurn(page);

    const message = assistantMessages(page).first();
    await message.hover();
    // No margin to write in, so the rail is not drawn at all.
    await expect(message.locator('.rail')).toBeHidden();

    await actFromMenu(page, message, 'Copy');
    // The menu closed on the action, which is all the app can promise about a
    // clipboard a headless browser may refuse.
    await expect(page.getByRole('menu')).toHaveCount(0);
  });

  test('the context pill reflects what will be sent', async ({ page, server }) => {
    // The pill is developer mode's; the beforeEach opened the app without it.
    await seedDeveloperMode(server);
    await page.reload();

    const pill = page.getByRole('button', { name: /^context/ });
    // The scene and the system blocks are in there before a word is typed.
    await expect(pill).toContainText('/ 16k');
    const before = await pill.innerText();

    await composer(page).fill('A sentence that costs a few tokens to send.');
    await expect(pill).not.toHaveText(before);
  });
});

test.describe('parameters', () => {
  // Seeded but not opened: one of these needs different settings on disk
  // before the app reads them, which is now the only moment it reads them.
  test.beforeEach(async ({ server }) => {
    await seedStory(server, { scene: SCENE });
  });

  test('advanced parameters are only sent once switched on', async ({ page, server }) => {
    await seedConnectedSettings(server);
    await page.goto(server.url);
    const bodies: Record<string, unknown>[] = [];
    await page.route('**/chat/completions', async (route) => {
      bodies.push(route.request().postDataJSON());
      await route.continue();
    });

    await send(page, 'First request.');
    await waitForTurn(page);
    expect(bodies[0]).not.toHaveProperty('top_k');
    expect(bodies[0]).toMatchObject({
      stream: true,
      max_tokens: 800,
      temperature: 0.9,
    });

    await page.getByRole('button', { name: 'Parameters' }).click();
    const dialog = page.getByRole('dialog');
    const advanced = dialog.getByRole('button', { name: /Advanced/ });
    await advanced.scrollIntoViewIfNeeded();
    await advanced.click();
    await dialog.locator('ms-param-row', { hasText: 'Top-k' }).getByRole('switch').click();
    await dialog.getByRole('button', { name: 'Done' }).click();

    await send(page, 'Second request.');
    await waitForTurn(page);
    expect(bodies[1]).toHaveProperty('top_k');
  });

  test('a tight context budget drops the oldest messages', async ({ page, server }) => {
    // The budget is on disk before the app opens, because that is the one
    // moment it is read.
    await seedConnectedSettings(server, 'test-key', {
      maxContextTokens: 1152,
      maxResponseTokens: 1024,
    });
    await page.goto(server.url);

    await send(page, '!long give me a long passage');
    await waitForTurn(page);

    await composer(page).fill('And now the next thing.');
    await expect(page.getByText(/older message[s]? left out/)).toBeVisible();
  });
});
