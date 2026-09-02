import { Component, computed, inject, signal } from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { MatDialogModule } from '@angular/material/dialog';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatSelectModule } from '@angular/material/select';
import { NANOGPT_BASE_URL } from '../../core/defaults';
import { ModelInfo, Provider } from '../../core/models';
import { ModelClient } from '../../core/model-client';
import { errorFromThrown } from '../../core/model-errors';
import { SettingsStore } from '../../store/settings-store';

interface ModelGroup {
  label: string;
  models: ModelInfo[];
}

type Status = { kind: 'idle' | 'busy' | 'ok' | 'error'; message: string };

const IDLE: Status = { kind: 'idle', message: '' };

/**
 * Provider, URL, key, model. Every change is written to settings immediately,
 * so closing the modal — however it closes — has already saved.
 */
@Component({
  selector: 'ms-connection-dialog',
  imports: [
    MatButtonModule,
    MatDialogModule,
    MatFormFieldModule,
    MatInputModule,
    MatProgressSpinnerModule,
    MatSelectModule,
  ],
  template: `
    <h2 mat-dialog-title class="ms-dialog-title">Connection</h2>

    <mat-dialog-content>
      <mat-form-field appearance="outline">
        <mat-label>Provider</mat-label>
        <mat-select [value]="connection().provider" (valueChange)="setProvider($event)">
          <mat-option value="nanogpt">NanoGPT</mat-option>
          <mat-option value="custom">Custom (OpenAI-compatible)</mat-option>
        </mat-select>
      </mat-form-field>

      <mat-form-field appearance="outline">
        <mat-label>Endpoint URL</mat-label>
        <input
          matInput
          [value]="connection().baseUrl"
          [readonly]="connection().provider === 'nanogpt'"
          (input)="patch({ baseUrl: value($event) })"
          placeholder="https://host/v1"
        />
        <mat-hint>Anything that answers /models and /chat/completions.</mat-hint>
      </mat-form-field>

      <mat-form-field appearance="outline">
        <mat-label>API key</mat-label>
        <input
          matInput
          [type]="showKey() ? 'text' : 'password'"
          autocomplete="off"
          spellcheck="false"
          [value]="connection().apiKey"
          (input)="patch({ apiKey: value($event) })"
        />
        <button matIconButton matSuffix type="button" (click)="showKey.set(!showKey())">
          {{ showKey() ? '🙈' : '👁' }}
        </button>
        <mat-hint>Kept on this machine, in plain text. Leave empty for local servers.</mat-hint>
      </mat-form-field>

      <div class="row">
        <button
          matButton="outlined"
          (click)="fetchModels()"
          [disabled]="fetchStatus().kind === 'busy'"
        >
          {{ connection().modelsCache.length ? 'Refresh models' : 'Fetch models' }}
        </button>
        @if (fetchStatus().kind === 'busy') {
          <mat-spinner diameter="18" />
        }
        <span class="status" [class.bad]="fetchStatus().kind === 'error'">
          {{ fetchStatus().message }}
        </span>
      </div>

      @if (connection().modelsCache.length) {
        <mat-form-field appearance="outline">
          <mat-label>Filter models</mat-label>
          <input
            matInput
            [value]="filter()"
            (input)="filter.set(value($event))"
            placeholder="e.g. claude, gpt, 70b"
          />
        </mat-form-field>

        <mat-form-field appearance="outline">
          <mat-label>Model</mat-label>
          <mat-select [value]="connection().model" (valueChange)="patch({ model: $event })">
            @for (group of groups(); track group.label) {
              <mat-optgroup [label]="group.label">
                @for (model of group.models; track model.id) {
                  <mat-option [value]="model.id">
                    {{ model.name ?? model.id }}
                    @if (model.name) {
                      <span class="mono">{{ model.id }}</span>
                    }
                  </mat-option>
                }
              </mat-optgroup>
            }
          </mat-select>
          <mat-hint>{{ matchCount() }} of {{ connection().modelsCache.length }} models</mat-hint>
        </mat-form-field>
      }

      <div class="row">
        <button
          matButton="outlined"
          (click)="test()"
          [disabled]="testStatus().kind === 'busy' || !settings.isConnected()"
        >
          Test
        </button>
        @if (testStatus().kind === 'busy') {
          <mat-spinner diameter="18" />
        }
        <span
          class="status"
          [class.good]="testStatus().kind === 'ok'"
          [class.bad]="testStatus().kind === 'error'"
        >
          {{ testStatus().message }}
        </span>
      </div>
    </mat-dialog-content>

    <mat-dialog-actions align="end">
      <button matButton="filled" mat-dialog-close>Done</button>
    </mat-dialog-actions>
  `,
  styles: `
    mat-dialog-content {
      display: flex;
      flex-direction: column;
      gap: 0.35rem;
      padding-top: 0.5rem !important;
    }

    mat-form-field {
      width: 100%;
    }

    .row {
      display: flex;
      align-items: center;
      gap: 0.7rem;
      min-height: 2.5rem;
      margin-bottom: 0.35rem;
    }

    .status {
      font-size: 0.8rem;
      color: var(--ms-muted);
      line-height: 1.35;
    }

    .status.good {
      color: light-dark(#2f8f5b, #6fd39b);
    }

    .status.bad {
      color: var(--ms-danger);
    }

    /* The id belongs in the option list, not in the closed trigger. */
    ::ng-deep .mat-mdc-select-value .mono {
      display: none;
    }

    .mono {
      display: block;
      font-family: var(--ms-mono);
      font-size: 0.68rem;
      color: var(--ms-muted);
      line-height: 1.2;
    }
  `,
})
export class ConnectionDialog {
  protected readonly settings = inject(SettingsStore);
  private readonly client = inject(ModelClient);

