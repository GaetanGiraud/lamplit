import {
  Component,
  ElementRef,
  Injector,
  afterNextRender,
  computed,
  inject,
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

@Component({
  selector: 'ms-composer',
  imports: [MatButtonModule, MatTooltipModule, TextFieldModule, TextValue],
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
    /* Above the chapter panel's scrim, so the panel covering the page at a
       narrow width never takes the box away from whoever is writing in it. */
    .dock {
      position: relative;
      z-index: 2;
      border-top: 1px solid var(--ms-border);
      background: color-mix(in srgb, var(--ms-surface) 88%, transparent);
      backdrop-filter: blur(10px);
      padding: 0.7rem 0 0.6rem;
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

  private readonly input = viewChild.required<ElementRef<HTMLTextAreaElement>>('input');
  private readonly directionInput = viewChild<ElementRef<HTMLTextAreaElement>>('directionInput');
  private readonly autosize = viewChild.required(CdkTextareaAutosize);
  private readonly injector = inject(Injector);

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
    this.input().nativeElement.value = value;
    this.autosize().resizeToFitContent(true);
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
