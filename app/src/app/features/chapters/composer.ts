import {
  Component,
  ElementRef,
  Injector,
  afterNextRender,
  computed,
  inject,
  output,
  signal,
  viewChild,
} from '@angular/core';
import { CdkTextareaAutosize, TextFieldModule } from '@angular/cdk/text-field';
import { MatButtonModule } from '@angular/material/button';
import { MatTooltipModule } from '@angular/material/tooltip';
import { ChapterStore } from '../../store/chapter-store';
import { SettingsStore } from '../../store/settings-store';
import { withDirection } from '../../core/prompt-builder';
import { TOKEN_ESTIMATOR, formatTokens } from '../../core/tokens';
import { DialogsService } from '../../shared/dialogs.service';
import { TextValue } from '../../shared/text-value';

/**
 * The end of the page: what happens next, written where the reading stopped.
 *
 * It is in the page's scroller rather than docked under it, so it is on screen
 * for anyone who has read to the end and out of the way of anyone who has not.
 * Which is why it also listens for a key pressed with nothing focused: a writer
 * who finished reading half a page up should not have to go and find the box.
 */
@Component({
  selector: 'ms-composer',
  imports: [MatButtonModule, MatTooltipModule, TextFieldModule, TextValue],
  host: {
    '(document:keydown)': 'onDocumentKey($event)',
  },
  template: `
    <div class="dock">
      <div class="column">
        <!-- A chapter that cannot be written into gets the reason and the way
             out of it, rather than a box that refuses what is typed into it. -->
        @if (chapters.writeBlock(); as blocked) {
          @if (blocked.action) {
            <button matButton="outlined" class="blocked" (click)="unblock()">
              {{ blocked.reason }} — {{ blockedAction() }}
            </button>
          } @else {
            <div class="box">
              <div class="field">
                <textarea
                  #input
                  cdkTextareaAutosize
                  cdkAutosizeMinRows="3"
                  cdkAutosizeMaxRows="14"
                  [msText]="draft()"
                  [placeholder]="placeholder()"
                  (input)="onInput($event)"
                  (keydown)="onKey($event)"
                ></textarea>

                <div class="buttons">
                  @if (chapters.isStreaming()) {
                    <button matButton="filled" class="stop" (click)="chapters.stop()">Stop</button>
                  } @else {
                    <button
                      class="author"
                      type="button"
                      [class.on]="authoring()"
                      [attr.aria-pressed]="authoring()"
                      (click)="toggleAuthor()"
                      [matTooltip]="authorTooltip()"
                    >
                      Author
                    </button>
                    <button
                      matButton="filled"
                      class="send"
                      [disabled]="!canSend()"
                      (click)="send()"
                      matTooltip="Enter to send, Shift+Enter for a new line"
                    >
                      Send
                    </button>
                  }
                </div>
              </div>

              <!-- The author's own field, under the persona's words and inside
                   the same box: one message in two voices, and the split can be
                   read before it is sent rather than discovered afterwards. -->
              @if (authoring()) {
                <div class="direction">
                  <span class="tag">author</span>
                  <textarea
                    #directionInput
                    cdkTextareaAutosize
                    cdkAutosizeMinRows="1"
                    cdkAutosizeMaxRows="8"
                    aria-label="A direction from the author"
                    placeholder="Where the story goes. The model follows it and never mentions it."
                    [msText]="direction()"
                    (input)="direction.set(text($event))"
                    (keydown)="onKey($event)"
                  ></textarea>
                </div>
              }
            </div>

            <!-- The pill is developer mode's; the trimming note is everyone's,
                 because a chapter quietly dropping its own beginning is
                 something the writer has to be told about either way. -->
            @if (settings.ui().developerMode || prompt().dropped > 0) {
              <div class="strip">
                @if (settings.ui().developerMode) {
                  <button
                    class="ms-pill"
                    type="button"
                    (click)="dialogs.openPromptPreview(draft(), direction())"
                    [matTooltip]="contextTooltip"
                  >
                    context {{ contextLabel() }}
                  </button>
                }
                @if (prompt().dropped > 0) {
                  <span class="ms-hint">
                    {{ prompt().dropped }} older
                    {{ prompt().dropped === 1 ? 'message' : 'messages' }} left out
                  </span>
                }
              </div>
            }
          }
        }
      </div>
    </div>
  `,
  styles: `
    /* Part of the page now, not a shelf over it: no rule, no tint and nothing
       blurred behind it, because there is nothing behind it. The box draws its
       own border and that is the whole of the furniture. */
    .dock {
      padding: 0.2rem 0 0;
    }

    .column {
      width: min(var(--ms-measure), calc(100% - 2.5rem));
      margin: 0 auto;
      display: flex;
      flex-direction: column;
      gap: 0.45rem;
    }

    .blocked {
      align-self: center;
      color: var(--ms-accent);
    }

    .box {
      padding: 0.45rem 0.45rem 0.45rem 0.85rem;
      border: 1px solid var(--ms-border);
      border-radius: var(--ms-radius);
      background: var(--ms-surface-raised);
      transition: border-color 120ms ease;
    }

    .box:focus-within {
      border-color: color-mix(in srgb, var(--ms-accent) 65%, var(--ms-border));
    }

    .field {
      display: flex;
      align-items: flex-end;
      gap: 0.5rem;
    }

    .buttons {
      flex: none;
      display: flex;
      align-items: center;
      gap: 0.3rem;
    }

    /* Under the box, sharing its border, so the two fields read as one message
       in two voices rather than as two things to fill in. */
    .direction {
      display: flex;
      align-items: baseline;
      gap: 0.5rem;
      margin-top: 0.35rem;
      padding-top: 0.4rem;
      border-top: 1px solid color-mix(in srgb, var(--ms-border) 70%, transparent);
    }

    .direction .tag {
      flex: none;
      font-family: var(--ms-sans);
      font-size: 0.7rem;
      font-variant-caps: all-small-caps;
      letter-spacing: 0.06em;
      color: var(--ms-muted);
    }

    .direction textarea {
      font-family: var(--ms-sans);
      font-size: 0.9rem;
      font-style: italic;
      color: var(--ms-ink-soft);
      padding: 0;
    }

    /* A quiet word beside Send, lit when the field is open. */
    .author {
      padding: 0.3rem 0.55rem;
      border: 1px solid transparent;
      border-radius: 999px;
      background: none;
      color: var(--ms-muted);
      font-family: var(--ms-sans);
      font-size: 0.75rem;
      letter-spacing: 0.02em;
      cursor: pointer;
    }

    .author:hover,
    .author:focus-visible {
      color: var(--ms-ink-soft);
      border-color: var(--ms-border);
    }

    .author.on {
      border-color: color-mix(in srgb, var(--ms-accent) 55%, var(--ms-border));
      background: color-mix(in srgb, var(--ms-accent) 12%, transparent);
      color: var(--ms-accent);
    }

    textarea {
      flex: 1;
      min-width: 0;
      border: 0;
      outline: none;
      resize: none;
      background: none;
      color: var(--ms-ink);
      font-family: var(--ms-serif);
      font-size: 1rem;
      line-height: 1.55;
      padding: 0.35rem 0;
    }

    textarea::placeholder {
      color: var(--ms-muted);
    }

    .send,
    .stop {
      flex: none;
    }

    .strip {
      display: flex;
      align-items: center;
      gap: 0.6rem;
      min-height: 1.2rem;
    }

    button.ms-pill {
      cursor: pointer;
      font-family: inherit;
    }

    button.ms-pill:hover {
      color: var(--ms-ink-soft);
    }
  `,
})
export class Composer {
  protected readonly chapters = inject(ChapterStore);
  protected readonly settings = inject(SettingsStore);
  protected readonly dialogs = inject(DialogsService);

