import { describe, expect, it } from 'vitest';
import {
  DEFAULT_GENERATION,
  DEFAULT_NARRATOR_PROMPT,
  DEFAULT_SUMMARY_INSTRUCTION,
} from './defaults';
import { Chapter, ChapterMessage, LoreEntry, Story } from './models';
import {
  buildPrompt,
  buildSummaryPrompt,
  chapterTitle,
  firstLine,
  summaryInstruction,
} from './prompt-builder';
import { heuristicEstimator } from './tokens';
import { newChapter, newStory } from '../store/documents';

function story(patch: Partial<Story> = {}): Story {
  return { ...newStory('The Lighthouse'), ...patch };
}

function chapter(patch: Partial<Chapter> = {}): Chapter {
  return { ...newChapter('story', 1, 'The keeper’s cottage, late afternoon, low tide.'), ...patch };
}

function said(role: 'user' | 'assistant', content: string): ChapterMessage {
  return { id: `${role}-${content.length}-${Math.random()}`, role, content, createdAt: '' };
}

function lore(patch: Partial<LoreEntry> = {}): LoreEntry {
  return {
    id: `lore-${patch.title ?? 'x'}`,
    title: 'Old Tomas',
    category: 'person',
    keys: ['tomas', 'keeper'],
    content: 'The lighthouse keeper, missing since spring.',
    enabled: true,
    alwaysOn: false,
    ...patch,
  };
}

function build(input: { story?: Story; chapter?: Chapter; draft?: string }) {
  return buildPrompt({
    story: input.story ?? story(),
    chapter: input.chapter ?? chapter(),
    draft: input.draft,
    params: DEFAULT_GENERATION,
    estimator: heuristicEstimator,
  });
}

describe('buildPrompt: the system message', () => {
  it('puts the blocks in order and ends with the scene and the style rules', () => {
    const built = build({});
    expect(built.blocks.map((b) => b.id)).toEqual(['mode', 'scene', 'style']);
    expect(built.messages[0].role).toBe('system');
    expect(built.messages[0].content).toContain(DEFAULT_NARRATOR_PROMPT);
  });

  it('injects the scene verbatim, under its chapter heading', () => {
    const scene = 'The lantern room, an hour later.\n\nThe lamp is out and the door is open.';
    const built = build({ chapter: chapter({ number: 3, title: 'Aloft', scene }) });
    const block = built.blocks.find((b) => b.id === 'scene');
    expect(block?.content).toBe(`Chapter 3, Aloft. The scene:\n${scene}`);
    expect(built.messages[0].content).toContain(scene);
  });

  it('leaves the scene block out while the scene is empty', () => {
    const built = build({ chapter: chapter({ scene: '   ' }) });
    expect(built.blocks.some((b) => b.id === 'scene')).toBe(false);
  });

  it('carries the persona and the story so far when they are set', () => {
    const base = story();
    const built = build({
      story: {
        ...base,
        persona: { name: 'Mara', description: 'a marine biologist' },
        world: { ...base.world, storySoFar: 'Mara has just arrived on the island.' },
      },
    });
    expect(built.blocks.map((b) => b.id)).toEqual([
      'mode',
      'persona',
      'story-so-far',
      'scene',
      'style',
    ]);
    expect(built.messages[0].content).toContain('The user plays Mara: a marine biologist');
    expect(built.messages[0].content).toContain('Mara has just arrived on the island.');
  });

  it('switches the preamble with the mode, and names the cast', () => {
    const base = story();
    const built = build({
      story: {
        ...base,
        mode: 'roleplay',
        persona: { name: 'Mara', description: '' },
        characters: [
          {
            id: 'a',
            name: 'Tomas',
            description: 'The keeper, seventy, deaf on one side.',
            enabled: true,
          },
          { id: 'b', name: 'Ghost', description: 'Not in this chapter.', enabled: false },
        ],
      },
    });
    const system = built.messages[0].content;
    expect(system).toContain('You are playing Tomas.');
    expect(system).toContain('deaf on one side');
    expect(system).not.toContain('Ghost');
    expect(system).toContain('never write words, thoughts or actions for Mara');
    expect(system).not.toContain(DEFAULT_NARRATOR_PROMPT);
  });

  it('uses the writer’s own narrator instructions once overridden', () => {
    const built = build({
      story: story({ narrator: { useDefault: false, prompt: 'Write it as a police report.' } }),
    });
    expect(built.messages[0].content).toContain('Write it as a police report.');
    expect(built.messages[0].content).not.toContain(DEFAULT_NARRATOR_PROMPT);
  });
});

