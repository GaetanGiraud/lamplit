import { Component, ElementRef, computed, inject, signal, viewChild } from '@angular/core';
import { CdkTextareaAutosize, TextFieldModule } from '@angular/cdk/text-field';
import { MatButtonModule } from '@angular/material/button';
import { MatTooltipModule } from '@angular/material/tooltip';
import { ChapterStore } from '../../store/chapter-store';
import { SettingsStore } from '../../store/settings-store';
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
            <div class="field">
              <textarea
                #input
                cdkTextareaAutosize
                cdkAutosizeMinRows="3"
                cdkAutosizeMaxRows="14"
                [msText]="draft()"
                [placeholder]="placeholder()"
                (input)="draft.set(text($event))"
                (keydown)="onKey($event)"
              ></textarea>

              @if (chapters.isStreaming()) {
                <button matButton="filled" class="stop" (click)="chapters.stop()">Stop</button>
              } @else {
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

            <!-- The pill is developer mode's; the trimming note is everyone's,
                 because a chapter quietly dropping its own beginning is
                 something the writer has to be told about either way. -->
            @if (settings.ui().developerMode || prompt().dropped > 0) {
              <div class="strip">
                @if (settings.ui().developerMode) {
                  <button
                    class="ms-pill"
                    type="button"
                    (click)="dialogs.openPromptPreview(draft())"
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

    .field {
      display: flex;
      align-items: flex-end;
      gap: 0.5rem;
      padding: 0.45rem 0.45rem 0.45rem 0.85rem;
      border: 1px solid var(--ms-border);
      border-radius: var(--ms-radius);
      background: var(--ms-surface-raised);
      transition: border-color 120ms ease;
    }

    .field:focus-within {
      border-color: color-mix(in srgb, var(--ms-accent) 65%, var(--ms-border));
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
  private readonly autosize = viewChild.required(CdkTextareaAutosize);

  private readonly estimator = inject(TOKEN_ESTIMATOR);

  protected readonly draft = signal('');

  /**
   * The prompt without the draft, which is everything expensive: the lore scan
   * and the token count of every message. It depends on the story and the
   * chapter, not on what is being typed, so a keystroke costs one string
   * measurement rather than a rebuild of the whole request.
   */
  protected readonly prompt = computed(() => this.chapters.preview());

  protected readonly contextLabel = computed(() => {
    const { total, budget } = this.prompt().tokens;
    const draft = this.estimator.countMessages([{ role: 'user', content: this.draft() }]);
    return `${formatTokens(total + draft)} / ${formatTokens(budget)}`;
  });

  protected readonly contextTooltip = 'Everything this request will send. Click to read it.';

  protected readonly canSend = computed(
    () => !!this.draft().trim() && !this.chapters.isStreaming() && this.chapters.canWrite(),
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
    this.draft.set('');
    // Clearing the signal alone does not push the empty value back into the
    // DOM node on this path, and the box would stay as tall as what was sent.
    this.input().nativeElement.value = '';
    this.autosize().resizeToFitContent(true);
    void this.chapters.send(text);
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