  // Not `required`: a chapter with no scene, no connection or a closed status
  // has the reason and the way out of it where the box would be, and the
  // document-wide key listener runs on those pages too.
  private readonly input = viewChild<ElementRef<HTMLTextAreaElement>>('input');
  private readonly directionInput = viewChild<ElementRef<HTMLTextAreaElement>>('directionInput');
  private readonly autosize = viewChild(CdkTextareaAutosize);
  private readonly injector = inject(Injector);

  /** The page is asked to bring its end into view; only it knows where that is. */
  readonly startedTyping = output<void>();

  private readonly estimator = inject(TOKEN_ESTIMATOR);

  protected readonly draft = signal('');
  /** The author's half, when there is one. Empty is not the same as closed. */
  protected readonly direction = signal('');
  protected readonly authoring = signal(false);

  /**
   * The prompt without the draft, which is everything expensive: the lore scan
   * and the token count of every message. It depends on the story and the
   * chapter, not on what is being typed, so a keystroke costs one string
   * measurement rather than a rebuild of the whole request.
   */
  protected readonly prompt = computed(() => this.chapters.preview());

  protected readonly contextLabel = computed(() => {
    const { total, budget } = this.prompt().tokens;
    const content = withDirection(this.draft(), this.direction());
    const draft = this.estimator.countMessages([{ role: 'user', content }]);
    return `${formatTokens(total + draft)} / ${formatTokens(budget)}`;
  });

  protected readonly contextTooltip = 'Everything this request will send. Click to read it.';

  protected readonly canSend = computed(
    () =>
      !!(this.draft().trim() || this.direction().trim()) &&
      !this.chapters.isStreaming() &&
      this.chapters.canWrite(),
  );

