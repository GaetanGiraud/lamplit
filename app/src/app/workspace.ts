import { Component, afterNextRender, effect, inject } from '@angular/core';
import { DEFAULT_STORY_TITLE } from './core/defaults';
import { ChaptersPage } from './features/chapters/chapters-page';
import { TopBar } from './shared/top-bar';
import { UpgradeNotice } from './shared/upgrade-notice';
import { SettingsStore } from './store/settings-store';
import { ChapterStore } from './store/chapter-store';
import { StoryStore } from './store/story-store';
import { Persistence } from './store/persistence';
import { DialogsService } from './shared/dialogs.service';

/**
 * The app itself, once there are documents to show.
 *
 * Split from `App` so that the stores are only ever built when the server has
 * handed its documents over — they read at construction, and a store that
 * loaded from nothing would look exactly like a fresh install and start writing
 * over one.
 */
@Component({
  selector: 'ms-workspace',
  imports: [TopBar, UpgradeNotice, ChaptersPage],
  template: `
    <ms-top-bar />
    <ms-upgrade-notice />
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
export class Workspace {
  private readonly settings = inject(SettingsStore);
  private readonly chapters = inject(ChapterStore);
  private readonly stories = inject(StoryStore);
  private readonly dialogs = inject(DialogsService);

  constructor() {
    inject(Persistence).listen();

    // The whole palette hangs off `color-scheme`, so this one line is the theme.
    effect(() => {
      document.documentElement.style.colorScheme = this.settings.ui().theme;
    });

    // What a fresh install is asked, in the order it is asked.
    //
    // The connection comes first and insists on an answer: there is no point
    // writing a scene for a model the app cannot reach, and every other
    // question is downstream of this one. It is skipped the moment there is an
    // endpoint and a model, which is every run after the first.
    //
    // Then the story questions, on an install that has never been written in —
    // mode and persona shape every request the chapter will make. Then the
    // scene, because a chapter without one cannot be written into.
    afterNextRender(async () => {
      if (!this.settings.isConnected()) await this.dialogs.openConnection(true);
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
