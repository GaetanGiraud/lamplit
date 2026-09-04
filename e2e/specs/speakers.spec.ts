import { Locator, Page } from '@playwright/test';
import { expect, test } from './fixtures';
import { CHAPTER_ID, seedConnectedSettings, seedStory, send, waitForTurn } from './helpers';
import type { PersistenceServer } from './persistence-server';

/**
 * Who is speaking on each message: the name as it was stored, in the speaker's
 * own colour, once per run of turns — and nothing at all where the page has no
 * name to put on a line.
 */

const SCENE = 'The lantern room, an hour before dusk. Rain on the seaward glass.';

const CAST = [
  { id: 'nell', name: 'Nell', description: 'Kept the light with Tomas.', enabled: true },
  { id: 'tomas', name: 'Tomas', description: 'The keeper before her father.', enabled: true },
];

const MARA = { name: 'Mara', description: 'A marine biologist, back after nine years.' };

/** The labels the page is showing, top to bottom. */
function speakers(page: Page): Locator {
  return page.locator('article[data-role] header.speaker');
}

/** What one of them is actually drawn in. */
async function inkOf(label: Locator): Promise<string> {
  return label.evaluate((node) => getComputedStyle(node).color);
}

let clock = 0;

function said(role: 'user' | 'assistant', content: string, speaker?: { id: string; name: string }) {
  const at = String(++clock).padStart(2, '0');
  return {
    id: `m${clock}`,
    role,
    content,
    // Padded: from the tenth message on, `00:00:010` is not a time at all, and
    // this counter runs across every test in the file.
    createdAt: `2026-01-01T00:00:${at}.000Z`,
    ...(speaker ? { speakerId: speaker.id, speakerName: speaker.name } : {}),
  };
}

/** Writes a chapter that has already been written in, as the app would have. */
async function seedMessages(
  server: PersistenceServer,
  messages: Record<string, unknown>[],
): Promise<void> {
  const chapter = (await server.document('chapters', CHAPTER_ID))!;
  await server.seed({ [`chapter:${CHAPTER_ID}`]: { ...chapter, messages } });
}

test('one at a time: each speaker is named, and a run of theirs is named once', async ({
  page,
  server,
}) => {
  await seedConnectedSettings(server);
  await seedStory(server, {
    scene: SCENE,
    mode: 'roleplay',
    characters: CAST,
    persona: MARA,
    roleplay: { casting: 'one-at-a-time', activeCharacterId: 'tomas' },
  });
  await seedMessages(server, [
    said('user', 'I climb the stairs.'),
    said('assistant', 'You took your time.', CAST[0]),
    said('assistant', 'She does not move from the glass.', CAST[0]),
    said('user', 'I put the lantern down.'),
    said('assistant', 'The old man on the stair says nothing.', CAST[1]),
  ]);
  await page.goto(server.url);

  await expect(page.locator('article[data-role]')).toHaveCount(5);
  // Five messages, four labels: Nell's second turn is Nell still talking.
  await expect(speakers(page)).toHaveText(['Mara', 'Nell', 'Mara', 'Tomas']);

  const [mara, nell, , tomas] = await speakers(page).all();
  const inks = await Promise.all([mara, nell, tomas].map(inkOf));
  expect(new Set(inks).size).toBe(3);
});

test('switching mid-chapter signs the next answer, and leaves the last one alone', async ({
  page,
  server,
}) => {
  await seedConnectedSettings(server);
  await seedStory(server, {
    scene: SCENE,
    mode: 'roleplay',
    characters: CAST,
    persona: MARA,
    roleplay: { casting: 'one-at-a-time', activeCharacterId: 'nell' },
  });
  await page.goto(server.url);

  await send(page, 'I climb the stairs.');
  await waitForTurn(page);
  await expect(speakers(page)).toHaveText(['Mara', 'Nell']);

  await page.getByRole('button', { name: 'Open the chapter panel' }).click();
  await page
    .locator('ms-chapter-panel [data-section="cast"]')
    .getByRole('button', { name: 'Play Tomas' })
    .click();

  await send(page, 'I try the latch.');
  await waitForTurn(page);
  await expect(speakers(page)).toHaveText(['Mara', 'Nell', 'Mara', 'Tomas']);

  // The name is written down with the answer, not worked out from the story.
  await expect
    .poll(async () => {
      const chapter = await server.document('chapters', CHAPTER_ID);
      const messages = (chapter?.['messages'] ?? []) as Record<string, unknown>[];
      return messages[messages.length - 1]?.['speakerName'];
    })
    .toBe('Tomas');
});

test('the narrator’s page carries no labels at all', async ({ page, server }) => {
  await seedConnectedSettings(server);
  await seedStory(server, { scene: SCENE, mode: 'narrator', characters: CAST, persona: MARA });
  await seedMessages(server, [
    said('user', 'I climb the stairs.'),
    // Written when the story was cast, and read back after switching to a
    // narrator: the page is the narrator's and the reader knows it.
    said('assistant', 'You took your time.', CAST[0]),
  ]);
  await page.goto(server.url);

  await expect(page.locator('article[data-role]')).toHaveCount(2);
  await expect(speakers(page)).toHaveCount(0);
});

test('a rename leaves what she already said in her old name', async ({ page, server }) => {
  await seedConnectedSettings(server);
  await seedStory(server, {
    scene: SCENE,
    mode: 'roleplay',
    characters: CAST,
    persona: MARA,
    roleplay: { casting: 'one-at-a-time', activeCharacterId: 'nell' },
  });
  await seedMessages(server, [
    said('user', 'I climb the stairs.'),
    said('assistant', 'You took your time.', CAST[0]),
  ]);
  await page.goto(server.url);

  const sheet = page.getByRole('dialog');
  await page.getByRole('button', { name: 'Story', exact: true }).click();
  const name = sheet.locator('[data-character="nell"]').getByLabel('Name');
  await name.fill('Anna');
  // The field commits on leaving it, the way every other field in the app does.
  await name.blur();
  await page.keyboard.press('Escape');
  await expect(sheet).toBeHidden();

  await expect(speakers(page)).toHaveText(['Mara', 'Nell']);

  await send(page, 'I ask her name.');
  await waitForTurn(page);
  await expect(speakers(page)).toHaveText(['Mara', 'Nell', 'Mara', 'Anna']);
});

test('a character who has been deleted is still named, quietly', async ({ page, server }) => {
  await seedConnectedSettings(server);
  await seedStory(server, {
    scene: SCENE,
    mode: 'roleplay',
    characters: CAST,
    persona: MARA,
    roleplay: { casting: 'one-at-a-time', activeCharacterId: 'nell' },
  });
  await seedMessages(server, [
    said('user', 'I climb the stairs.'),
    said('assistant', 'You took your time.', CAST[0]),
  ]);
  await page.goto(server.url);

  const nellsInk = await inkOf(speakers(page).nth(1));
  const readersInk = await inkOf(speakers(page).first());
  expect(nellsInk).not.toBe(readersInk);

  const sheet = page.getByRole('dialog');
  await page.getByRole('button', { name: 'Story', exact: true }).click();
  await sheet.locator('[data-character="nell"]').getByRole('button', { name: 'Remove' }).click();
  await page.keyboard.press('Escape');
  await expect(sheet).toBeHidden();

  // Her name stays on what she said; her colour went with her.
  await expect(speakers(page)).toHaveText(['Mara', 'Nell']);
  expect(await inkOf(speakers(page).nth(1))).toBe(readersInk);
});
