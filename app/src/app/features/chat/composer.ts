import { Component, ElementRef, computed, inject, signal, viewChild } from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { MatTooltipModule } from '@angular/material/tooltip';
import { ChatStore } from '../../store/chat-store';
import { SettingsStore } from '../../store/settings-store';
import { formatTokens } from '../../core/tokens';
import { DialogsService } from '../../shared/dialogs.service';

@Component({
  selector: 'ms-composer',
  imports: [MatButtonModule, MatTooltipModule],
  template: `
    <div class="dock">
      <div class="column">
        @if (!settings.isConnected() && !chat.isEmpty()) {
          <button matButton="outlined" class="blocked" (click)="dialogs.openConnection()">
            {{ settings.connectionHint() }}
          </button>
        }

        <div class="field" [class.disabled]="!settings.isConnected()">
          <textarea
            #input
            rows="1"
            [value]="draft()"
            [disabled]="!settings.isConnected()"
            [placeholder]="placeholder()"
            (input)="draft.set(text($event))"
            (keydown)="onKey($event)"
          ></textarea>

          @if (chat.isStreaming()) {
            <button matButton="filled" class="stop" (click)="chat.stop()">Stop</button>
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

        <div class="strip">
          <button
            class="ms-pill"
            type="button"
            (click)="dialogs.openParameters()"
            [matTooltip]="contextTooltip"
          >
            context {{ contextLabel() }}
          </button>
          @if (report().dropped > 0) {
            <span class="ms-hint">
              {{ report().dropped }} older
              {{ report().dropped === 1 ? 'message' : 'messages' }} left out
            </span>
          }
        </div>
      </div>
    </div>
  `,
  styles: `
    .dock {
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
      align-self: flex-start;
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

    .field.disabled {
      opacity: 0.55;
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
      max-height: 12rem;
      field-sizing: content;
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
  protected readonly chat = inject(ChatStore);
  protected readonly settings = inject(SettingsStore);
  protected readonly dialogs = inject(DialogsService);

  private readonly input = viewChild.required<ElementRef<HTMLTextAreaElement>>('input');

  protected readonly draft = signal('');

  protected readonly report = computed(() => this.chat.contextReport(this.draft()));

  protected readonly contextLabel = computed(() => {
    const { used, budget } = this.report();
    return `${formatTokens(used)} / ${formatTokens(budget)}`;
  });

  protected readonly contextTooltip =
    'Everything this request will send. Click to change the budget.';

  protected readonly canSend = computed(
    () => !!this.draft().trim() && !this.chat.isStreaming() && this.settings.isConnected(),
  );

  protected readonly placeholder = computed(() =>
    this.chat.isEmpty() ? 'Set the scene, or just say what you do…' : 'What happens next?',
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
    // `field-sizing: content` shrinks from the value, which the signal alone
    // does not push back into the DOM node on this path.
    this.input().nativeElement.value = '';
    void this.chat.send(text);
  }
}