  protected readonly authorTooltip = computed(() =>
    this.authoring()
      ? 'Close it. Whatever is in it is thrown away.'
      : 'Say it as the author: an instruction the model follows and never mentions.',
  );

  /** The way out of whatever is keeping the composer shut. */
  protected readonly blockedAction = computed(() => {
    switch (this.chapters.writeBlock().action) {
      case 'scene':
        return 'write it';
      case 'continue':
        return 'continue it';
      case 'connection':
        return 'open Connection';
      default:
        return '';
    }
  });

  protected readonly placeholder = computed(() =>
    this.chapters.isEmpty() ? 'The chapter opens. What do you do?' : 'What happens next?',
  );

  protected text(event: Event): string {
    return (event.target as HTMLTextAreaElement).value;
  }

  /**
   * `[AUTHOR]` at the start of a line takes that line and everything after it
   * out of the prose and into the author's field, tag and all.
   *
   * It is a shorthand for the button beside Send rather than a syntax: the
   * split happens as it is typed and is shown, so what leaves the composer is
   * always what the writer can see in it.
   */
  protected onInput(event: Event): void {
    const typed = this.text(event);
    const match = /^[ \t]*\[author\][ \t]*/im.exec(typed);
    if (!match) {
      this.draft.set(typed);
      return;
    }

    const prose = typed.slice(0, match.index).replace(/\s+$/, '');
    const said = typed.slice(match.index + match[0].length).trim();
    const already = this.direction().trim();

    this.draft.set(prose);
    this.setInput(prose);
    this.direction.set(already && said ? `${already}\n${said}` : already || said);
    this.authoring.set(true);
    this.focusDirection();
  }

  /** Opens the author's field, or closes it and drops what was in it. */
  protected toggleAuthor(): void {
    const open = !this.authoring();
    this.authoring.set(open);
    if (open) this.focusDirection();
    else this.direction.set('');
  }

  /**
   * A letter pressed with nothing focused goes into the composer.
   *
   * "Nothing focused" is `document.body` and only that, which is what makes
   * this safe rather than clever: a dialog, a menu, another field or a button
   * all hold focus themselves, so none of them is interrupted, and Space on a
   * focused button still presses it. Space is left alone even here — it pages
   * the story down, and a reader uses it far more often than a writer would
   * open a line with one.
   *
   * The character is put in by hand rather than left to the browser to deliver
   * after the focus moves: this way it goes through the same input path as any
   * other keystroke, so `[AUTHOR]` still works and there is nothing to be
   * fragile about.
   */
  protected onDocumentKey(event: KeyboardEvent): void {
    if (event.ctrlKey || event.metaKey || event.altKey) return;
    if (event.key.length !== 1 || event.key === ' ') return;
    if (document.activeElement && document.activeElement !== document.body) return;

    const field = this.input()?.nativeElement;
    if (!field) return;
    event.preventDefault();

    const typed = this.draft() + event.key;
    this.draft.set(typed);
    this.setInput(typed);
    field.focus();
    field.setSelectionRange(typed.length, typed.length);
    this.startedTyping.emit();
  }

  protected onKey(event: KeyboardEvent): void {
    // Shift+Enter is a newline; Ctrl/Cmd+Enter belongs to the global
    // regenerate shortcut, so neither one sends.
    if (event.key !== 'Enter' || event.shiftKey || event.ctrlKey || event.metaKey) return;
    event.preventDefault();
    this.send();
  }

  protected send(): void {
    if (!this.canSend()) return;
    const text = this.draft();
    const said = this.direction();
    this.draft.set('');
    this.direction.set('');
    this.authoring.set(false);
    // Clearing the signal alone does not push the empty value back into the
    // DOM node on this path, and the box would stay as tall as what was sent.
    this.setInput('');
    void this.chapters.send(text, said);
  }

  /** The DOM node and the box's height, which the signal alone does not move. */
  private setInput(value: string): void {
    const field = this.input()?.nativeElement;
    if (!field) return;
    field.value = value;
    this.autosize()?.resizeToFitContent(true);
  }

  private focusDirection(): void {
    // After the field has been put on the page by the change it was asked for.
    afterNextRender(
      () => {
        const field = this.directionInput()?.nativeElement;
        if (!field) return;
        field.focus();
        field.setSelectionRange(field.value.length, field.value.length);
      },
      { injector: this.injector },
    );
  }

  protected unblock(): void {
    const chapter = this.chapters.chapter();
    switch (this.chapters.writeBlock().action) {
      case 'scene':
        void this.dialogs.openScene(chapter.id, true);
        break;
      case 'continue':
        this.chapters.continueChapter(chapter.id);
        break;
      case 'connection':
        void this.dialogs.openConnection();
        break;
    }
  }
}
