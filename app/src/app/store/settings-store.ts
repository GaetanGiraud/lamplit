import { Injectable, computed, effect, inject, signal } from '@angular/core';
import { DEFAULT_GENERATION, DEFAULT_SETTINGS } from '../core/defaults';
import { ConnectionSettings, GenerationParams, Settings, UiSettings } from '../core/models';
import { KEYS } from './documents';
import { STORAGE_BACKEND } from './storage';

/**
 * The global `settings.json` slice. Everything is auto-saved: mutate through
 * the patch methods and the write happens on the next microtask.
 */
@Injectable({ providedIn: 'root' })
export class SettingsStore {
  private readonly storage = inject(STORAGE_BACKEND);
  private readonly state = signal<Settings>(this.load());

  readonly settings = this.state.asReadonly();
  readonly connection = computed(() => this.state().connection);
  readonly generation = computed(() => this.state().generation);
  readonly ui = computed(() => this.state().ui);

  /** Enough to send a request: URL and model. A key is optional (local servers). */
  readonly isConnected = computed(() => {
    const c = this.state().connection;
    return !!c.baseUrl.trim() && !!c.model.trim();
  });

  readonly connectionHint = computed(() => {
    const c = this.state().connection;
    if (!c.baseUrl.trim()) return 'Set an endpoint URL in Connection';
    if (!c.model.trim()) return 'Pick a model in Connection';
    return '';
  });

  constructor() {
    effect(() => this.storage.write(KEYS.settings, this.state()));
  }

  patchConnection(patch: Partial<ConnectionSettings>): void {
    this.state.update((s) => ({ ...s, connection: { ...s.connection, ...patch } }));
  }

  patchGeneration(patch: Partial<GenerationParams>): void {
    this.state.update((s) => ({ ...s, generation: { ...s.generation, ...patch } }));
  }

  patchUi(patch: Partial<UiSettings>): void {
    this.state.update((s) => ({ ...s, ui: { ...s.ui, ...patch } }));
  }

  setActiveStory(id: string | null): void {
    this.state.update((s) => ({ ...s, activeStoryId: id }));
  }

  resetGeneration(): void {
    this.state.update((s) => ({ ...s, generation: { ...DEFAULT_GENERATION } }));
  }

  /** Merged field by field so a document from an older version still loads. */
  private load(): Settings {
    const stored = this.storage.read<Partial<Settings>>(KEYS.settings);
    if (!stored) return structuredClone(DEFAULT_SETTINGS);
    return {
      connection: { ...DEFAULT_SETTINGS.connection, ...stored.connection },
      generation: { ...DEFAULT_SETTINGS.generation, ...stored.generation },
      ui: { ...DEFAULT_SETTINGS.ui, ...stored.ui },
      activeStoryId: stored.activeStoryId ?? null,
    };
  }
}
