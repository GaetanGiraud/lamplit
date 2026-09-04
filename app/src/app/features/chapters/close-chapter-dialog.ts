import { Component, DestroyRef, computed, inject, signal } from '@angular/core';
import { TextFieldModule } from '@angular/cdk/text-field';
import { MatButtonModule } from '@angular/material/button';
import { MatDialogModule, MatDialogRef } from '@angular/material/dialog';
import { MatExpansionModule } from '@angular/material/expansion';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { DEFAULT_SUMMARY_INSTRUCTION } from '../../core/defaults';
import { LoreProposal, entryFrom } from '../../core/lore-extraction';
import { TokenUsage } from '../../core/models';
import { formatTokens } from '../../core/tokens';
import { newId } from '../../store/documents';
import { ChapterStore } from '../../store/chapter-store';
import { StoryStore } from '../../store/story-store';
import { EditorField } from '../../shared/editor-field';
import { TextValue } from '../../shared/text-value';
import { chapterTitle } from '../../core/prompt-builder';
import { countWords } from '../../shared/editor-field';

/** What a request cost, when the provider said. Empty when it did not. */
function cost(usage: TokenUsage | undefined): string {
  if (!usage?.completionTokens) return '';
  const asked = usage.promptTokens ? `${formatTokens(usage.promptTokens)} in · ` : '';
  return `${asked}${formatTokens(usage.completionTokens)} out`;
}

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
          @if (summaryCost()) {
            · {{ summaryCost() }}
          }
        }
      </span>

      <!-- What the chapter established, as entries rather than as prose. The
           button is here whether or not the story asks for it on its own: it
           is one request, and wanting it once is not wanting it every time. -->
      <section class="proposals">
        <header>
          <span class="name">Lore from this chapter</span>
          @if (proposing()) {
            <span class="ms-hint reading"><mat-spinner diameter="14" /> Reading it…</span>
          } @else {
            <button matButton (click)="propose()">
              {{ proposed() ? 'Propose again' : 'Propose lore' }}
            </button>
          }
        </header>

        @if (loreError()) {
          <p class="ms-hint failed">{{ loreError() }}</p>
        }

        @for (proposal of proposals(); track $index) {
          <label class="proposal" [class.on]="ticked().has($index)">
            <input
              type="checkbox"
              [checked]="ticked().has($index)"
              (change)="toggle($index)"
              [attr.aria-label]="'Keep ' + proposal.title"
            />
            <div class="body">
              <span class="head">
                <span class="title">{{ proposal.title }}</span>
                <span class="category">{{ proposal.category }}</span>
                @if (proposal.updates) {
                  <span class="category update">replaces an entry</span>
                }
              </span>
              <span class="keys">
                @for (key of proposal.keys; track key) {
                  <span class="key">{{ key }}</span>
                }
              </span>
              <p class="content">{{ proposal.content }}</p>
              @if (proposal.updates; as existing) {
                <p class="was"><span class="tag">now</span>{{ existing.content }}</p>
              }
            </div>
          </label>
        } @empty {
          @if (proposed() && !loreError()) {
            <p class="ms-hint">Nothing in this chapter was worth an entry of its own.</p>
          } @else if (!proposing()) {
            <p class="ms-hint">
              Ask the model what this chapter established — people, places, facts — and tick what is
              worth keeping. Nothing is written unless you tick it.
            </p>
          }
        }

        @if (loreCost()) {
          <span class="foot ms-hint">{{ loreCost() }}</span>
        }
      </section>

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
      <button matButton (click)="cancel()">Cancel</button>
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

    /* -- the proposals --------------------------------------------------- */

    .proposals {
      display: flex;
      flex-direction: column;
      gap: 0.5rem;
      padding: 0.6rem 0.75rem 0.7rem;
      border: 1px solid var(--ms-border);
      border-radius: 12px;
    }

    .proposals header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 0.6rem;
      min-height: 2rem;
    }

    .proposals .name {
      font-family: var(--ms-sans);
      font-size: 0.85rem;
      color: var(--ms-ink-soft);
    }

    .reading {
      display: flex;
      align-items: center;
      gap: 0.4rem;
    }

    .failed {
      margin: 0;
      color: var(--ms-muted);
    }

    /* A row is the tick and what it would file. Unticked is the resting state
       for an update, so the sheet has to make the difference visible without
       shouting: a tint, not a border. */
    .proposal {
      display: flex;
      align-items: flex-start;
      gap: 0.6rem;
      padding: 0.5rem 0.6rem;
      border: 1px solid var(--ms-border);
      border-radius: 10px;
      cursor: pointer;
    }

    .proposal.on {
      border-color: color-mix(in srgb, var(--ms-accent) 45%, var(--ms-border));
      background: color-mix(in srgb, var(--ms-accent) 8%, transparent);
    }

    .proposal input {
      margin: 0.15rem 0 0;
      accent-color: var(--ms-accent);
    }

    .proposal .body {
      display: flex;
      flex-direction: column;
      gap: 0.25rem;
      min-width: 0;
    }

    .proposal .head {
      display: flex;
      align-items: baseline;
      flex-wrap: wrap;
      gap: 0.45rem;
    }

    .proposal .title {
      font-family: var(--ms-sans);
      font-size: 0.9rem;
      color: var(--ms-ink);
    }

    .category {
      padding: 0 0.35rem;
      border-radius: 999px;
      background: color-mix(in srgb, var(--ms-ink) 8%, transparent);
      font-family: var(--ms-sans);
      font-size: 0.65rem;
      letter-spacing: 0.04em;
      text-transform: uppercase;
      color: var(--ms-muted);
    }

    .keys {
      display: flex;
      flex-wrap: wrap;
      gap: 0.3rem;
    }

    .key {
      padding: 0 0.35rem;
      border: 1px solid var(--ms-border);
      border-radius: 999px;
      font-family: var(--ms-sans);
      font-size: 0.7rem;
      color: var(--ms-muted);
    }

    .proposal .content {
      margin: 0;
      font-family: var(--ms-serif);
      font-size: 0.92rem;
      line-height: 1.55;
      color: var(--ms-ink-soft);
    }

    /* What the entry says today, beside what it would say instead: an update
       overwrites, and nobody should have to remember what it overwrote. */
    .was {
      margin: 0;
      padding-left: 0.6rem;
      border-left: 2px solid color-mix(in srgb, var(--ms-muted) 40%, transparent);
      font-family: var(--ms-serif);
      font-size: 0.88rem;
      line-height: 1.5;
      color: var(--ms-muted);
    }

    .was .tag {
      margin-right: 0.4rem;
      font-family: var(--ms-sans);
      font-size: 0.65rem;
      letter-spacing: 0.04em;
      text-transform: uppercase;
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
  protected readonly summaryCost = signal('');

  /** The proposals, and which of them the writer has kept. */
  protected readonly proposals = signal<LoreProposal[]>([]);
  protected readonly ticked = signal<ReadonlySet<number>>(new Set());
  protected readonly proposing = signal(false);
  protected readonly proposed = signal(false);
  protected readonly loreError = signal('');
  protected readonly loreCost = signal('');

  protected readonly heading = computed(() => {
    const chapter = this.chapters.chapter();
    const title = chapterTitle(chapter);
    return `Chapter ${chapter.number}${title ? ` — ${title}` : ''}`;
  });

  private controller: AbortController | null = null;
  private loreController: AbortController | null = null;

  constructor() {
    inject(DestroyRef).onDestroy(() => {
      this.stop();
      this.loreController?.abort();
    });
    void this.open();
  }

  /**
   * The summary first, and then the entries if the story asks for them — in
   * that order rather than at once, because they are the same chapter read
   * twice and the second read is the one the writer can do without.
   */
  private async open(): Promise<void> {
    await this.rewrite();
    if (this.story().world.extractLore && !this.error()) await this.propose();
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
    this.summaryCost.set(cost(result.usage));
    if (result.error) this.error.set(result.error);
    // Streamed text is already in the signal; the final text wins if it differs.
    else if (result.text) this.summary.set(result.text);
  }

  /**
   * A second request, on the same chapter. A failure is a muted line and
   * nothing else: the summary is written, the close is not blocked, and a
   * chapter is not held up by a feature that is meant to save typing.
   */
  protected async propose(): Promise<void> {
    if (this.proposing()) return;
    this.loreController?.abort();
    this.loreError.set('');
    this.loreCost.set('');
    this.proposals.set([]);
    this.ticked.set(new Set());
    this.proposing.set(true);
    this.loreController = new AbortController();

    const result = await this.chapters.proposeLore(this.loreController.signal);
    this.loreController = null;
    this.proposing.set(false);
    this.proposed.set(true);
    this.loreCost.set(cost(result.usage));
    if (result.error) {
      this.loreError.set(`No entries came back: ${result.error}`);
      return;
    }
    this.proposals.set(result.proposals);
    // A new entry is additive and a mistake is one deletion away; an update
    // overwrites something the writer wrote, so it waits to be asked for.
    this.ticked.set(
      new Set(result.proposals.map((p, i) => (p.updates ? -1 : i)).filter((i) => i >= 0)),
    );
  }

  protected toggle(index: number): void {
    this.ticked.update((set) => {
      const next = new Set(set);
      if (!next.delete(index)) next.add(index);
      return next;
    });
  }

  protected stop(): void {
    this.controller?.abort();
    this.controller = null;
    this.busy.set(false);
  }

  /**
   * Backing out, with nothing written: not the chapter, not the story so far,
   * and not a single proposal. Explicitly rather than through
   * `mat-dialog-close`, whose bare form closes with an empty string — which
   * read as an answer here, and closed the chapter on a summary of nothing.
   */
  protected cancel(): void {
    this.ref.close(undefined);
  }

  protected confirm(): void {
    const summary = this.summary().trim();
    if (!summary) return;
    const kept = this.proposals().filter((_, i) => this.ticked().has(i));
    // Filed before the chapter closes, and only what was ticked. An untouched
    // sheet writes nothing at all, which is what "propose" has to mean.
    this.stories.saveLore(kept.map((proposal) => entryFrom(proposal, newId())));
    this.ref.close(summary);
  }
}
