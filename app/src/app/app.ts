import { Component, afterNextRender, effect, inject } from '@angular/core';
import { DEFAULT_STORY_TITLE } from './core/defaults';
import { ChaptersPage } from './features/chapters/chapters-page';
import { TopBar } from './shared/top-bar';
import { SettingsStore } from './store/settings-store';
import { ChapterStore } from './store/chapter-store';
import { StoryStore } from './store/story-store';
import { DialogsService } from './shared/dialogs.service';

@Component({
  selector: 'app-root',
  imports: [TopBar, ChaptersPage],
  template: `
    <ms-top-bar />
    <ms-chapters-page />
  `,
  styles: `
    :host {
      display: flex;
      flex-direction: column;
      height: 100%;
      min-height: 0;
    }

    ms-chapters-page {
      flex: 1;
      min-height: 0;
    }
  `,
  host: {
    '(document:keydown)': 'onKey($event)',
  },
})
export class App {
  private readonly settings = inject(SettingsStore);
  private readonly chapters = inject(ChapterStore);
  private readonly stories = inject(StoryStore);
  private readonly dialogs = inject(DialogsService);

  constructor() {
    // The whole palette hangs off `color-scheme`, so this one line is the theme.
    effect(() => {
      document.documentElement.style.colorScheme = this.settings.ui().theme;
    });

    // A chapter without a scene cannot be written into, so the sheet is what
    // the app opens on: a new install, and the step-1 chat after it migrated.
    // On an install that has never been written in, the story questions come
    // first — mode and persona shape every request the chapter will make.
    afterNextRender(async () => {
      const chapter = this.chapters.chapter();
      if (!chapter || chapter.scene.trim()) return;
      if (this.neverWrittenIn()) await this.dialogs.setUpFirstStory();
      await this.dialogs.openScene(this.chapters.chapter().id, true);
    });
  }

  /** One default story, one empty chapter, nothing typed anywhere yet. */
  private neverWrittenIn(): boolean {
    const story = this.stories.story();
    return (
      story.title === DEFAULT_STORY_TITLE &&
      !story.persona.name.trim() &&
      !story.world.storySoFar.trim() &&
      this.chapters.chapters().length === 1 &&
      this.chapters.isEmpty()
    );
  }

  protected onKey(event: KeyboardEvent): void {
    if (!(event.ctrlKey || event.metaKey)) return;
    if (event.key === 'Enter') {
      event.preventDefault();
      void this.chapters.retryLast();
    } else if (event.key.toLowerCase() === 'k') {
      event.preventDefault();
      void this.dialogs.openConnection();
    }
  }
}
