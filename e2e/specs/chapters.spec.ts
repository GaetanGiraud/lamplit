import { expect, test } from '@playwright/test';
import {
  FAKE_MODEL,
  act,
  assistantMessages,
  composer,
  messages,
  seedConnectedSettings,
  seedStory,
  send,
  setBookStyle,
  userMessages,
  waitForTurn,
} from './helpers';

const SCENE = 'The keeper’s cottage, late afternoon, low tide. The door is unlatched.';

test.describe('writing a chapter', () => {
  test.beforeEach(async ({ page }) => {
    await seedConnectedSettings(page);
    await seedStory(page, { scene: SCENE });
    await page.goto('/');
  });

  test('streams an answer, styles speech and reports tokens', async ({ page }) => {
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

  test('book style gives each spoken line its own paragraph', async ({ page }) => {
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

  test('the book style switch splits and rejoins a single-paragraph answer', async ({ page }) => {
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

  test('stop keeps the partial answer and marks it', async ({ page }) => {
    await send(page, '!slow tell me slowly');

    const answer = assistantMessages(page).first();
    await expect(answer).toContainText('knight', { timeout: 15_000 });
    await page.getByRole('button', { name: 'Stop' }).click();
    await waitForTurn(page);

    await expect(answer.locator('.story-prose')).not.toBeEmpty();
    await expect(answer.locator('footer')).toContainText('stopped');
  });

  test('editing a user message and replaying re-asks from there', async ({ page }) => {
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

  test('regenerate replaces the answer in place', async ({ page }) => {
    await send(page, 'Once more.');
    await waitForTurn(page);
    const first = await assistantMessages(page).first().innerText();

    await act(assistantMessages(page).first(), 'Regenerate');
    await waitForTurn(page);

    await expect(assistantMessages(page)).toHaveCount(1);
    expect(await assistantMessages(page).first().innerText()).not.toBe(first);
  });

  test('deleting a message removes just that message', async ({ page }) => {
    await send(page, 'A line to delete.');
    await waitForTurn(page);
    await expect(messages(page)).toHaveCount(2);

    await act(assistantMessages(page).first(), 'Delete');
    await expect(messages(page)).toHaveCount(1);
    await expect(userMessages(page)).toHaveCount(1);
  });

  test('a rejected key reads as a rejected key, and nothing crashes', async ({ page }) => {
    await send(page, '!401 this should fail');
    await waitForTurn(page);

    const answer = assistantMessages(page).first();
    await expect(answer.locator('.error')).toContainText('API key was rejected');
    await expect(answer.locator('.error')).toContainText('Incorrect API key provided');
    // The composer stays usable.
    await expect(composer(page)).toBeEnabled();
  });

  test('a provider error is reported with the provider’s own words', async ({ page }) => {
    await send(page, '!error break it');
    await waitForTurn(page);

    await expect(assistantMessages(page).first().locator('.error')).toContainText(
      'upstream model is on fire',
    );
  });

  test('the chapter and the connection survive a reload', async ({ page }) => {
    await send(page, 'Remember me.');
    await waitForTurn(page);
    const answer = await assistantMessages(page).first().innerText();

    await page.reload();

    await expect(userMessages(page).first()).toContainText('Remember me.');
    expect(await assistantMessages(page).first().innerText()).toBe(answer);
    await expect(page.getByRole('button', { name: /Storyteller Large/ })).toBeVisible();
  });

  test('the composer grows with the text, without ever scrolling it', async ({ page }) => {
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

  test('the context pill reflects what will be sent', async ({ page }) => {
    const pill = page.getByRole('button', { name: /^context/ });
    // The scene and the system blocks are in there before a word is typed.
    await expect(pill).toContainText('/ 16k');
    const before = await pill.innerText();

    await composer(page).fill('A sentence that costs a few tokens to send.');
    await expect(pill).not.toHaveText(before);
  });
});

test.describe('parameters', () => {
  test.beforeEach(async ({ page }) => {
    await seedConnectedSettings(page);
    await seedStory(page, { scene: SCENE });
    await page.goto('/');
  });

  test('advanced parameters are only sent once switched on', async ({ page }) => {
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

  test('a tight context budget drops the oldest messages', async ({ page }) => {
    await page.addInitScript(() => {
      const key = 'magicstories:settings';
      const raw = window.localStorage.getItem(key);
      if (!raw) return;
      const settings = JSON.parse(raw);
      settings.generation.maxContextTokens = 1152;
      settings.generation.maxResponseTokens = 1024;
      window.localStorage.setItem(key, JSON.stringify(settings));
    });
    await page.reload();

    await send(page, '!long give me a long passage');
    await waitForTurn(page);

    await composer(page).fill('And now the next thing.');
    await expect(page.getByText(/older message[s]? left out/)).toBeVisible();
  });
});
