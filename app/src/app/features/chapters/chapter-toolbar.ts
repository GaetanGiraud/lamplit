import { Component, computed, inject } from '@angular/core';
import { MatTooltipModule } from '@angular/material/tooltip';
import { ChapterStore } from '../../store/chapter-store';
import { DialogsService } from '../../shared/dialogs.service';
import { chapterTitle } from '../../core/prompt-builder';

/**
 * The chapter's own controls, sitting where a writer looks between paragraphs:
 * just above the composer, small enough to ignore until they are wanted.
 */
@Component({
  selector: 'ms-chapter-toolbar',
  imports: [MatTooltipModule],
  template: `
    <div class="row">
      <span class="here" [matTooltip]="chapters.chapter().scene">{{ label() }}</span>

      <!-- Closed chapters are continued from the dock, which says so already. -->
      @if (!chapters.isClosed()) {
        <button
          class="ms-pill"
          type="button"
          [disabled]="chapters.isEmpty() || chapters.isStreaming()"
          matTooltip="Summarise it into the story so far, keep it, and open the next one"
          (click)="dialogs.closeChapter()"
        >
          Close chapter
        </button>
      }

      <button class="ms-pill" type="button" (click)="dialogs.openScene(chapters.chapter().id)">
        Edit scene
      </button>
      <button class="ms-pill" type="button" (click)="dialogs.openPromptPreview()">
        What the model sees
      </button>
    </div>
  `,
  styles: `
    .row {
      width: min(var(--ms-measure), calc(100% - 2.5rem));
      margin: 0 auto;
      display: flex;
      align-items: center;
      gap: 0.35rem;
      padding: 0 0 0.15rem;
    }

    .here {
      flex: 1;
      min-width: 0;
      overflow: hidden;
      white-space: nowrap;
      text-overflow: ellipsis;
      font-family: var(--ms-serif);
      font-size: 0.8rem;
      color: var(--ms-muted);
    }

    button.ms-pill {
      flex: none;
      cursor: pointer;
      font-family: inherit;
    }

    button.ms-pill:hover:not(:disabled) {
      color: var(--ms-ink-soft);
      border-color: color-mix(in srgb, var(--ms-accent) 45%, var(--ms-border));
    }

    button.ms-pill:disabled {
      opacity: 0.45;
      cursor: default;
    }
  `,
})
export class ChapterToolbar {
  protected readonly chapters = inject(ChapterStore);
  protected readonly dialogs = inject(DialogsService);

  protected readonly label = computed(() => {
    const chapter = this.chapters.chapter();
    const title = chapterTitle(chapter);
    const state = chapter.status === 'closed' ? ' · closed' : '';
    return `Chapter ${chapter.number}${title ? ` — ${title}` : ''}${state}`;
  });
}
