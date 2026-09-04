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
import { TextFieldModule } from '@angular/cdk/text-field';
import { MatButtonModule } from '@angular/material/button';
import { MatMenuModule } from '@angular/material/menu';
import { MatTooltipModule } from '@angular/material/tooltip';
import { ChapterMessage } from '../../core/models';
import { renderStoryHtml } from '../../core/formatting';
import { withDirection } from '../../core/prompt-builder';
import { SpeakerLabel } from '../../core/speakers';
import { formatTokens } from '../../core/tokens';
import { TextValue } from '../../shared/text-value';

/** Both halves of a message, as an edit leaves them. */
export interface MessageEdit {
  content: string;
  direction: string;
}

/**
 * One turn. The assistant's text is set as prose across the reading column;
 * the user's lines are marked with an accent rule so a page still reads as a
 * page.
 *
 * Its actions live in the right margin, outside the column, and appear on hover
 * or focus — a page has margins so that the marks about the text are not on top
 * of it. Where there is no margin to write in, or no pointer to hover with,
 * they collapse into one ⋯ under the message instead. Neither of them is ever
 * over a word.
 */
@Component({
  selector: 'ms-message-item',
  imports: [MatButtonModule, MatMenuModule, MatTooltipModule, TextFieldModule, TextValue],
  template: `
    <article
      class="message"
      [attr.data-role]="message().role"
      [class.user]="isUser()"
      [class.failed]="!!error()"
    >
      <!-- Who is speaking, when somebody in particular is: a name and a dot in
           their colour, in the UI font, so it reads as a note in the margin
           rather than as the first words of the passage. -->
      @if (speaker(); as who) {
        <header class="speaker" [class.faded]="!who.colour" [style.color]="who.colour || null">
          <span class="dot" aria-hidden="true"></span>{{ who.name }}
        </header>
      }

      @if (editing()) {
        <div class="editor">
          <textarea
            #editor
            cdkTextareaAutosize
            cdkAutosizeMinRows="4"
            cdkAutosizeMaxRows="24"
            class="story-prose"
            [msText]="draft()"
            (input)="draft.set(text($event))"
            (keydown)="onEditorKey($event)"
          ></textarea>

          <!-- The author's half, edited as its own field: the whole point of
               keeping the two apart is that neither can eat the other. -->
          @if (message().direction) {
            <label class="direction-edit">
              <span class="tag">author</span>
              <textarea
                cdkTextareaAutosize
                cdkAutosizeMinRows="2"
                cdkAutosizeMaxRows="10"
                aria-label="The direction from the author"
                [msText]="draftDirection()"
                (input)="draftDirection.set(text($event))"
                (keydown)="onEditorKey($event)"
              ></textarea>
            </label>
          }

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
          @if (message().content) {
            <div class="story-prose" [innerHTML]="html()"></div>
          }

          <!-- The author speaking, not the persona: a note about the story
               rather than a line of it, so it is never set as prose. -->
          @if (message().direction; as direction) {
            <p class="direction"><span class="tag">author</span>{{ direction }}</p>
          }

          @if (streaming() && !message().content) {
            <p class="waiting">
              <span class="dot"></span><span class="dot"></span><span class="dot"></span>
            </p>
          }
        }

        <!-- The meta line, which is also where the actions go when there is no
             margin to put them in: never over a word, at any width. -->
        <footer class="meta" [class.bare]="!footer()">
          @if (footer()) {
            <span class="said">{{ footer() }}</span>
          }
          <button
            class="more"
            type="button"
            [matMenuTriggerFor]="actions"
            aria-label="Message actions"
          >
            <span aria-hidden="true">⋯</span>
          </button>
        </footer>

        <mat-menu #actions="matMenu">
          <button mat-menu-item (click)="startEdit()">Edit</button>
          @if (isUser()) {
            <button mat-menu-item [disabled]="busy()" (click)="replay.emit()">
              Replay from here
            </button>
          } @else if (!error()) {
            <button mat-menu-item [disabled]="busy()" (click)="regenerate.emit()">
              Regenerate
            </button>
          }
          <button mat-menu-item (click)="copy()">Copy</button>
          <button mat-menu-item (click)="remove.emit()">Delete</button>
        </mat-menu>

        <!-- The margin rail. Outside the reading column entirely, so moving the
             pointer across the page to read never hides the words under it. -->
        <div class="rail">
          <button
            class="act"
            type="button"
            (click)="startEdit()"
            matTooltip="Edit this message"
            matTooltipPosition="left"
            aria-label="Edit"
          >
            <svg viewBox="0 0 16 16" aria-hidden="true">
              <path d="M11.4 2.4a1.6 1.6 0 0 1 2.2 2.2L6 12.2l-3 .8.8-3z" />
            </svg>
          </button>

          @if (isUser()) {
            <button
              class="act"
              type="button"
              [disabled]="busy()"
              (click)="replay.emit()"
              matTooltip="Drop everything after this and send it again"
              matTooltipPosition="left"
              aria-label="Replay from here"
            >
              <svg viewBox="0 0 16 16" aria-hidden="true">
                <path d="M2.6 8a5.4 5.4 0 1 0 1.6-3.8" />
                <path d="M2.6 2.2v3.4h3.4" />
              </svg>
            </button>
          } @else if (!error()) {
            <button
              class="act"
              type="button"
              [disabled]="busy()"
              (click)="regenerate.emit()"
              matTooltip="Ask for a different answer"
              matTooltipPosition="left"
              aria-label="Regenerate"
            >
              <svg viewBox="0 0 16 16" aria-hidden="true">
                <path d="M13.4 8a5.4 5.4 0 1 1-1.6-3.8" />
                <path d="M13.4 2.2v3.4H10" />
              </svg>
            </button>
          }

          <button
            class="act"
            type="button"
            (click)="copy()"
            [matTooltip]="copied() ? 'Copied' : 'Copy the raw text'"
            matTooltipPosition="left"
            [attr.aria-label]="copied() ? 'Copied' : 'Copy'"
          >
            @if (copied()) {
              <svg viewBox="0 0 16 16" aria-hidden="true" class="done">
                <path d="M3.2 8.4 6.4 11.6 12.8 4.6" />
              </svg>
            } @else {
              <svg viewBox="0 0 16 16" aria-hidden="true">
                <rect x="5.8" y="5.8" width="7.6" height="7.6" rx="1.4" />
                <path
                  d="M10.4 3.6V3a1.4 1.4 0 0 0-1.4-1.4H4A1.4 1.4 0 0 0 2.6 3v5A1.4 1.4 0 0 0 4 9.4h.6"
                />
              </svg>
            }
          </button>

          <button
            class="act"
            type="button"
            (click)="remove.emit()"
            matTooltip="Delete this message"
            matTooltipPosition="left"
            aria-label="Delete"
          >
            <svg viewBox="0 0 16 16" aria-hidden="true">
              <path d="M2.8 4.4h10.4M6.4 4.4V3a1 1 0 0 1 1-1h1.2a1 1 0 0 1 1 1v1.4" />
              <path d="M4.4 4.4l.6 8.1a1.4 1.4 0 0 0 1.4 1.3h3.2a1.4 1.4 0 0 0 1.4-1.3l.6-8.1" />
            </svg>
          </button>
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

    /* Above the first paragraph in both dialogue settings, because it is a
       header: the prose below it starts wherever it was going to start. */
    .speaker {
      display: flex;
      align-items: center;
      gap: 0.4rem;
      margin: 0 0 0.3rem;
      font-family: var(--ms-sans);
      font-size: 0.7rem;
      font-variant-caps: all-small-caps;
      letter-spacing: 0.04em;
      line-height: 1.2;
    }

    /* The reader's own persona, and a character who is no longer in the cast:
       there is no colour to say it in, so it is said quietly. */
    .speaker.faded {
      color: var(--ms-muted);
    }

    .speaker .dot {
      flex: none;
      width: 6px;
      height: 6px;
      border-radius: 50%;
      background: currentColor;
    }

    /* Indented under the prose it belongs to, in the interface font: a note
       in the author's hand, and nothing a reader could mistake for the text. */
    .direction {
      margin: 0.55rem 0 0;
      padding-left: 0.85rem;
      border-left: 2px solid color-mix(in srgb, var(--ms-muted) 45%, transparent);
      font-family: var(--ms-sans);
      font-size: 0.85rem;
      font-style: italic;
      line-height: 1.5;
      color: var(--ms-muted);
    }

    .tag {
      display: inline-block;
      margin-right: 0.45rem;
      font-size: 0.7rem;
      font-style: normal;
      font-variant-caps: all-small-caps;
      letter-spacing: 0.06em;
      color: color-mix(in srgb, var(--ms-muted) 80%, var(--ms-ink));
    }

    .direction-edit {
      display: block;
    }

    .direction-edit .tag {
      display: block;
      margin: 0 0 0.2rem;
    }

    .direction-edit textarea {
      min-height: 3rem;
      font-family: var(--ms-sans);
      font-size: 0.9rem;
      font-style: italic;
    }

    .meta {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 0.75rem;
      margin-top: 0.55rem;
      font-family: var(--ms-sans);
      font-size: 0.7rem;
      letter-spacing: 0.02em;
      color: var(--ms-muted);
    }

    /* -- the actions ------------------------------------------------------
       Two layouts, and the narrow one is the default: a page has no margin to
       write in until it is wide enough, and a touch screen has no hover to
       reveal anything with however wide it is. The rail is switched on where
       both hold. Neither layout ever sits over the prose. */

    .more {
      flex: none;
      /* Right of whatever the line says, and right of nothing when it says
         nothing: the corner is where a reader looks for a message's own menu. */
      margin-left: auto;
      width: 1.6rem;
      height: 1.4rem;
      padding: 0;
      border: 0;
      border-radius: 6px;
      background: none;
      color: var(--ms-muted);
      font: inherit;
      font-size: 0.95rem;
      line-height: 1;
      cursor: pointer;
      opacity: 0.45;
      transition: opacity 120ms ease;
    }

    .message:hover .more,
    .message:focus-within .more,
    .more:focus-visible {
      opacity: 1;
      color: var(--ms-ink-soft);
    }

    .rail {
      display: none;
      position: absolute;
      top: 0.75rem;
      /* Right of the column by the gap, and padded back across it, so the
         pointer never leaves the message on its way to the icons. */
      right: calc(-1 * (var(--ms-rail) + var(--ms-margin-gap)));
      padding-left: var(--ms-margin-gap);
      flex-direction: column;
      gap: 0.1rem;
      opacity: 0;
      transform: translateX(-0.2rem);
      transition:
        opacity 120ms ease,
        transform 120ms ease;
      pointer-events: none;
    }

    .message:hover .rail,
    .message:focus-within .rail {
      opacity: 1;
      transform: none;
      pointer-events: auto;
    }

    .act {
      display: flex;
      align-items: center;
      justify-content: center;
      width: var(--ms-rail);
      height: var(--ms-rail);
      padding: 0;
      border: 0;
      border-radius: 8px;
      background: none;
      color: var(--ms-muted);
      cursor: pointer;
    }

    .act:hover:not(:disabled),
    .act:focus-visible {
      color: var(--ms-ink);
      background: color-mix(in srgb, var(--ms-ink) 8%, transparent);
    }

    .act:disabled {
      opacity: 0.35;
      cursor: default;
    }

    .act svg {
      width: 1rem;
      height: 1rem;
      fill: none;
      stroke: currentColor;
      stroke-width: 1.4;
      stroke-linecap: round;
      stroke-linejoin: round;
    }

    .act svg.done {
      stroke: light-dark(#2f8f5b, #6fd39b);
      stroke-width: 1.8;
    }

    /* Wide enough for a margin, and a pointer that can hover into it: the
       measure plus a rail and a gap on each side, with room to breathe. */
    @media (min-width: 42rem) and (hover: hover) {
      .rail {
        display: flex;
      }

      .more {
        display: none;
      }

      /* Nothing left in it: back to a line that only appears when it says
         something, which is what it did before the actions moved. */
      .meta.bare {
        display: none;
      }
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
      resize: none;
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

      .rail,
      .more {
        transition: none;
      }
    }
  `,
})
export class MessageItem {
  readonly message = input.required<ChapterMessage>();
  readonly streaming = input(false);
  /** True while any turn is in flight: regenerate and replay must wait. */
  readonly busy = input(false);
  readonly bookStyle = input(true);
  readonly showTokens = input(true);
  /** Whose turn this is, when the page has a name for it. */
  readonly speaker = input<SpeakerLabel | null>(null);

