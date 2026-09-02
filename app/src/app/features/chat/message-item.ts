import {
  Component,
  ElementRef,
  computed,
  effect,
  inject,
  input,
  output,
  signal,
  viewChild,
} from '@angular/core';
import { DomSanitizer } from '@angular/platform-browser';
import { MatButtonModule } from '@angular/material/button';
import { MatTooltipModule } from '@angular/material/tooltip';
import { ChatMessage } from '../../core/models';
import { renderStoryHtml } from '../../core/formatting';
import { formatTokens } from '../../core/tokens';

/**
 * One turn. The assistant's text is set as prose across the reading column;
 * the user's lines are marked with an accent rule so a page still reads as a
 * page. Actions live in a toolbar that only appears on hover or focus.
 */
@Component({
  selector: 'ms-message-item',
  imports: [MatButtonModule, MatTooltipModule],
  template: `
    <article
      class="message"
      [attr.data-role]="message().role"
      [class.user]="isUser()"
      [class.failed]="!!error()"
    >
      @if (editing()) {
        <div class="editor">
          <textarea
            #editor
            class="story-prose"
            [value]="draft()"
            (input)="draft.set(text($event))"
            (keydown)="onEditorKey($event)"
          ></textarea>
          <div class="editor-actions">
            <span class="ms-hint">Ctrl+Enter saves, Escape cancels.</span>
            <button matButton (click)="cancelEdit()">Cancel</button>
            <button matButton="filled" (click)="saveEdit()">Save</button>
          </div>
        </div>
      } @else {
        @if (error()) {
          <p class="error">{{ error() }}</p>
          <div class="error-actions">
            <button matButton="outlined" (click)="regenerate.emit()">Try again</button>
            <button matButton (click)="remove.emit()">Dismiss</button>
          </div>
        } @else {
          <div class="story-prose" [innerHTML]="html()"></div>
          @if (streaming() && !message().content) {
            <p class="waiting">
              <span class="dot"></span><span class="dot"></span><span class="dot"></span>
            </p>
          }
        }

        @if (footer()) {
          <footer class="meta">{{ footer() }}</footer>
        }

        <div class="toolbar">
          <button matButton (click)="startEdit()" matTooltip="Edit this message">Edit</button>
          @if (isUser()) {
            <button
              matButton
              [disabled]="busy()"
              (click)="replay.emit()"
              matTooltip="Drop everything after this and send it again"
            >
              Replay from here
            </button>
          } @else if (!error()) {
            <button
              matButton
              [disabled]="busy()"
              (click)="regenerate.emit()"
              matTooltip="Ask for a different answer"
            >
              Regenerate
            </button>
          }
          <button matButton (click)="copy()">{{ copied() ? 'Copied' : 'Copy' }}</button>
          <button matButton (click)="remove.emit()">Delete</button>
        </div>
      }
    </article>
  `,
  styles: `
    .message {
      position: relative;
      padding: 0.9rem 0 1.1rem;
    }

    .message + .message {
      border-top: 1px solid color-mix(in srgb, var(--ms-border) 55%, transparent);
    }

    .message.user {
      padding-left: 0.95rem;
      border-left: 2px solid color-mix(in srgb, var(--ms-accent) 55%, transparent);
    }

    .message.user .story-prose {
      color: var(--ms-ink-soft);
    }

    /* Keep the user's own block one tone; the italics still set actions apart. */
    .message.user .story-prose .action,
    .message.user .story-prose em {
      color: inherit;
    }

    .meta {
      margin-top: 0.55rem;
      font-family: var(--ms-sans);
      font-size: 0.7rem;
      letter-spacing: 0.02em;
      color: var(--ms-muted);
    }

    .toolbar {
      position: absolute;
      top: 0.2rem;
      right: 0;
      display: flex;
      gap: 0.1rem;
      padding: 0.1rem;
      border: 1px solid var(--ms-border);
      border-radius: 999px;
      background: var(--ms-surface-raised);
      box-shadow: 0 6px 18px light-dark(rgb(0 0 0 / 8%), rgb(0 0 0 / 35%));
      opacity: 0;
      transform: translateY(-0.2rem);
      transition:
        opacity 120ms ease,
        transform 120ms ease;
      pointer-events: none;
    }

    .message:hover .toolbar,
    .message:focus-within .toolbar {
      opacity: 1;
      transform: none;
      pointer-events: auto;
    }

    .toolbar button {
      --mat-button-text-label-text-size: 0.72rem;
      min-width: 0;
      padding: 0 0.55rem;
      height: 1.75rem;
      color: var(--ms-muted);
    }

    .error {
      margin: 0;
      padding: 0.7rem 0.9rem;
      border: 1px solid color-mix(in srgb, var(--ms-danger) 40%, var(--ms-border));
      border-radius: 10px;
      background: color-mix(in srgb, var(--ms-danger) 8%, transparent);
      color: var(--ms-danger);
      font-size: 0.85rem;
      line-height: 1.5;
    }

    .error-actions {
      display: flex;
      gap: 0.3rem;
      margin-top: 0.4rem;
    }

    .editor {
      display: flex;
      flex-direction: column;
      gap: 0.5rem;
    }

    textarea {
      width: 100%;
      min-height: 6rem;
      padding: 0.7rem 0.85rem;
      border: 1px solid var(--ms-accent);
      border-radius: 10px;
      background: var(--ms-surface-raised);
      color: var(--ms-ink);
      resize: vertical;
      field-sizing: content;
    }

    .editor-actions {
      display: flex;
      align-items: center;
      justify-content: flex-end;
      gap: 0.4rem;
    }

    .editor-actions .ms-hint {
      margin-right: auto;
    }

    .waiting {
      display: flex;
      gap: 0.3rem;
      margin: 0.25rem 0 0;
    }

    .waiting .dot {
      width: 6px;
      height: 6px;
      border-radius: 50%;
      background: var(--ms-muted);
      animation: pulse 1.1s infinite ease-in-out;
    }

    .waiting .dot:nth-child(2) {
      animation-delay: 0.15s;
    }

    .waiting .dot:nth-child(3) {
      animation-delay: 0.3s;
    }

    @keyframes pulse {
      0%,
      80%,
      100% {
        opacity: 0.25;
      }
      40% {
        opacity: 1;
      }
    }

    @media (prefers-reduced-motion: reduce) {
      .waiting .dot {
        animation: none;
        opacity: 0.5;
      }

      .toolbar {
        transition: none;
      }
    }
  `,
})
export class MessageItem {
  readonly message = input.required<ChatMessage>();
  readonly streaming = input(false);
  /** True while any turn is in flight: regenerate and replay must wait. */
  readonly busy = input(false);
  readonly bookStyle = input(true);
  readonly showTokens = input(true);

