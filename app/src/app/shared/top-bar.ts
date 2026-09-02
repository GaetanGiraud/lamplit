import { Component, computed, inject } from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { MatMenuModule } from '@angular/material/menu';
import { MatSliderModule } from '@angular/material/slider';
import { MatSlideToggleModule } from '@angular/material/slide-toggle';
import { MatTooltipModule } from '@angular/material/tooltip';
import { SettingsStore } from '../store/settings-store';
import { ChatStore } from '../store/chat-store';
import { DialogsService } from './dialogs.service';

/**
 * The one bar that is always there. Story and chapter live here from step 2;
 * for now it shows the chapter, the live model and the way into the modals.
 */
@Component({
  selector: 'ms-top-bar',
  imports: [
    MatButtonModule,
    MatMenuModule,
    MatSliderModule,
    MatSlideToggleModule,
    MatTooltipModule,
  ],
  template: `
    <header class="bar">
      <div class="identity">
        <span class="wordmark">MagicStories</span>
        <span class="sep">·</span>
        <span class="chapter">{{ chat.chat().title }}</span>
      </div>

      <div class="actions">
        <button
          matButton
          class="model"
          [class.unset]="!settings.isConnected()"
          (click)="dialogs.openConnection()"
          [matTooltip]="connectionTooltip()"
        >
          <span class="dot" [class.live]="settings.isConnected()"></span>
          {{ modelLabel() }}
        </button>

        <button matButton (click)="dialogs.openParameters()">Parameters</button>

        <button matButton [matMenuTriggerFor]="reading">Reading</button>
        <mat-menu #reading="matMenu">
          <div class="menu-panel" (click)="$event.stopPropagation()">
            <mat-slide-toggle
              [checked]="settings.ui().theme === 'dark'"
              (change)="settings.patchUi({ theme: $event.checked ? 'dark' : 'light' })"
            >
              Dark theme
            </mat-slide-toggle>
            <mat-slide-toggle
              [checked]="settings.ui().bookStyleDialogue"
              (change)="settings.patchUi({ bookStyleDialogue: $event.checked })"
            >
              Dialogue on its own line
            </mat-slide-toggle>
            <mat-slide-toggle
              [checked]="settings.ui().showTokenCounts"
              (change)="settings.patchUi({ showTokenCounts: $event.checked })"
            >
              Show token counts
            </mat-slide-toggle>
            <label class="size">
              Text size
              <mat-slider min="14" max="26" step="1" discrete>
                <input
                  matSliderThumb
                  [value]="settings.ui().fontSize"
                  (valueChange)="settings.patchUi({ fontSize: $event })"
                />
              </mat-slider>
            </label>
          </div>
        </mat-menu>

        <button matButton [matMenuTriggerFor]="more" aria-label="More actions">⋯</button>
        <mat-menu #more="matMenu">
          <button mat-menu-item [disabled]="chat.isEmpty()" (click)="clear()">
            Clear this chapter
          </button>
        </mat-menu>
      </div>
    </header>
  `,
  styles: `
    .bar {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 1rem;
      height: 3.25rem;
      padding: 0 0.75rem 0 1.1rem;
      border-bottom: 1px solid var(--ms-border);
      background: color-mix(in srgb, var(--ms-surface) 82%, transparent);
      backdrop-filter: blur(10px);
    }

    .identity {
      display: flex;
      align-items: baseline;
      gap: 0.5rem;
      min-width: 0;
      overflow: hidden;
    }

    .wordmark {
      flex: none;
      font-family: var(--ms-serif);
      font-size: 1.05rem;
      letter-spacing: 0.01em;
      white-space: nowrap;
      color: var(--ms-ink);
    }

    .sep,
    .chapter {
      color: var(--ms-muted);
      font-size: 0.85rem;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }

    .actions {
      flex: none;
      display: flex;
      align-items: center;
      gap: 0.15rem;
    }

    /* Narrow windows keep the chapter and the model; the wordmark can go. */
    @media (max-width: 780px) {
      .wordmark,
      .sep {
        display: none;
      }
    }

    .model {
      max-width: 15rem;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }

    .model.unset {
      color: var(--ms-accent);
    }

    .dot {
      display: inline-block;
      width: 7px;
      height: 7px;
      margin-right: 0.45rem;
      border-radius: 50%;
      background: var(--ms-muted);
    }

    .dot.live {
      background: light-dark(#2f8f5b, #6fd39b);
    }

    .menu-panel {
      display: flex;
      flex-direction: column;
      gap: 0.6rem;
      padding: 0.75rem 1rem;
      min-width: 15rem;
    }

    .size {
      display: flex;
      flex-direction: column;
      font-size: 0.8rem;
      color: var(--ms-muted);
    }
  `,
})
export class TopBar {
  protected readonly settings = inject(SettingsStore);
  protected readonly chat = inject(ChatStore);
  protected readonly dialogs = inject(DialogsService);

  protected readonly modelLabel = computed(() => {
    const connection = this.settings.connection();
    if (!connection.model) return 'Connect a model';
    const known = connection.modelsCache.find((m) => m.id === connection.model);
    return known?.name ?? shortModelId(connection.model);
  });

  protected readonly connectionTooltip = computed(
    () => this.settings.connectionHint() || `${this.settings.connection().baseUrl}`,
  );

  protected clear(): void {
    if (confirm('Clear every message in this chapter?')) this.chat.clear();
  }
}

/** `provider/family/model-name` reads better as just the last segment. */
function shortModelId(id: string): string {
  const parts = id.split('/');
  return parts[parts.length - 1] || id;
}