  readonly edited = output<MessageEdit>();
  readonly remove = output<void>();
  readonly regenerate = output<void>();
  readonly replay = output<void>();

  private readonly sanitizer = inject(DomSanitizer);
  private readonly editorRef = viewChild<ElementRef<HTMLTextAreaElement>>('editor');

  protected readonly editing = signal(false);
  protected readonly draft = signal('');
  protected readonly draftDirection = signal('');
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
    this.draftDirection.set(this.message().direction ?? '');
    this.editing.set(true);
  }

  protected cancelEdit(): void {
    this.editing.set(false);
  }

  protected saveEdit(): void {
    const content = this.draft().trim();
    const direction = this.draftDirection().trim();
    this.editing.set(false);
    // Either half may be emptied, but not both: a message with nothing left in
    // it is a deletion, and there is a menu item that says so.
    if (!content && !direction) return;
    const message = this.message();
    if (content === message.content && direction === (message.direction ?? '')) return;
    this.edited.emit({ content, direction });
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
      // What was sent, direction and all: a message whose only content is a
      // direction would otherwise copy nothing at all.
      await navigator.clipboard.writeText(
        withDirection(this.message().content, this.message().direction),
      );
      this.copied.set(true);
      setTimeout(() => this.copied.set(false), 1200);
    } catch {
      /* clipboard blocked; nothing useful to say about it */
    }
  }
}
