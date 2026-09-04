import {
  Component,
  DestroyRef,
  ElementRef,
  afterRenderEffect,
  computed,
  inject,
  signal,
  viewChild,
} from '@angular/core';
import { MatTooltipModule } from '@angular/material/tooltip';
import { ChapterStore } from '../../store/chapter-store';
import { SettingsStore } from '../../store/settings-store';
import { MessageItem } from './message-item';

/** How close to the bottom still counts as "following along". */
const PINNED_SLACK = 96;

@Component({
  selector: 'ms-message-list',
  imports: [MatTooltipModule, MessageItem],
  template: `
    <div #scroller class="scroller" (scroll)="onScroll()">
      <div class="column" [style.--ms-reading-size.px]="settings.ui().fontSize">
        <!-- The written turns, not every row: a record of the cast changing is
             in the list so the prompt knows where it happened, not to be read. -->
        @for (message of chapters.written(); track message.id) {
          <ms-message-item
            [message]="message"
            [streaming]="chapters.streamingId() === message.id"
            [busy]="chapters.isStreaming()"
            [bookStyle]="settings.ui().bookStyleDialogue"
            [showTokens]="settings.ui().showTokenCounts"
            (edited)="chapters.editMessage(message.id, $event)"
            (remove)="chapters.deleteMessage(message.id)"
            (regenerate)="chapters.regenerate(message.id)"
            (replay)="chapters.replayFrom(message.id)"
          />
        }
        <div class="tail"></div>
      </div>

      <!-- Inside the scroller, and the same width as the column, so the button
           lands in the same margin the message actions use. Outside it, the
           scrollbar would be counted in the middle and the two would be a few
           pixels out of line. -->
      @if (!pinned()) {
        <div class="jump-dock">
          <button
            class="jump"
            type="button"
            (click)="jumpToLatest()"
            matTooltip="Jump to latest"
            matTooltipPosition="left"
            aria-label="Jump to latest"
          >
            <svg viewBox="0 0 16 16" aria-hidden="true">
              <path d="M8 2.8v9.4m0 0 3.6-3.6M8 12.2 4.4 8.6" />
            </svg>
          </button>
        </div>
      }
    </div>
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

    /* A strip of nothing, the width of the column, stuck a finger's width
       above the foot of the scrollport. It carries no height of its own, so it
       adds nothing to the story it is sitting at the end of. */
    .jump-dock {
      position: sticky;
      bottom: 1rem;
      width: var(--ms-column);
      height: 0;
      margin: 0 auto;
      pointer-events: none;
    }

    /* In the margin, in the same column as a message's actions, rather than
       over the last lines being read. Where there is no margin it tucks into
       the corner of the scroller, on the column's own side padding, small
       enough to cover at most the end of the longest line. */
    .jump {
      position: absolute;
      bottom: 0;
      right: -1rem;
      pointer-events: auto;
      display: flex;
      align-items: center;
      justify-content: center;
      width: var(--ms-rail);
      height: var(--ms-rail);
      padding: 0;
      border: 1px solid var(--ms-border);
      border-radius: 50%;
      background: var(--ms-surface-raised);
      color: var(--ms-ink-soft);
      cursor: pointer;
      box-shadow: 0 6px 18px light-dark(rgb(0 0 0 / 12%), rgb(0 0 0 / 40%));
    }

    .jump:hover,
    .jump:focus-visible {
      color: var(--ms-ink);
      border-color: color-mix(in srgb, var(--ms-accent) 55%, var(--ms-border));
    }

    .jump svg {
      width: 1rem;
      height: 1rem;
      fill: none;
      stroke: currentColor;
      stroke-width: 1.5;
      stroke-linecap: round;
      stroke-linejoin: round;
    }

    /* The same margin the message actions ask for, so the two line up. */
    @media (min-width: 42rem) {
      .jump {
        right: auto;
        left: calc(100% + var(--ms-margin-gap));
      }
    }
  `,
})
export class MessageList {
  protected readonly chapters = inject(ChapterStore);
  protected readonly settings = inject(SettingsStore);

  private readonly scroller = viewChild.required<ElementRef<HTMLElement>>('scroller');

  /** False once the reader scrolls up: streaming must not yank them back. */
  protected readonly pinned = signal(true);

  /** Changes on a new message and on every flushed streaming delta. */
  private readonly growth = computed(() => {
    const messages = this.chapters.written();
    const last = messages[messages.length - 1];
    return `${messages.length}:${last?.content.length ?? 0}`;
  });

  constructor() {
    afterRenderEffect(() => {
      this.growth();
      if (this.pinned()) this.scrollToBottom();
    });

    // The composer grows as it is written into, which shortens this column —
    // without this the last lines of the story slide up under the dock while
    // the reader is still looking at them.
    const observer = new ResizeObserver(() => {
      if (this.pinned()) this.scrollToBottom();
    });
    afterRenderEffect(() => {
      const dock = document.querySelector('ms-composer');
      if (dock) observer.observe(dock);
    });
    inject(DestroyRef).onDestroy(() => observer.disconnect());
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
