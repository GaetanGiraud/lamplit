import { TestBed } from '@angular/core/testing';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  ChatStreamResult,
  JsonChatRequest,
  JsonChatResult,
  ModelClient,
} from '../core/model-client';
import { ChapterStore } from './chapter-store';
import { StoryStore } from './story-store';
import { KEYS } from './documents';
import { STORAGE_BACKEND, StorageBackend } from './storage';

/** The documents, in a Map. What Persistence is, minus the server behind it. */
class InMemoryStorage implements StorageBackend {
  readonly documents = new Map<string, unknown>();

  read<T>(key: string): T | null {
    return (this.documents.get(key) as T) ?? null;
  }
  write(key: string, value: unknown): void {
    this.documents.set(key, value);
  }
  remove(key: string): void {
    this.documents.delete(key);
  }
  keys(prefix: string): string[] {
    return [...this.documents.keys()].filter((key) => key.startsWith(prefix));
  }
}

/** An endpoint that answers whatever the test told it to, and counts. */
class FakeClient {
  answer: JsonChatResult<unknown> = { value: { palette: 'frost' }, raw: '{"palette":"frost"}' };
  readonly requests: JsonChatRequest[] = [];

  chatJson = <T>(request: JsonChatRequest): Promise<JsonChatResult<T>> => {
    this.requests.push(request);
    return Promise.resolve(this.answer as JsonChatResult<T>);
  };

  /** Sends one delta and then waits, the way a reply half-way through does. */
  streamChat = (
    _request: unknown,
    onDelta: (delta: { content?: string }) => void,
    signal: AbortSignal,
  ): Promise<ChatStreamResult> => {
    onDelta({ content: 'The lantern room, ' });
    return new Promise((fulfil) => {
      signal.addEventListener('abort', () =>
        // Aborting resolves rather than throws, so the partial text is kept.
        fulfil({ content: 'The lantern room, ', reasoning: '', aborted: true }),
      );
    });
  };
}

const STORY_ID = 'story-1';
const CHAPTER_ID = 'chapter-1';