describe('buildPrompt: lore', () => {
  const withEntries = (entries: LoreEntry[], depth?: number) => {
    const base = story();
    const scan = depth === undefined ? base.world.scan : { ...base.world.scan, depth };
    return { ...base, world: { ...base.world, entries, scan } };
  };

  it('fires on a key found in the scene, before anything has been written', () => {
    const built = build({ story: withEntries([lore()]) });
    expect(built.lore).toHaveLength(1);
    expect(built.lore[0]).toMatchObject({ key: 'keeper', where: 'scene' });
    expect(built.messages[0].content).toContain('missing since spring');
  });

  it('leaves an entry out when nothing mentions it', () => {
    const built = build({
      story: withEntries([lore({ title: 'The Lantern Room', keys: ['lantern', 'lamp room'] })]),
    });
    expect(built.lore).toHaveLength(0);
  });

  it('fires on the draft, and on the last messages within the scan depth', () => {
    const entries = [lore({ title: 'The Lantern Room', keys: ['lantern'] })];
    const draft = build({ story: withEntries(entries), draft: 'I climb to the lantern.' });
    expect(draft.lore[0]).toMatchObject({ where: 'draft', key: 'lantern' });

    const recent = build({
      story: withEntries(entries),
      chapter: chapter({ messages: [said('assistant', 'The lantern turned.')] }),
    });
    expect(recent.lore[0]?.where).toBe('message');

    const old = build({
      story: withEntries(entries, 1),
      chapter: chapter({
        messages: [said('assistant', 'The lantern turned.'), said('user', 'I go back down.')],
      }),
    });
    expect(old.lore).toHaveLength(0);
  });

  it('never fires an entry with nothing written in it', () => {
    // "What is true" is required in the World modal for exactly this reason:
    // an entry is the sentence it contributes, and this one has none.
    expect(build({ story: withEntries([lore({ content: '   ' })]) }).lore).toHaveLength(0);
    expect(
      build({ story: withEntries([lore({ content: '', alwaysOn: true })]) }).lore,
    ).toHaveLength(0);
  });

  it('honours always-on, disabled, whole words and case sensitivity', () => {
    const always = build({
      story: withEntries([lore({ keys: ['nothing-matches'], alwaysOn: true })]),
    });
    expect(always.lore[0]).toMatchObject({ where: 'always on', key: '' });

    const off = build({ story: withEntries([lore({ enabled: false })]) });
    expect(off.lore).toHaveLength(0);

    const partial = build({
      story: withEntries([lore({ keys: ['keep'], matchWholeWords: true })]),
    });
    expect(partial.lore).toHaveLength(0);

    const cased = build({
      story: withEntries([lore({ keys: ['Keeper'], caseSensitive: true })]),
    });
    expect(cased.lore).toHaveLength(0);
  });
});

describe('buildPrompt: the budget', () => {
  const params = { ...DEFAULT_GENERATION, maxContextTokens: 1200, maxResponseTokens: 800 };

  it('drops the oldest messages first and reports how many went', () => {
    const messages = Array.from({ length: 12 }, (_, i) =>
      said('user', `Message ${i}. `.repeat(20)),
    );
    const built = buildPrompt({
      story: story(),
      chapter: chapter({ messages }),
      params,
      estimator: heuristicEstimator,
    });
    const sent = built.messages.filter((m) => m.role !== 'system');
    expect(sent.length).toBeLessThan(messages.length);
    expect(built.dropped).toBe(messages.length - sent.length);
    // What survives is the end of the conversation, not the start.
    expect(sent[sent.length - 1].content).toContain('Message 11');
  });

  it('always keeps the message being sent, however tight the budget', () => {
    const built = buildPrompt({
      story: story(),
      chapter: chapter({ messages: [said('user', 'x'.repeat(4000))] }),
      draft: 'And now this.',
      params: { ...params, maxContextTokens: 1024 },
      estimator: heuristicEstimator,
    });
    const last = built.messages[built.messages.length - 1];
    expect(last).toEqual({ role: 'user', content: 'And now this.' });
    expect(built.dropped).toBe(1);
  });

  it('skips failed turns and empty placeholders', () => {
    const built = build({
      chapter: chapter({
        messages: [
          said('user', 'Hello.'),
          { ...said('assistant', ''), meta: { error: 'Rate limited' } },
        ],
      }),
    });
    expect(built.messages.filter((m) => m.role === 'assistant')).toHaveLength(0);
    expect(built.dropped).toBe(0);
  });
});

describe('chapter titles', () => {
  it('falls back to the scene’s first line, trimmed', () => {
    expect(chapterTitle({ title: 'Aloft', scene: 'anything' })).toBe('Aloft');
    expect(chapterTitle({ title: '  ', scene: 'The lantern room.\nAn hour later.' })).toBe(
      'The lantern room.',
    );
    expect(firstLine('x'.repeat(200)).endsWith('…')).toBe(true);
  });
});

describe('buildSummaryPrompt', () => {
  const written = chapter({
    number: 1,
    messages: [said('user', 'I knock.'), said('assistant', 'No answer.')],
  });

  it('hands over the story so far, the scene and the transcript', () => {
    const messages = buildSummaryPrompt(
      story({ world: { ...story().world, storySoFar: 'She arrived on the island.' } }),
      written,
    );
    const user = messages[1].content;
    // The answer replaces the summary, so the old one has to be in the question.
    expect(user).toContain('The story so far, as it stands:');
    expect(user).toContain('She arrived on the island.');
    expect(user).toContain('The keeper’s cottage');
    expect(user).toContain('Reader: I knock.');
    expect(user).toContain('Story: No answer.');
    expect(user).toContain(DEFAULT_SUMMARY_INSTRUCTION);
  });

  it('says so when there is no summary yet', () => {
    expect(buildSummaryPrompt(story(), written)[1].content).toContain(
      'There is no summary of the story yet',
    );
  });

  it('uses the writer’s own instruction once overridden', () => {
    const base = story();
    const own = story({
      world: { ...base.world, summary: { useDefault: false, prompt: 'Two lines, no more.' } },
    });
    expect(summaryInstruction(own)).toBe('Two lines, no more.');
    expect(buildSummaryPrompt(own, written)[1].content).toContain('Two lines, no more.');

    // The switch decides, not the text: turning it off restores ours.
    const off = {
      ...own,
      world: { ...own.world, summary: { ...own.world.summary, useDefault: true } },
    };
    expect(summaryInstruction(off)).toBe(DEFAULT_SUMMARY_INSTRUCTION);
  });
});
