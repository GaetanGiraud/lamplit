import { Injectable, computed, effect, inject, signal } from '@angular/core';
import { DEFAULT_GENERATION, DEFAULT_SETTINGS } from '../core/defaults';
import {
  ColourKey,
  ConnectionSettings,
  GenerationParams,
  PanelSection,
  Settings,
  ThemeName,
  UiSettings,
} from '../core/models';
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
    // Skip the write the effect would otherwise make the moment it runs: the
    // document came off disk a tick ago and putting it straight back is a
    // request that says nothing. The story and chapter stores do the same with
    // their `written` maps.
    let written = JSON.stringify(this.state());
    effect(() => {
      const next = JSON.stringify(this.state());
      if (next === written) return;
      written = next;
      this.storage.write(KEYS.settings, this.state());
    });
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

  /** The chapter panel: open, or the thin edge. Ctrl+. and the handle both land here. */
  setSidebarOpen(open: boolean): void {
    this.patchUi({ sidebarOpen: open });
  }

  /**
   * One section of the chapter panel, folded or unfolded. Only the folded ones
   * are written down, so a section a later version adds arrives open.
   */
  setPanelSection(section: PanelSection, open: boolean): void {
    this.state.update((s) => {
      const sections = { ...s.ui.sidebarSections };
      if (open) delete sections[section];
      else sections[section] = false;
      return { ...s, ui: { ...s.ui, sidebarSections: sections } };
    });
  }

  /**
   * One swatch, in one theme. Passing nothing puts the shipped colour back:
   * the palette is stored as overrides, so forgetting a name *is* the default.
   */
  setColour(theme: ThemeName, key: ColourKey, colour: string | null): void {
    this.state.update((s) => {
      const colours = { ...(s.ui.colours[theme] ?? {}) };
      if (colour) colours[key] = colour;
      else delete colours[key];
      return { ...s, ui: { ...s.ui, colours: { ...s.ui.colours, [theme]: colours } } };
    });
  }

  /** Every colour this theme overrides, gone. The other theme is untouched. */
  resetColours(theme: ThemeName): void {
    this.state.update((s) => {
      const colours = { ...s.ui.colours };
      delete colours[theme];
      return { ...s, ui: { ...s.ui, colours } };
    });
  }

  setActiveStory(id: string | null): void {
    this.state.update((s) => ({ ...s, activeStoryId: id }));
  }

  /** The upgrade notice for this version has been seen; do not show it again. */
  acknowledgeVersion(version: string): void {
    this.state.update((s) => ({ ...s, acknowledgedVersion: version }));
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
      // `colours` and `font` arrived after 0.1.0, so a settings file written by
      // it has neither and takes both from the defaults — an empty override set
      // and the serif, which is the theme exactly as it shipped. The chapter
      // panel is later still: a file that predates it opens with the panel a
      // thin edge and nothing folded away inside it.
      ui: { ...DEFAULT_SETTINGS.ui, ...stored.ui },
      activeStoryId: stored.activeStoryId ?? null,
      acknowledgedVersion: stored.acknowledgedVersion ?? null,
    };
  }
}
