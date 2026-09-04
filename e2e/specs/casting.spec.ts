import { Locator, Page } from '@playwright/test';
import { expect, test } from './fixtures';
import {
  CHAPTER_ID,
  captureRequests,
  notesOf,
  openPromptPreview,
  seedConnectedSettings,
  seedDeveloperMode,
  seedStory,
  send,
  systemOf,
  waitForTurn,
} from './helpers';

/**
 * Role-play with a cast: the ensemble the app has always sent, and the one
 * character at a time it can send instead.
 */

const SCENE = 'The lantern room, an hour before dusk. Rain on the seaward glass.';

const CAST = [
  { id: 'nell', name: 'Nell', description: 'Kept the light with Tomas.', enabled: true },
  { id: 'tomas', name: 'Tomas', description: 'The keeper before her father.', enabled: true },
  { id: 'isa', name: 'Isa', description: 'The harbourmaster’s daughter.', enabled: true },
];

function panel(page: Page): Locator {
  return page.locator('ms-chapter-panel');
}

function cast(page: Page): Locator {
  return panel(page).locator('[data-section="cast"]');
}

async function openPanel(page: Page): Promise<void> {
  await page.getByRole('button', { name: 'Open the chapter panel' }).click();
  await expect(panel(page).getByRole('button', { name: 'Close the chapter panel' })).toBeVisible();
}

test('an ensemble is played by everyone, and there is nobody to switch to', async ({
  page,
  server,
}) => {
  await seedConnectedSettings(server);
  // No `roleplay` in the document at all: a story from before casting existed.
  await seedStory(server, { scene: SCENE, mode: 'roleplay', characters: CAST });
  const bodies = await captureRequests(page);
  await page.goto(server.url);

  await send(page, 'I climb the stairs.');
  await waitForTurn(page);

  expect(systemOf(bodies[0])).toContain('You are playing Nell, Tomas and Isa.');
  expect(notesOf(bodies[0])).toEqual([]);

  // Nothing to be switched to, so a row is a row rather than a choice.
  await openPanel(page);
  await expect(cast(page).getByRole('button', { name: /^Play / })).toHaveCount(0);
  await expect(cast(page)).toContainText('3 characters');
});

test('one at a time: the model is told who it is, and who it may only watch', async ({
  page,
  server,
}) => {
  await seedConnectedSettings(server);
  await seedStory(server, {
    scene: SCENE,
    mode: 'roleplay',
    characters: CAST,
    persona: { name: 'Mara', description: 'a marine biologist' },
    roleplay: { casting: 'one-at-a-time', activeCharacterId: 'nell' },
  });
  const bodies = await captureRequests(page);
  await page.goto(server.url);

  await send(page, 'I climb the stairs.');
  await waitForTurn(page);

  const system = systemOf(bodies[0]);
  expect(system).toContain('You are playing Nell, and nobody else.');
  expect(system).toContain('Also in the scene: Tomas and Isa.');
  expect(system).toContain('never write words, thoughts or actions for Mara, Tomas or Isa');
});

test('switching mid-chapter is told to the model, and the next answer is signed', async ({
  page,
  server,
}) => {
  await seedConnectedSettings(server);
  await seedDeveloperMode(server);
  await seedStory(server, {
    scene: SCENE,
    mode: 'roleplay',
    characters: CAST,
    roleplay: { casting: 'one-at-a-time', activeCharacterId: 'nell' },
  });
  const bodies = await captureRequests(page);
  await page.goto(server.url);

  await send(page, 'I climb the stairs.');
  await waitForTurn(page);

  await openPanel(page);
  await cast(page).getByRole('button', { name: 'Play Tomas' }).click();
  await expect(cast(page)).toContainText('playing Tomas');

  // What the model will be told, where it will be told it.
  await openPromptPreview(page);
  await expect(page.getByRole('dialog').locator('.notes li')).toHaveText([
    'From here you play Tomas. Nell is no longer the character you play; ' +
      "everything above in Nell's voice was Nell, not you.",
  ]);
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog')).toBeHidden();

  await send(page, 'I try the latch.');
  await waitForTurn(page);

  // The note sits between the turns it happened between, and the history above
  // it is sent exactly as it was written.
  const sent = bodies[bodies.length - 1]['messages'] as { role: string; content: string }[];
  expect(sent.map((m) => m.role)).toEqual(['system', 'user', 'assistant', 'system', 'user']);
  expect(sent[3].content).toContain('From here you play Tomas.');

  // And the answer that came back is Tomas's.
  await expect
    .poll(async () => {
      const chapter = await server.document('chapters', CHAPTER_ID);
      const messages = (chapter?.['messages'] ?? []) as Record<string, unknown>[];
      return messages[messages.length - 1]?.['speakerId'];
    })
    .toBe('tomas');
});

