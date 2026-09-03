import { Component, computed, inject } from '@angular/core';
import { MatTooltipModule } from '@angular/material/tooltip';
import { Persistence } from '../store/persistence';

/**
 * One dot in the top bar. It is the only place the backend is visible, and it
 * has nothing to say while everything is on disk — which is nearly always.
 * When the server goes away it becomes the button that tries again.
 */
@Component({
  selector: 'ms-save-status',
  imports: [MatTooltipModule],
  template: `
    @if (visible()) {
      <button
        type="button"
        class="status"
        [class.offline]="state() === 'offline'"
        [matTooltip]="tooltip()"
        [attr.aria-label]="label()"
        [disabled]="state() !== 'offline'"
        (click)="persistence.retryNow()"
      >
        <span class="dot"></span>
        <span class="label">{{ label() }}</span>
      </button>
    }
  `,
  styles: `
    .status {
      display: inline-flex;
      align-items: center;
      gap: 0.4rem;
      padding: 0.15rem 0.5rem;
      border: 0;
      border-radius: 999px;
      background: none;
      font: inherit;
      font-size: 0.78rem;
      color: var(--ms-muted);
      cursor: default;
    }

    .status.offline {
      color: var(--ms-accent);
      cursor: pointer;
    }

    .status.offline:hover {
      background: color-mix(in srgb, var(--ms-accent) 12%, transparent);
    }

    .dot {
      width: 7px;
      height: 7px;
      border-radius: 50%;
      background: currentColor;
    }

    /* Saving is a flicker on a fast disk; fading in keeps it from strobing. */
    .status:not(.offline) .dot {
      animation: settle 0.6s ease-out;
    }

    @keyframes settle {
      from {
        opacity: 0.25;
      }
      to {
        opacity: 1;
      }
    }

    @media (max-width: 1180px) {
      .label {
        display: none;
      }
    }
  `,
})
export class SaveStatusIndicator {
  protected readonly persistence = inject(Persistence);
  protected readonly state = this.persistence.status;

  /** Nothing to report while it is simply working, which is nearly always. */
  protected readonly visible = computed(() => {
    const state = this.state();
    return state === 'saving' || state === 'offline';
  });

  protected readonly label = computed(() => (this.state() === 'offline' ? 'Offline' : 'Saving…'));

  protected readonly tooltip = computed(() =>
    this.state() === 'offline'
      ? `${this.persistence.error() || 'The server is not answering'} — this tab still has everything and keeps retrying, but do not reload until it is back. Click to try now.`
      : 'Saving to disk',
  );
}
