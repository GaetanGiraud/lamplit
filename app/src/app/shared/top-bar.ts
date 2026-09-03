import { Component, computed, inject } from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { MatMenuModule } from '@angular/material/menu';
import { MatTooltipModule } from '@angular/material/tooltip';
import { chapterTitle } from '../core/prompt-builder';
import { SettingsStore } from '../store/settings-store';
import { ChapterStore } from '../store/chapter-store';
import { StoryStore } from '../store/story-store';
import { DialogsService } from './dialogs.service';
import { SaveStatusIndicator } from './save-status';

/**
 * The one bar that is always there: which story and chapter are open, which
 * model is answering, and the way into everything that opens over the page.
 */
@Component({
  selector: 'ms-top-bar',
  imports: [MatButtonModule, MatMenuModule, MatTooltipModule, SaveStatusIndicator],
  template: `
    <header class="bar">
      <div class="identity">
        <span class="wordmark">Lamplit</span>
        <button matButton class="here" [matMenuTriggerFor]="storiesMenu">
          <span class="label">
            <span class="story">{{ stories.story().title }}</span
            >&ngsp;·&ngsp;<span class="chapter">{{ chapterLabel() }}</span>
          </span>
        </button>
        <mat-menu #storiesMenu="matMenu">
          @for (story of stories.stories(); track story.id) {
            <button mat-menu-item (click)="stories.select(story.id)">
              {{ story.id === stories.story().id ? '• ' : '' }}{{ story.title }}
            </button>
          }
          <hr />
          <button mat-menu-item (click)="dialogs.newStory()">New story…</button>
          <button mat-menu-item (click)="rename()">Rename…</button>
          <button mat-menu-item (click)="stories.duplicate(stories.story().id)">Duplicate</button>
          <button mat-menu-item (click)="remove()">Delete story…</button>
        </mat-menu>
      </div>

      <div class="actions">
        <ms-save-status />

        <button
          matButton
          class="model"
          [class.unset]="!settings.isConnected()"
          (click)="dialogs.openConnection()"
          [matTooltip]="connectionTooltip()"
        >
          <span class="dot" [class.live]="settings.isConnected()"></span>
          {{ modelLabel() }}
        </button>

        <button matButton (click)="dialogs.openStory()">Story</button>
        <button matButton (click)="dialogs.openWorld()">World</button>
        <button matButton (click)="dialogs.openChapters()">Chapters</button>
        <button matButton (click)="dialogs.openParameters()">Parameters</button>
        <button matButton (click)="dialogs.openPreferences()">Preferences</button>

        <button matButton [matMenuTriggerFor]="more" aria-label="More actions">⋯</button>
        <mat-menu #more="matMenu">
          <button mat-menu-item (click)="dialogs.newChapter()">New chapter…</button>
          <button mat-menu-item (click)="dialogs.openScene(chapters.chapter().id)">
            Edit this scene…
          </button>
          <button mat-menu-item [disabled]="chapters.isEmpty()" (click)="clear()">
            Clear this chapter
          </button>
          <hr />
          <button mat-menu-item (click)="dialogs.openAbout()">About Lamplit…</button>
        </mat-menu>
      </div>
    </header>
  `,
  styles: `
    .bar {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 1rem;
      height: 3.25rem;
      padding: 0 0.75rem 0 1.1rem;
      border-bottom: 1px solid var(--ms-border);
      background: color-mix(in srgb, var(--ms-surface) 82%, transparent);
      backdrop-filter: blur(10px);
    }

    .identity {
      display: flex;
      align-items: center;
      gap: 0.5rem;
      min-width: 0;
      overflow: hidden;
    }

    .wordmark {
      flex: none;
      font-family: var(--ms-serif);
      font-size: 1.05rem;
      letter-spacing: 0.01em;
      white-space: nowrap;
      color: var(--ms-ink);
    }

    /* Material centres a button's label, which would spill it over the
       wordmark: one flex child, started at the left edge, clipped here. */
    .here {
      display: flex;
      justify-content: flex-start;
      overflow: hidden;
      min-width: 0;
      max-width: 30rem;
    }

    /* One line that ellipsises as a whole: story first, chapter trimmed. */
    .label {
      display: block;
      min-width: 0;
      max-width: 100%;
      overflow: hidden;
      white-space: nowrap;
      text-overflow: ellipsis;
      color: var(--ms-muted);
    }

    .story {
      font-family: var(--ms-serif);
      font-size: 0.95rem;
      color: var(--ms-ink);
    }

    .chapter {
      font-size: 0.85rem;
    }

    .actions {
      flex: none;
      display: flex;
      align-items: center;
      gap: 0.15rem;
    }

    /* Narrow windows keep the story and the model; the wordmark can go. */
    @media (max-width: 980px) {
      .wordmark {
        display: none;
      }
    }

    .model {
      max-width: 15rem;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }

    .model.unset {
      color: var(--ms-accent);
    }

    .dot {
      display: inline-block;
      width: 7px;
      height: 7px;
      margin-right: 0.45rem;
      border-radius: 50%;
      background: var(--ms-muted);
    }

    .dot.live {
      background: light-dark(#2f8f5b, #6fd39b);
    }

    hr {
      border: 0;
      border-top: 1px solid var(--ms-border);
      margin: 0.25rem 0;
    }
  `,
})
export class TopBar {
  protected readonly settings = inject(SettingsStore);
  protected readonly stories = inject(StoryStore);
  protected readonly chapters = inject(ChapterStore);
  protected readonly dialogs = inject(DialogsService);

  protected readonly chapterLabel = computed(() => {
    const chapter = this.chapters.chapter();
    if (!chapter) return '';
    const title = chapterTitle(chapter);
    return `Chapter ${chapter.number}${title ? ` — ${title}` : ''}`;
  });

  protected readonly modelLabel = computed(() => {
    const connection = this.settings.connection();
    if (!connection.model) return 'Connect a model';
    const known = connection.modelsCache.find((m) => m.id === connection.model);
    return known?.name ?? shortModelId(connection.model);
  });

  protected readonly connectionTooltip = computed(
    () => this.settings.connectionHint() || `${this.settings.connection().baseUrl}`,
  );

  protected async rename(): Promise<void> {
    const title = await this.dialogs.askText({
      title: 'Rename story',
      label: 'Title',
      value: this.stories.story().title,
    });
    if (title) this.stories.patch({ title });
  }

  protected async remove(): Promise<void> {
    const story = this.stories.story();
    const ok = await this.dialogs.confirm({
      title: `Delete “${story.title}”?`,
      message: 'Every chapter of this story goes with it, and none of it can be brought back.',
      danger: true,
    });
    if (ok) this.stories.delete(story.id);
  }

  protected async clear(): Promise<void> {
    const ok = await this.dialogs.confirm({
      title: 'Clear this chapter?',
      message: 'Every message in it goes; the scene stays, and the chapter stays.',
      confirm: 'Clear',
      danger: true,
    });
    if (ok) this.chapters.clearMessages();
  }
}

/** `provider/family/model-name` reads better as just the last segment. */
function shortModelId(id: string): string {
  const parts = id.split('/');
  return parts[parts.length - 1] || id;
}