  protected readonly connection = this.settings.connection;
  protected readonly showKey = signal(false);
  protected readonly filter = signal('');
  protected readonly fetchStatus = signal<Status>(IDLE);
  protected readonly testStatus = signal<Status>(IDLE);

  private readonly matches = computed(() => {
    const needle = this.filter().trim().toLowerCase();
    const models = this.connection().modelsCache;
    if (!needle) return models;
    return models.filter(
      (m) => m.id.toLowerCase().includes(needle) || (m.name ?? '').toLowerCase().includes(needle),
    );
  });

  protected readonly matchCount = computed(() => this.matches().length);

  /** Grouped by `owned_by`, which is how these lists are actually read. */
  protected readonly groups = computed<ModelGroup[]>(() => {
    const byOwner = new Map<string, ModelInfo[]>();
    for (const model of this.matches()) {
      const owner = model.ownedBy?.trim() || 'other';
      const bucket = byOwner.get(owner);
      bucket ? bucket.push(model) : byOwner.set(owner, [model]);
    }
    // Keep the selected model reachable even when the filter excludes it.
    const selected = this.connection().model;
    if (selected && !this.matches().some((m) => m.id === selected)) {
      const known = this.connection().modelsCache.find((m) => m.id === selected);
      if (known) byOwner.set('selected', [known]);
    }
    return [...byOwner.entries()]
      .map(([label, models]) => ({ label, models }))
      .sort((a, b) => a.label.localeCompare(b.label));
  });

  protected value(event: Event): string {
    return (event.target as HTMLInputElement).value;
  }

  protected patch(patch: Parameters<SettingsStore['patchConnection']>[0]): void {
    this.settings.patchConnection(patch);
    this.testStatus.set(IDLE);
  }

  protected setProvider(provider: Provider): void {
    this.settings.patchConnection(
      provider === 'nanogpt' ? { provider, baseUrl: NANOGPT_BASE_URL } : { provider },
    );
    this.fetchStatus.set(IDLE);
    this.testStatus.set(IDLE);
  }

  protected async fetchModels(): Promise<void> {
    const { baseUrl, apiKey } = this.connection();
    this.fetchStatus.set({ kind: 'busy', message: 'Asking the endpoint…' });
    try {
      const models = await this.client.listModels(baseUrl, apiKey);
      this.settings.patchConnection({
        modelsCache: models,
        modelsFetchedAt: new Date().toISOString(),
      });
      this.fetchStatus.set({ kind: 'ok', message: `${models.length} models` });
    } catch (e) {
      this.fetchStatus.set({ kind: 'error', message: errorFromThrown(e).message });
    }
  }

  protected async test(): Promise<void> {
    const { baseUrl, apiKey, model } = this.connection();
    this.testStatus.set({ kind: 'busy', message: 'Sending one short request…' });
    try {
      const reply = await this.client.testConnection(baseUrl, apiKey, model);
      this.testStatus.set({
        kind: 'ok',
        message: reply ? `The model answered: “${reply}”` : 'The model answered.',
      });
    } catch (e) {
      this.testStatus.set({ kind: 'error', message: errorFromThrown(e).message });
    }
  }
}
