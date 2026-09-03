import { Component, computed, inject } from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { MAT_DIALOG_DATA, MatDialogModule } from '@angular/material/dialog';
import { ChapterStore } from '../../store/chapter-store';
import { StoryStore } from '../../store/story-store';
import { formatTokens } from '../../core/tokens';

export interface PromptPreviewData {
  draft: string;
}

/**
 * The whole prompt, block by block, with what each one costs and which lore
 * fired on which key. One click from the composer, and it replaces most of
 * what a prompt manager is for.
 */
@Component({
  selector: 'ms-prompt-preview-dialog',
  imports: [MatButtonModule, MatDialogModule],
  template: `
    <h2 mat-dialog-title class="ms-dialog-title">What the model sees</h2>

    <mat-dialog-content>
      <p class="ms-hint">
        Rebuilt from the story, the chapter and its messages every time you send.
        {{ totals() }}
      </p>

      @for (block of prompt().blocks; track block.id) {
        <section class="block">
          <header>
            <span class="name">{{ block.label }}</span>
            <span class="tokens">{{ format(block.tokens) }}</span>
          </header>
          <pre>{{ block.content }}</pre>
        </section>
      }

      <section class="block">
        <header>
          <span class="name">Lore</span>
          <span class="tokens">{{ prompt().lore.length }} active</span>
        </header>
        @if (prompt().lore.length) {
          <ul class="lore">
            @for (hit of prompt().lore; track hit.entry.id) {
              <li>
                <strong>{{ hit.entry.title || 'Untitled entry' }}</strong>
                @if (hit.key) {
                  fired on “{{ hit.key }}” in the {{ hit.where }}
                } @else {
                  is always on
                }
              </li>
            }
          </ul>
        } @else {
          <p class="ms-hint empty">
            Nothing matched the scene, the last messages or what you are typing.
          </p>
        }
        @if (unwritten()) {
          <p class="ms-hint empty warn">
            {{ unwritten() }}
            {{ unwritten() === 1 ? 'entry has' : 'entries have' }} no text yet, so
            {{ unwritten() === 1 ? 'it' : 'they' }} cannot fire. Write them in World.
          </p>
        }
      </section>

      <section class="block">
        <header>
          <span class="name">This chapter</span>
          <span class="tokens">{{ format(prompt().tokens.history) }}</span>
        </header>
        <p class="ms-hint empty">
          {{ sent() }} messages sent
          @if (prompt().dropped) {
            · {{ prompt().dropped }} older left out to fit the budget
          }
        </p>
      </section>

      @if (data.draft.trim()) {
        <section class="block">
          <header>
            <span class="name">Your next message</span>
            <span class="tokens">{{ format(prompt().tokens.draft) }}</span>
          </header>
          <pre>{{ data.draft }}</pre>
        </section>
      }
    </mat-dialog-content>

    <mat-dialog-actions align="end">
      <button matButton (click)="copy()">Copy it all</button>
      <button matButton="filled" mat-dialog-close>Done</button>
    </mat-dialog-actions>
  `,
  styles: `
    mat-dialog-content {
      max-height: min(74vh, 44rem) !important;
    }

    .block {
      margin: 0.6rem 0 0;
      border: 1px solid var(--ms-border);
      border-radius: 10px;
      background: var(--ms-surface-raised);
      overflow: hidden;
    }

    header {
      display: flex;
      align-items: baseline;
      justify-content: space-between;
      gap: 1rem;
      padding: 0.4rem 0.7rem;
      border-bottom: 1px solid var(--ms-border);
      background: color-mix(in srgb, var(--ms-accent) 6%, transparent);
    }

    .name {
      font-size: 0.78rem;
      letter-spacing: 0.03em;
      text-transform: uppercase;
      color: var(--ms-ink-soft);
    }

    .tokens {
      font-size: 0.72rem;
      color: var(--ms-muted);
    }

    pre {
      margin: 0;
      padding: 0.65rem 0.75rem;
      white-space: pre-wrap;
      overflow-wrap: break-word;
      font-family: var(--ms-serif);
      font-size: 0.9rem;
      line-height: 1.55;
      color: var(--ms-ink);
    }

    .lore {
      margin: 0;
      padding: 0.5rem 0.75rem 0.6rem 1.6rem;
      font-size: 0.85rem;
      line-height: 1.6;
      color: var(--ms-ink-soft);
    }

    .empty {
      margin: 0;
      padding: 0.5rem 0.75rem;
    }

    .warn {
      color: var(--ms-danger);
    }
  `,
})
export class PromptPreviewDialog {
  protected readonly data = inject<PromptPreviewData>(MAT_DIALOG_DATA);
  private readonly chapters = inject(ChapterStore);
  private readonly stories = inject(StoryStore);

  protected readonly prompt = computed(() => this.chapters.preview(this.data.draft));

  /** An entry with nothing written in it can never join a prompt: say so. */
  protected readonly unwritten = computed(
    () => this.stories.story().world.entries.filter((e) => e.enabled && !e.content.trim()).length,
  );

  protected readonly sent = computed(
    () =>
      this.prompt().messages.filter((m) => m.role !== 'system').length -
      (this.data.draft.trim() ? 1 : 0),
  );

  protected readonly totals = computed(() => {
    const { total, budget, reserve } = this.prompt().tokens;
    return `${formatTokens(total)} of ${formatTokens(budget)} tokens, with ${formatTokens(reserve)} held back for the reply.`;
  });

  protected format(tokens: number): string {
    return `${formatTokens(tokens)} tokens`;
  }

  protected async copy(): Promise<void> {
    const text = this.prompt()
      .messages.map((m) => `[${m.role}]\n${m.content}`)
      .join('\n\n');
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      /* clipboard blocked; nothing useful to say about it */
    }
  }
}
