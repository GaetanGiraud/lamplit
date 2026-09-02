import {
  Component,
  ElementRef,
  afterRenderEffect,
  computed,
  inject,
  signal,
  viewChild,
} from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { ChatStore } from '../../store/chat-store';
import { SettingsStore } from '../../store/settings-store';
import { MessageItem } from './message-item';

/** How close to the bottom still counts as "following along". */
const PINNED_SLACK = 96;

@Component({
  selector: 'ms-message-list',
  imports: [MatButtonModule, MessageItem],
  template: `
    <div #scroller class="scroller" (scroll)="onScroll()">
      <div class="column" [style.--ms-reading-size.px]="settings.ui().fontSize">
        @for (message of chat.messages(); track message.id) {
          <ms-message-item
            [message]="message"
            [streaming]="chat.streamingId() === message.id"
            [busy]="chat.isStreaming()"
            [bookStyle]="settings.ui().bookStyleDialogue"
            [showTokens]="settings.ui().showTokenCounts"
            (edited)="chat.editMessage(message.id, $event)"
            (remove)="chat.deleteMessage(message.id)"
            (regenerate)="chat.regenerate(message.id)"
            (replay)="chat.replayFrom(message.id)"
          />
        }
        <div class="tail"></div>
      </div>
    </div>

    @if (!pinned()) {
      <button matButton="filled" class="jump" (click)="jumpToLatest()">Jump to latest ↓</button>
    }
  `,
  styles: `
    :host {
      position: relative;
      display: block;
      flex: 1;
      min-height: 0;
    }

    .scroller {
      height: 100%;
      overflow-y: auto;
      overflow-x: hidden;
      scroll-behavior: auto;
    }

    .column {
      width: min(var(--ms-measure), calc(100% - 2.5rem));
      margin: 0 auto;
      padding: 1.25rem 0 0;
    }

    .tail {
      height: 1.5rem;
    }

    .jump {
      position: absolute;
      bottom: 1rem;
      left: 50%;
      transform: translateX(-50%);
      box-shadow: 0 8px 24px light-dark(rgb(0 0 0 / 15%), rgb(0 0 0 / 45%));
    }
  `,
})
export class MessageList {
  protected readonly chat = inject(ChatStore);
  protected readonly settings = inject(SettingsStore);

  private readonly scroller = viewChild.required<ElementRef<HTMLElement>>('scroller');

  /** False once the reader scrolls up: streaming must not yank them back. */
  protected readonly pinned = signal(true);

  /** Changes on a new message and on every flushed streaming delta. */
  private readonly growth = computed(() => {
    const messages = this.chat.messages();
    const last = messages[messages.length - 1];
    return `${messages.length}:${last?.content.length ?? 0}`;
  });

  constructor() {
    afterRenderEffect(() => {
      this.growth();
      if (this.pinned()) this.scrollToBottom();
    });
  }

  protected onScroll(): void {
    const element = this.scroller().nativeElement;
    const distance = element.scrollHeight - element.scrollTop - element.clientHeight;
    this.pinned.set(distance <= PINNED_SLACK);
  }

  protected jumpToLatest(): void {
    this.pinned.set(true);
    this.scrollToBottom();
  }

  private scrollToBottom(): void {
    const element = this.scroller().nativeElement;
    element.scrollTop = element.scrollHeight;
  }
}