  readonly edited = output<string>();
  readonly remove = output<void>();
  readonly regenerate = output<void>();
  readonly replay = output<void>();

  private readonly sanitizer = inject(DomSanitizer);
  private readonly editorRef = viewChild<ElementRef<HTMLTextAreaElement>>('editor');

  protected readonly editing = signal(false);
  protected readonly draft = signal('');
  protected readonly copied = signal(false);

  protected readonly isUser = computed(() => this.message().role === 'user');
  protected readonly error = computed(() => this.message().meta?.error);

  /**
   * Already sanitised by DOMPurify against an explicit allowlist in
   * `renderStoryHtml`, so Angular's own pass would only strip our markers.
   */
  protected readonly html = computed(() =>
    this.sanitizer.bypassSecurityTrustHtml(
      renderStoryHtml(this.message().content, { bookStyleDialogue: this.bookStyle() }),
    ),
  );

  protected readonly footer = computed(() => {
    const message = this.message();
    if (message.role !== 'assistant' || this.streaming() || this.error()) return '';
    const meta = message.meta;
    if (!meta) return '';

    const parts: string[] = [];
    if (meta.model) parts.push(meta.model);
    if (this.showTokens() && meta.completionTokens) {
      const prompt = meta.promptTokens ? `${formatTokens(meta.promptTokens)} in · ` : '';
      parts.push(`${prompt}${formatTokens(meta.completionTokens)} out`);
    }
    if (meta.aborted) parts.push('stopped');
    else if (meta.finishReason === 'length') parts.push('cut off at the reply limit');
    if (message.editedAt) parts.push('edited');
    return parts.join('  ·  ');
  });

  constructor() {
    effect(() => {
      if (!this.editing()) return;
      const element = this.editorRef()?.nativeElement;
      if (!element) return;
      element.focus();
      element.setSelectionRange(element.value.length, element.value.length);
    });
  }

  protected text(event: Event): string {
    return (event.target as HTMLTextAreaElement).value;
  }

  protected startEdit(): void {
    this.draft.set(this.message().content);
    this.editing.set(true);
  }

  protected cancelEdit(): void {
    this.editing.set(false);
  }

  protected saveEdit(): void {
    const content = this.draft().trim();
    this.editing.set(false);
    if (content && content !== this.message().content) this.edited.emit(content);
  }

  protected onEditorKey(event: KeyboardEvent): void {
    if (event.key === 'Escape') {
      event.stopPropagation();
      this.cancelEdit();
    } else if (event.key === 'Enter' && (event.ctrlKey || event.metaKey)) {
      event.preventDefault();
      // Otherwise the global Ctrl+Enter would regenerate as well.
      event.stopPropagation();
      this.saveEdit();
    }
  }

  protected async copy(): Promise<void> {
    try {
      await navigator.clipboard.writeText(this.message().content);
      this.copied.set(true);
      setTimeout(() => this.copied.set(false), 1200);
    } catch {
      /* clipboard blocked; nothing useful to say about it */
    }
  }
}