test('a character leaves the scene and comes back, and both are in the prompt', async ({
  page,
  server,
}) => {
  await seedConnectedSettings(server);
  await seedStory(server, {
    scene: SCENE,
    mode: 'roleplay',
    characters: CAST,
    roleplay: { casting: 'one-at-a-time', activeCharacterId: 'nell' },
  });
  const bodies = await captureRequests(page);
  await page.goto(server.url);

  await send(page, 'I climb the stairs.');
  await waitForTurn(page);

  await openPanel(page);
  const isa = cast(page).getByRole('switch', { name: 'Isa is in the scene' });
  await isa.click();
  await expect(isa).toHaveAttribute('aria-checked', 'false');

  await send(page, 'I look around.');
  await waitForTurn(page);
  expect(notesOf(bodies[bodies.length - 1])).toEqual(['Isa has left the scene.']);
  // Out of the scene, she is not in the preamble either.
  expect(systemOf(bodies[bodies.length - 1])).toContain('Also in the scene: Tomas.');

  await isa.click();
  await expect(isa).toHaveAttribute('aria-checked', 'true');

  await send(page, 'The door opens.');
  await waitForTurn(page);
  expect(notesOf(bodies[bodies.length - 1])).toEqual([
    'Isa has left the scene.',
    'Isa joins the scene.',
  ]);
});

test('changing your mind before writing anything leaves no record of it', async ({
  page,
  server,
}) => {
  await seedConnectedSettings(server);
  await seedStory(server, {
    scene: SCENE,
    mode: 'roleplay',
    characters: CAST,
    roleplay: { casting: 'one-at-a-time', activeCharacterId: 'nell' },
  });
  const bodies = await captureRequests(page);
  await page.goto(server.url);

  await send(page, 'I climb the stairs.');
  await waitForTurn(page);

  // Two changes with nothing written between them are one change, and one that
  // ends where it started is no change at all.
  await openPanel(page);
  await cast(page).getByRole('button', { name: 'Play Tomas' }).click();
  await cast(page).getByRole('button', { name: 'Play Nell' }).click();
  await expect(cast(page)).toContainText('playing Nell');

  await send(page, 'I say nothing.');
  await waitForTurn(page);
  expect(notesOf(bodies[bodies.length - 1])).toEqual([]);
});

test('a chapter written before any of this reads exactly as it did', async ({ page, server }) => {
  await seedConnectedSettings(server);
  await seedStory(server, { scene: SCENE, mode: 'roleplay', characters: CAST });
  // Messages as 0.1.0 wrote them: no kind, no speaker, nothing else.
  const chapter = (await server.document('chapters', CHAPTER_ID))!;
  await server.seed({
    [`chapter:${CHAPTER_ID}`]: {
      ...chapter,
      messages: [
        {
          id: 'm1',
          role: 'user',
          content: 'I climb the stairs.',
          createdAt: '2026-01-01T00:00:00.000Z',
        },
        {
          id: 'm2',
          role: 'assistant',
          content: 'Nobody answers.',
          createdAt: '2026-01-01T00:00:01.000Z',
        },
      ],
    },
  });
  await page.goto(server.url);

  await expect(page.locator('article[data-role]')).toHaveCount(2);
  await expect(page.locator('article[data-role="assistant"]')).toContainText('Nobody answers.');
});
