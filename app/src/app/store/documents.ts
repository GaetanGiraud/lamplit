import { DEFAULT_SCAN, DEFAULT_STORY_TITLE, DEFAULT_STYLE } from '../core/defaults';
import { Chapter, ChapterMessage, Story } from '../core/models';
import { StorageBackend } from './storage';

/**
 * One document per file, the same shape the step-3 server will hold. Both
 * stores go through here so neither has to know how the other is filed —
 * deleting a story can take its chapters with it without a circular import.
 */
export const KEYS = {
  settings: 'settings',
  story: (id: string) => `story:${id}`,
  storyPrefix: 'story:',
  chapter: (id: string) => `chapter:${id}`,
  chapterPrefix: 'chapter:',
  /** Step 1 filed the single conversation under these. Read once, then gone. */
  legacyChat: (id: string) => `chat:${id}`,
  legacyActiveChat: 'active-chat',
} as const;

export function newId(): string {
  return crypto.randomUUID();
}

export function now(): string {
  return new Date().toISOString();
}

export function newStory(title = DEFAULT_STORY_TITLE): Story {
  return {
    id: newId(),
    title,
    createdAt: now(),
    updatedAt: now(),
    mode: 'narrator',
    narrator: { useDefault: true, prompt: '' },
    characters: [],
    persona: { name: '', description: '' },
    style: { ...DEFAULT_STYLE },
    world: {
      storySoFar: '',
      summary: { useDefault: true, prompt: '' },
      entries: [],
      scan: { ...DEFAULT_SCAN },
    },
    activeChapterId: '',
    chapterCounter: 0,
  };
}

export function newChapter(storyId: string, number: number, scene = '', title = ''): Chapter {
  return {
    id: newId(),
    storyId,
    number,
    title,
    scene,
    status: 'writing',
    summary: '',
    createdAt: now(),
    updatedAt: now(),
    messages: [],
  };
}

export function readStories(storage: StorageBackend): Story[] {
  const stories: Story[] = [];
  for (const key of storage.keys(KEYS.storyPrefix)) {
    const stored = storage.read<Partial<Story>>(key);
    if (stored?.id) stories.push(normaliseStory(stored));
  }
  return stories.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}

export function readChapters(storage: StorageBackend, storyId: string): Chapter[] {
  const chapters: Chapter[] = [];
  for (const key of storage.keys(KEYS.chapterPrefix)) {
    const stored = storage.read<Partial<Chapter>>(key);
    if (stored?.id && stored.storyId === storyId) chapters.push(normaliseChapter(stored));
  }
  return chapters.sort((a, b) => a.number - b.number);
}

export function removeStoryDocuments(storage: StorageBackend, storyId: string): void {
  for (const chapter of readChapters(storage, storyId)) {
    storage.remove(KEYS.chapter(chapter.id));
  }
  storage.remove(KEYS.story(storyId));
}

/** Fills in anything a document written by an older version is missing. */
export function normaliseStory(stored: Partial<Story>): Story {
  const base = newStory();
  return {
    ...base,
    ...stored,
    id: stored.id ?? base.id,
    narrator: { ...base.narrator, ...stored.narrator },
    characters: Array.isArray(stored.characters) ? stored.characters : [],
    persona: { ...base.persona, ...stored.persona },
    style: { ...base.style, ...stored.style },
    world: {
      storySoFar: stored.world?.storySoFar ?? '',
      summary: { ...base.world.summary, ...stored.world?.summary },
      entries: Array.isArray(stored.world?.entries) ? stored.world.entries : [],
      scan: { ...base.world.scan, ...stored.world?.scan },
    },
  };
}

export function normaliseChapter(stored: Partial<Chapter>): Chapter {
  const base = newChapter(stored.storyId ?? '', stored.number ?? 1);
  const messages = Array.isArray(stored.messages) ? stored.messages : [];
  return {
    ...base,
    ...stored,
    id: stored.id ?? base.id,
    // A reload mid-stream would otherwise restore a message stuck at "typing".
    messages: messages.filter((m: ChapterMessage) => m.content || m.meta?.error),
  };
}

/**
 * Step 1's single conversation becomes Chapter 1 of a new story, with an empty
 * scene — which is exactly the state the scene sheet exists to resolve. The
 * messages are left alone.
 */
export function migrateLegacyChat(storage: StorageBackend): Story | null {
  const chatId = storage.read<string>(KEYS.legacyActiveChat);
  if (!chatId) return null;
  const chat = storage.read<{ messages?: ChapterMessage[]; createdAt?: string }>(
    KEYS.legacyChat(chatId),
  );
  storage.remove(KEYS.legacyActiveChat);
  storage.remove(KEYS.legacyChat(chatId));
  if (!chat?.messages?.length) return null;

  const story = newStory();
  const chapter = newChapter(story.id, 1);
  chapter.createdAt = chat.createdAt ?? chapter.createdAt;
  chapter.messages = chat.messages.filter((m) => m.content || m.meta?.error);
  story.activeChapterId = chapter.id;
  story.chapterCounter = 1;

  storage.write(KEYS.chapter(chapter.id), chapter);
  storage.write(KEYS.story(story.id), story);
  return story;
}
