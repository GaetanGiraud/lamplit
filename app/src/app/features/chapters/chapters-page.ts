import { Component, computed, inject } from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { ChapterStore } from '../../store/chapter-store';
import { SettingsStore } from '../../store/settings-store';
import { StoryStore } from '../../store/story-store';
import { DialogsService } from '../../shared/dialogs.service';
import { chapterTitle } from '../../core/prompt-builder';
import { ChapterToolbar } from './chapter-toolbar';
import { Composer } from './composer';
import { MessageList } from './message-list';

@Component({
  selector: 'ms-chapters-page',
  imports: [MatButtonModule, ChapterToolbar, Composer, MessageList],
  template: `
    <section class="page">
      @if (chapters.isEmpty()) {
        <div class="welcome">
          <div class="card">
            @if (!chapters.hasScene()) {
              <h1>Chapter {{ chapters.chapter().number }}</h1>
              <p>
                A chapter opens the way a scene opens in a playscript: a few lines saying where we
                are, when, and what is happening as the lights come up. Write those, and the chapter
                starts.
              </p>
              <button matButton="filled" (click)="writeScene()">Write the scene</button>
            } @else if (!settings.isConnected()) {
              <h1>{{ title() }}</h1>
              <p>
                MagicStories talks straight from this page to any OpenAI-compatible endpoint. Point
                it at one and start writing.
              </p>
              <button matButton="filled" (click)="dialogs.openConnection()">Connect a model</button>
            } @else {
              <h1>{{ title() }}</h1>
              <p class="scene">{{ chapters.chapter().scene }}</p>
              <p class="ms-hint">
                Write the first line below. Answering with {{ settings.connection().model }}.
              </p>
            }
          </div>
        </div>
      } @else {
        <ms-message-list />
      }

      <ms-chapter-toolbar />
      <ms-composer />
    </section>
  `,
  styles: `
    :host {
      display: block;
      height: 100%;
      min-height: 0;
    }

    .page {
      display: flex;
      flex-direction: column;
      height: 100%;
      min-height: 0;
    }

    .welcome {
      flex: 1;
      display: grid;
      place-items: center;
      padding: 1.5rem;
      min-height: 0;
      overflow-y: auto;
    }

    .card {
      max-width: 30rem;
      text-align: center;
    }

    h1 {
      font-family: var(--ms-serif);
      font-weight: 500;
      font-size: 1.9rem;
      margin: 0 0 0.6rem;
      color: var(--ms-ink);
    }

    p {
      font-family: var(--ms-serif);
      font-size: 1.02rem;
      line-height: 1.6;
      color: var(--ms-ink-soft);
      margin: 0 0 1rem;
    }

    /* The scene is prose the writer wrote: set it as prose, not as a caption. */
    .scene {
      white-space: pre-wrap;
      text-align: left;
      padding: 0.9rem 1.1rem;
      border-left: 2px solid color-mix(in srgb, var(--ms-accent) 55%, transparent);
      background: color-mix(in srgb, var(--ms-surface) 70%, transparent);
    }

    p.ms-hint {
      font-family: var(--ms-sans);
      font-size: 0.78rem;
    }
  `,
})
export class ChaptersPage {
  protected readonly chapters = inject(ChapterStore);
  protected readonly stories = inject(StoryStore);
  protected readonly settings = inject(SettingsStore);
  protected readonly dialogs = inject(DialogsService);

  protected readonly title = computed(
    () => chapterTitle(this.chapters.chapter()) || `Chapter ${this.chapters.chapter().number}`,
  );

  protected writeScene(): void {
    void this.dialogs.openScene(this.chapters.chapter().id, true);
  }
}