describe('ChapterStore and the page palette', () => {
  let storage: InMemoryStorage;
  let client: FakeClient;

  /** Seeded before the store is built: it reads its documents at construction. */
  function seed(story: Record<string, unknown> = {}, chapter: Record<string, unknown> = {}): void {
    storage.write(KEYS.settings, {
      connection: { provider: 'nanogpt', baseUrl: 'https://x/v1', apiKey: '', model: 'm' },
      activeStoryId: STORY_ID,
    });
    storage.write(KEYS.story(STORY_ID), {
      id: STORY_ID,
      title: 'A story',
      updatedAt: '2026-01-01T00:00:00.000Z',
      activeChapterId: CHAPTER_ID,
      chapterCounter: 1,
      autoTheme: true,
      ...story,
    });
    storage.write(KEYS.chapter(CHAPTER_ID), {
      id: CHAPTER_ID,
      storyId: STORY_ID,
      number: 1,
      title: '',
      scene: 'A monastery under snow. Midwinter, and the bell has not rung since Tuesday.',
      status: 'writing',
      summary: '',
      messages: [],
      ...chapter,
    });
  }

  const store = () => TestBed.inject(ChapterStore);
  const chapter = () => store().chapters()[0];

  beforeEach(() => {
    storage = new InMemoryStorage();
    client = new FakeClient();
    vi.spyOn(console, 'warn').mockImplementation(() => {
      /* the store warns on purpose in these tests; the run need not */
    });
    TestBed.configureTestingModule({
      providers: [
        { provide: STORAGE_BACKEND, useValue: storage },
        { provide: ModelClient, useValue: client },
      ],
    });
  });

  afterEach(() => vi.restoreAllMocks());

  it('asks nothing at all when the story has not asked for it', async () => {
    seed({ autoTheme: false });

    expect(await store().choosePalette(CHAPTER_ID)).toBe('');
    expect(client.requests).toHaveLength(0);
    expect(chapter().palette).toBeUndefined();
  });

  it('asks nothing when there is no endpoint to ask', async () => {
    seed();
    storage.write(KEYS.settings, { activeStoryId: STORY_ID });

    expect(await store().choosePalette(CHAPTER_ID)).toBe('');
    expect(client.requests).toHaveLength(0);
  });

  it('asks nothing about a scene that has not been written yet', async () => {
    seed({}, { scene: '   ' });

    expect(await store().choosePalette(CHAPTER_ID)).toBe('');
    expect(client.requests).toHaveLength(0);
  });

  it('files the answer on the chapter, with what it cost', async () => {
    seed();
    client.answer = {
      value: { palette: 'frost' },
      raw: '{"palette":"frost"}',
      usage: { totalTokens: 214 },
    };

    expect(await store().choosePalette(CHAPTER_ID)).toBe('frost');
    expect(chapter().palette).toBe('frost');
    expect(chapter().paletteTokens).toBe(214);
    // The scene went, and the schema with it.
    expect(client.requests[0].messages[1].content).toContain('monastery under snow');
    expect(client.requests[0].schema.name).toBe('page_palette');
  });

  it('estimates the cost when the endpoint does not say', async () => {
    seed();
    client.answer = { value: { palette: 'frost' }, raw: '{"palette":"frost"}' };

    await store().choosePalette(CHAPTER_ID);
    expect(chapter().paletteTokens).toBeGreaterThan(0);
  });

  it('changes nothing when the answer is not a palette', async () => {
    seed();
    client.answer = { value: null, raw: 'I would suggest a soft mauve.' };

    expect(await store().choosePalette(CHAPTER_ID)).toBe('');
    expect(chapter().palette).toBeUndefined();
    expect(chapter().paletteTokens).toBeUndefined();
  });

  it('changes nothing when the request itself fails', async () => {
    seed();
    client.chatJson = () => Promise.reject(new TypeError('Failed to fetch'));

    expect(await store().choosePalette(CHAPTER_ID)).toBe('');
    expect(chapter().palette).toBeUndefined();
  });

  it('does not ask twice about a scene that has not changed', async () => {
    seed({}, { palette: 'frost' });
    const scene = chapter().scene;

    expect(await store().choosePalette(CHAPTER_ID, scene)).toBe('');
    expect(client.requests).toHaveLength(0);

    // A rewritten scene is a new question, even in a chapter that has a page.
    store().update(CHAPTER_ID, { scene: 'A jazz club, two in the morning.' });
    client.answer = { value: { palette: 'nocturne' }, raw: '' };
    expect(await store().choosePalette(CHAPTER_ID, scene)).toBe('nocturne');
    expect(chapter().palette).toBe('nocturne');
  });

  it('marks a reply left half-written when the reader moves to another story', async () => {
    seed();
    // A second story, so there is somewhere to move to.
    const OTHER = 'story-2';
    storage.write(KEYS.story(OTHER), {
      id: OTHER,
      title: 'Another story',
      updatedAt: '2026-01-01T00:00:00.000Z',
      activeChapterId: 'chapter-2',
      chapterCounter: 1,
    });
    storage.write(KEYS.chapter('chapter-2'), {
      id: 'chapter-2',
      storyId: OTHER,
      number: 1,
      title: '',
      scene: 'Somewhere else entirely.',
      status: 'writing',
      summary: '',
      messages: [],
    });

    const chapters = store();
    const sending = chapters.send('I climb the stairs.');
    expect(chapters.isStreaming()).toBe(true);

    TestBed.inject(StoryStore).select(OTHER);
    chapters.sync();
    await sending;

    // The chapter is not this store's any more, so the file is what can be read.
    const written = storage.read<{ messages: { content: string; meta?: { aborted?: boolean } }[] }>(
      KEYS.chapter(CHAPTER_ID),
    );
    const last = written!.messages[written!.messages.length - 1];
    expect(last.content).toBe('The lantern room, ');
    expect(last.meta?.aborted).toBe(true);
  });

  it('draws the open chapter on its own page, and the story on its own', () => {
    seed({}, { palette: 'tide' });

    expect(store().palette()?.name).toBe('tide');
    // Given back by hand, the chapter falls through to what Preferences says —
    // which, in a settings file that has never chosen one, is nothing.
    store().setPalette(CHAPTER_ID, '');
    expect(chapter().palette).toBeUndefined();
    expect(store().palette()).toBeNull();
  });
});
