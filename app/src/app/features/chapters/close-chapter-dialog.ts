import { Component, DestroyRef, computed, inject, signal } from '@angular/core';
import { TextFieldModule } from '@angular/cdk/text-field';
import { MatButtonModule } from '@angular/material/button';
import { MatDialogModule, MatDialogRef } from '@angular/material/dialog';
import { MatExpansionModule } from '@angular/material/expansion';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { DEFAULT_SUMMARY_INSTRUCTION } from '../../core/defaults';
import { ChapterStore } from '../../store/chapter-store';
import { StoryStore } from '../../store/story-store';
import { EditorField } from '../../shared/editor-field';
import { TextValue } from '../../shared/text-value';
import { chapterTitle } from '../../core/prompt-builder';
import { countWords } from '../../shared/editor-field';

/**
 * Close chapter: the model writes the summary, the writer edits it, and it
 * joins the story so far. The chapter itself is kept either way — nothing here
 * discards anything.
 */
@Component({
  selector: 'ms-close-chapter-dialog',
  imports: [
    MatButtonModule,
    MatDialogModule,
    MatExpansionModule,
    MatProgressSpinnerModule,
    TextFieldModule,
    EditorField,
    TextValue,
  ],
  template: `
    <h2 mat-dialog-title class="ms-dialog-title">Close {{ heading() }}</h2>

    <mat-dialog-content>
      <p class="ms-hint">
        This is the whole story so far, rewritten to include the chapter just finished — it replaces
        what was there rather than being added to it. Confirming closes this chapter and opens the
        next one's scene; the chapter itself stays in the Chapters list, readable, and can be
        continued later.
      </p>

      @if (error()) {
        <p class="error">{{ error() }}</p>
      }

      <textarea
        cdkTextareaAutosize
        cdkAutosizeMinRows="8"
        cdkAutosizeMaxRows="20"
        [msText]="summary()"
        [readonly]="busy()"
        [placeholder]="
          busy() ? 'Writing the summary…' : 'Write what this chapter should be remembered for.'
        "
        (input)="summary.set(text($event))"
      ></textarea>

      <span class="foot ms-hint">
        @if (busy()) {
          <mat-spinner diameter="14" />
          Writing…
        } @else {
          {{ words() }} words
        }
      </span>

      <mat-expansion-panel class="instruction">
        <mat-expansion-panel-header>
          <mat-panel-title>What was asked for</mat-panel-title>
          <mat-panel-description>
            {{ story().world.summary.useDefault ? 'default instruction' : 'your own instruction' }}
          </mat-panel-description>
        </mat-expansion-panel-header>

        @if (story().world.summary.useDefault) {
          <p class="preset">{{ defaultInstruction }}</p>
          <button matButton="outlined" (click)="override()">Write my own</button>
        } @else {
          <ms-editor-field
            label="Instruction"
            [rows]="5"
            [value]="story().world.summary.prompt"
            (save)="stories.setSummaryPrompt({ prompt: $event })"
          />
          <button matButton (click)="restoreDefault()">Back to the default</button>
        }
        <p class="ms-hint">
          Saved with the story, and used every time a chapter is closed. Change it and write the
          summary again to see the difference.
        </p>
      </mat-expansion-panel>
    </mat-dialog-content>

    <mat-dialog-actions align="end">
      <button matButton mat-dialog-close>Cancel</button>
      @if (!busy()) {
        <button matButton (click)="rewrite()">Write it again</button>
      } @else {
        <button matButton (click)="stop()">Stop</button>
      }
      <button matButton="filled" [disabled]="busy() || !summary().trim()" (click)="confirm()">
        Close the chapter
      </button>
    </mat-dialog-actions>
  `,
  styles: `
    /* A chapter named after a long opening line must not wrap the header. */
    h2 {
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }

    mat-dialog-content {
      display: flex;
      flex-direction: column;
      gap: 0.5rem;
      padding-top: 0.25rem !important;
    }

    /* A scrolling column, not a squashing one: without this the children are
       shrunk to fit instead of the content scrolling, and an autosizing
       textarea is drawn shorter than the height it asked for. */
    mat-dialog-content > * {
      flex: none;
    }

    textarea {
      width: 100%;
      padding: 0.8rem 0.95rem;
      border: 1px solid var(--ms-border);
      border-radius: 10px;
      background: var(--ms-surface-raised);
      color: var(--ms-ink);
      font-family: var(--ms-serif);
      font-size: 1rem;
      line-height: 1.6;
      resize: none;
    }

    textarea:focus {
      outline: none;
      border-color: color-mix(in srgb, var(--ms-accent) 65%, var(--ms-border));
    }

    .foot {
      display: flex;
      align-items: center;
      gap: 0.4rem;
    }

    .instruction {
      background: transparent !important;
      border: 1px solid var(--ms-border);
      border-radius: 12px !important;
    }

    mat-panel-description {
      flex: none;
      color: var(--ms-muted);
      font-size: 0.8rem;
    }

    .preset {
      margin: 0 0 0.6rem;
      padding: 0.7rem 0.85rem;
      border: 1px dashed var(--ms-border);
      border-radius: 10px;
      font-family: var(--ms-serif);
      font-size: 0.9rem;
      line-height: 1.6;
      color: var(--ms-ink-soft);
    }

    .error {
      margin: 0;
      padding: 0.6rem 0.8rem;
      border: 1px solid color-mix(in srgb, var(--ms-danger) 40%, var(--ms-border));
      border-radius: 10px;
      color: var(--ms-danger);
      font-size: 0.85rem;
      line-height: 1.5;
    }
  `,
})
export class CloseChapterDialog {
  private readonly ref = inject(MatDialogRef<CloseChapterDialog, string | undefined>);
  private readonly chapters = inject(ChapterStore);
  protected readonly stories = inject(StoryStore);
  protected readonly story = this.stories.story;
  protected readonly defaultInstruction = DEFAULT_SUMMARY_INSTRUCTION;

  protected readonly summary = signal('');
  protected readonly busy = signal(false);
  protected readonly error = signal('');
  protected readonly words = computed(() => countWords(this.summary()));

  protected readonly heading = computed(() => {
    const chapter = this.chapters.chapter();
    const title = chapterTitle(chapter);
    return `Chapter ${chapter.number}${title ? ` — ${title}` : ''}`;
  });

  private controller: AbortController | null = null;

  constructor() {
    inject(DestroyRef).onDestroy(() => this.stop());
    void this.rewrite();
  }

  protected override(): void {
    this.stories.setSummaryPrompt({ useDefault: false, prompt: DEFAULT_SUMMARY_INSTRUCTION });
  }

  protected restoreDefault(): void {
    this.stories.setSummaryPrompt({ useDefault: true });
  }

  protected text(event: Event): string {
    return (event.target as HTMLTextAreaElement).value;
  }

  protected async rewrite(): Promise<void> {
    this.stop();
    this.summary.set('');
    this.error.set('');
    this.busy.set(true);
    this.controller = new AbortController();
    const result = await this.chapters.summarise(
      (delta) => this.summary.update((text) => text + delta),
      this.controller.signal,
    );
    this.busy.set(false);
    this.controller = null;
    if (result.error) this.error.set(result.error);
    // Streamed text is already in the signal; the final text wins if it differs.
    else if (result.text) this.summary.set(result.text);
  }

  protected stop(): void {
    this.controller?.abort();
    this.controller = null;
    this.busy.set(false);
  }

  protected confirm(): void {
    const summary = this.summary().trim();
    if (!summary) return;
    this.ref.close(summary);
  }
}
