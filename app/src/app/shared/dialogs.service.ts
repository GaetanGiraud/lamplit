import { Injectable, inject } from '@angular/core';
import { firstValueFrom } from 'rxjs';
import { MatDialog } from '@angular/material/dialog';
import { DEFAULT_STORY_TITLE } from '../core/defaults';
import { ChapterStore } from '../store/chapter-store';
import { StoryStore } from '../store/story-store';
import type { NewStoryData, StorySetup } from '../features/story/new-story-dialog';
import { ConfirmData, TextPromptData } from './small-dialogs';

/**
 * The page is never taken away: everything else opens over it. Keeping the
 * openers here means the top bar, the composer, the chapter toolbar and the
 * lists can all reach a modal without importing each other — and the two
 * flows that chain modals (new chapter, close chapter) live in one place.
 */
@Injectable({ providedIn: 'root' })
export class DialogsService {
  private readonly dialog = inject(MatDialog);
  private readonly chapters = inject(ChapterStore);
  private readonly stories = inject(StoryStore);

  async openConnection(): Promise<void> {
    const { ConnectionDialog } = await import('../features/connection/connection-dialog');
    this.dialog.open(ConnectionDialog, {
      width: '34rem',
      maxWidth: '95vw',
      autoFocus: 'dialog',
    });
  }

  async openParameters(): Promise<void> {
    const { ParametersDialog } = await import('../features/generation/parameters-dialog');
    this.dialog.open(ParametersDialog, {
      width: '44rem',
      maxWidth: '95vw',
      autoFocus: 'dialog',
    });
  }

  async openStory(): Promise<void> {
    const { StoryDialog } = await import('../features/story/story-dialog');
    this.dialog.open(StoryDialog, { width: '42rem', maxWidth: '95vw', autoFocus: 'dialog' });
  }

  async openWorld(): Promise<void> {
    const { WorldDialog } = await import('../features/world/world-dialog');
    this.dialog.open(WorldDialog, { width: '46rem', maxWidth: '95vw', autoFocus: 'dialog' });
  }

  async openChapters(): Promise<void> {
    const { ChaptersDialog } = await import('../features/chapters/chapters-dialog');
    this.dialog.open(ChaptersDialog, { width: '40rem', maxWidth: '95vw', autoFocus: 'dialog' });
  }

  async openPromptPreview(draft = ''): Promise<void> {
    const { PromptPreviewDialog } = await import('../features/chapters/prompt-preview-dialog');
    this.dialog.open(PromptPreviewDialog, {
      width: '46rem',
      maxWidth: '95vw',
      data: { draft },
      autoFocus: 'dialog',
    });
  }

  /**
   * The scene sheet. Resolves true when the writer confirmed; Escape and
   * backdrop still save the text, they just do not open the chapter.
   */
  async openScene(chapterId: string, opening = false): Promise<boolean> {
    const { SceneDialog } = await import('../features/chapters/scene-dialog');
    const ref = this.dialog.open(SceneDialog, {
      width: '40rem',
      maxWidth: '95vw',
      data: { chapterId, opening },
      autoFocus: 'first-tabbable',
    });
    return (await firstValueFrom(ref.afterClosed())) === true;
  }

  /**
   * New chapter: starting the next one closes the one being written, because
   * that is what carries the story forward — the chapter is summarised, the
   * summary is reviewed, and it joins the story so far before the new scene is
   * written. A chapter with nothing in it, or one already closed, has nothing
   * to summarise, so that case goes straight to the scene sheet.
   */
  async newChapter(): Promise<void> {
    const chapter = this.chapters.chapter();
    if (chapter && chapter.status === 'writing' && chapter.messages.length) {
      await this.closeChapter();
      return;
    }
    await this.startChapter(chapter?.scene ?? '');
  }

  /**
   * Close chapter: summarise, review, fold into the story so far, then open
   * the next chapter's sheet pre-filled with this one's scene.
   */
  async closeChapter(): Promise<void> {
    const chapter = this.chapters.chapter();
    const { CloseChapterDialog } = await import('../features/chapters/close-chapter-dialog');
    const ref = this.dialog.open(CloseChapterDialog, {
      width: '42rem',
      maxWidth: '95vw',
      autoFocus: 'dialog',
    });
    const summary = await firstValueFrom<string | undefined>(ref.afterClosed());
    // Backing out of the review leaves the chapter open and starts nothing.
    if (summary === undefined) return;

    this.chapters.closeChapter(chapter.id, summary);
    await this.startChapter(chapter.scene);
  }

  /** The record exists at once, and the scene sheet opens over it. */
  private async startChapter(scene: string): Promise<void> {
    const chapter = this.chapters.createChapter(scene);
    await this.openScene(chapter.id, true);
  }

  async askText(data: TextPromptData): Promise<string | undefined> {
    const { TextPromptDialog } = await import('./small-dialogs');
    const ref = this.dialog.open(TextPromptDialog, { data, autoFocus: 'first-tabbable' });
    return firstValueFrom<string | undefined>(ref.afterClosed());
  }

  async confirm(data: ConfirmData): Promise<boolean> {
    const { ConfirmDialog } = await import('./small-dialogs');
    const ref = this.dialog.open(ConfirmDialog, { data, autoFocus: 'dialog' });
    return (await firstValueFrom(ref.afterClosed())) === true;
  }

  /**
   * The story sheet on its own, seeded from whatever it is handed. Resolves to
   * what the writer chose, or undefined if they backed out.
   */
  private async askSetup(data: NewStoryData): Promise<StorySetup | undefined> {
    const { NewStoryDialog } = await import('../features/story/new-story-dialog');
    const ref = this.dialog.open(NewStoryDialog, {
      width: '34rem',
      maxWidth: '95vw',
      data,
      autoFocus: 'first-tabbable',
    });
    return firstValueFrom<StorySetup | undefined>(ref.afterClosed());
  }

  /**
   * New story: who tells it and who you play, then the first scene. Setup
   * comes first because it shapes every request the chapter will make — and
   * nothing is created until it is confirmed.
   */
  async newStory(): Promise<void> {
    const setup = await this.askSetup({
      heading: 'A new story',
      confirm: 'Write the first scene',
      title: '',
      mode: 'narrator',
      persona: { name: '', description: '' },
    });
    if (!setup) return;

    const story = this.stories.create(setup.title);
    this.stories.patch({ mode: setup.mode, persona: setup.persona }, story.id);
    // The chapter store follows the active story through an effect; the flow
    // continues in this tick, so ask it to catch up now.
    this.chapters.sync();
    await this.openScene(this.chapters.chapter().id, true);
  }

  /**
   * First run: the app has already made a story, so this offers the same
   * questions over it. Backing out simply keeps the defaults.
   */
  async setUpFirstStory(): Promise<void> {
    const story = this.stories.story();
    const setup = await this.askSetup({
      heading: 'Your first story',
      confirm: 'Write the first scene',
      title: story.title === DEFAULT_STORY_TITLE ? '' : story.title,
      mode: story.mode,
      persona: story.persona,
    });
    if (!setup) return;
    this.stories.patch(
      {
        title: setup.title || story.title,
        mode: setup.mode,
        persona: setup.persona,
      },
      story.id,
    );
  }
}
