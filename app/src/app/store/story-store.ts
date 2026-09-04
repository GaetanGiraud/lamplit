import { Injectable, computed, effect, inject, signal } from '@angular/core';
import { DEFAULT_STORY_TITLE } from '../core/defaults';
import { BlockId, Character, LoreCategory, LoreEntry, Story } from '../core/models';
import { SettingsStore } from './settings-store';
import { STORAGE_BACKEND } from './storage';
import {
  KEYS,
  newChapter,
  newId,
  newStory,
  now,
  readChapters,
  readStories,
  removeStoryDocuments,
} from './documents';

/**
 * Every story on this machine, and which one is open. A story is one
 * self-contained document: mode, persona, cast, world. Its chapters are
 * separate documents, held by the ChapterStore.
 */
@Injectable({ providedIn: 'root' })
export class StoryStore {
  private readonly storage = inject(STORAGE_BACKEND);
  private readonly settings = inject(SettingsStore);

  private readonly state = signal<Story[]>(this.load());
  private readonly written = new Map<string, Story>();

  readonly stories = computed(() =>
    [...this.state()].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)),
  );

  /** There is always an open story: the app creates one rather than ask. */
  readonly story = computed<Story>(() => {
    const stories = this.state();
    const active = this.settings.settings().activeStoryId;
    return stories.find((s) => s.id === active) ?? stories[0];
  });

  constructor() {
    const active = this.settings.settings().activeStoryId;
    if (!this.state().some((s) => s.id === active)) {
      this.settings.setActiveStory(this.state()[0].id);
    }
    // Only the documents that actually changed are rewritten.
    effect(() => {
      for (const story of this.state()) {
        if (this.written.get(story.id) === story) continue;
        this.written.set(story.id, story);
        this.storage.write(KEYS.story(story.id), story);
      }
    });
  }

  patch(patch: Partial<Story>, id = this.story().id): void {
    this.state.update((stories) =>
      stories.map((s) => (s.id === id ? { ...s, ...patch, updatedAt: now() } : s)),
    );
  }

  select(id: string): void {
    if (this.state().some((s) => s.id === id)) this.settings.setActiveStory(id);
  }

  /** A new story starts with Chapter 1 waiting for its scene. */
  create(title = DEFAULT_STORY_TITLE): Story {
    const story = newStory(title.trim() || DEFAULT_STORY_TITLE);
    const chapter = newChapter(story.id, 1);
    story.activeChapterId = chapter.id;
    story.chapterCounter = 1;
    this.storage.write(KEYS.chapter(chapter.id), chapter);
    this.state.update((stories) => [...stories, story]);
    this.settings.setActiveStory(story.id);
    return story;
  }

  duplicate(id: string): Story | null {
    const source = this.state().find((s) => s.id === id);
    if (!source) return null;
    const copy: Story = {
      ...structuredClone(source),
      id: newId(),
      title: `${source.title} (copy)`,
      createdAt: now(),
      updatedAt: now(),
    };
    // Chapters are documents of their own, so the copy needs its own set.
    let activeChapterId = '';
    for (const chapter of readChapters(this.storage, source.id)) {
      const cloned = { ...structuredClone(chapter), id: newId(), storyId: copy.id };
      if (chapter.id === source.activeChapterId) activeChapterId = cloned.id;
      this.storage.write(KEYS.chapter(cloned.id), cloned);
    }
    copy.activeChapterId = activeChapterId;
    this.state.update((stories) => [...stories, copy]);
    this.settings.setActiveStory(copy.id);
    return copy;
  }

  /** Deletes the story and every chapter filed under it. */
  delete(id: string): void {
    removeStoryDocuments(this.storage, id);
    this.written.delete(id);
    const remaining = this.state().filter((s) => s.id !== id);
    this.state.set(remaining);
    if (!remaining.length) {
      this.create();
    } else if (this.settings.settings().activeStoryId === id) {
      this.settings.setActiveStory(remaining[0].id);
    }
  }

  // -- cast -----------------------------------------------------------------

  addCharacter(name = ''): Character {
    const character: Character = { id: newId(), name, description: '', enabled: true };
    this.patch({ characters: [...this.story().characters, character] });
    return character;
  }

  patchCharacter(id: string, patch: Partial<Character>): void {
    this.patch({
      characters: this.story().characters.map((c) => (c.id === id ? { ...c, ...patch } : c)),
    });
  }

  removeCharacter(id: string): void {
    this.patch({ characters: this.story().characters.filter((c) => c.id !== id) });
  }

  // -- world ----------------------------------------------------------------

  setStorySoFar(text: string): void {
    this.patch({ world: { ...this.story().world, storySoFar: text } });
  }

  /**
   * What "close chapter" does with the summary it just wrote: replace the story
   * so far rather than append to it. The model was handed the old text and
   * asked to fold this chapter into it, so what comes back is the whole story
   * — and the summary stays one readable page however long the story runs.
   */
  replaceStorySoFar(summary: string): void {
    const text = summary.trim();
    if (text) this.setStorySoFar(text);
  }

  setSummaryPrompt(patch: Partial<Story['world']['summary']>): void {
    const world = this.story().world;
    this.patch({ world: { ...world, summary: { ...world.summary, ...patch } } });
  }

  patchScan(patch: Partial<Story['world']['scan']>): void {
    const world = this.story().world;
    this.patch({ world: { ...world, scan: { ...world.scan, ...patch } } });
  }

  addLore(category: LoreCategory = 'fact'): LoreEntry {
    const entry: LoreEntry = {
      id: newId(),
      title: '',
      category,
      keys: [],
      content: '',
      enabled: true,
      alwaysOn: false,
    };
    const world = this.story().world;
    this.patch({ world: { ...world, entries: [...world.entries, entry] } });
    return entry;
  }

  patchLore(id: string, patch: Partial<LoreEntry>): void {
    const world = this.story().world;
    this.patch({
      world: {
        ...world,
        entries: world.entries.map((e) => (e.id === id ? { ...e, ...patch } : e)),
      },
    });
  }

  duplicateLore(id: string): void {
    const world = this.story().world;
    const source = world.entries.find((e) => e.id === id);
    if (!source) return;
    const copy: LoreEntry = {
      ...structuredClone(source),
      id: newId(),
      title: `${source.title} (copy)`,
    };
    const index = world.entries.indexOf(source);
    const entries = [...world.entries];
    entries.splice(index + 1, 0, copy);
    this.patch({ world: { ...world, entries } });
  }

  removeLore(id: string): void {
    const world = this.story().world;
    this.patch({ world: { ...world, entries: world.entries.filter((e) => e.id !== id) } });
  }

  // -- the shape of the prompt ----------------------------------------------

  /**
   * The order this story's movable blocks are assembled in. Stored per story
   * because it is a judgement about the story and the model behind it, not a
   * preference about the app.
   */
  setPromptOrder(order: BlockId[], id = this.story().id): void {
    this.patch({ promptOrder: [...order] }, id);
  }

  /** Back to the shipped order, with nothing left in the document to say so. */
  resetPromptOrder(id = this.story().id): void {
    this.state.update((stories) =>
      stories.map((story) => {
        if (story.id !== id) return story;
        const { promptOrder: _shipped, ...rest } = story;
        return { ...rest, updatedAt: now() };
      }),
    );
  }

  // -- chapters (the story's side of them) -----------------------------------

  setActiveChapter(id: string): void {
    this.patch({ activeChapterId: id });
  }

  /** Numbers only ever go up: chapter 3 stays chapter 3 after a deletion. */
  takeChapterNumber(): number {
    const next = this.story().chapterCounter + 1;
    this.patch({ chapterCounter: next });
    return next;
  }

  /** An install with nothing in it gets one story, so there is always one open. */
  private load(): Story[] {
    const stored = readStories(this.storage);
    if (stored.length) return stored;

    const story = newStory();
    const chapter = newChapter(story.id, 1);
    story.activeChapterId = chapter.id;
    story.chapterCounter = 1;
    this.storage.write(KEYS.chapter(chapter.id), chapter);
    this.storage.write(KEYS.story(story.id), story);
    return [story];
  }
}
