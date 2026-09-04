import { TestBed } from '@angular/core/testing';
import { beforeEach, describe, expect, it } from 'vitest';
import { DEFAULT_SETTINGS } from '../core/defaults';
import { KEYS } from './documents';
import { SettingsStore } from './settings-store';
import { STORAGE_BACKEND, StorageBackend } from './storage';

/** The documents, in a Map. What Persistence is, minus the server behind it. */
class InMemoryStorage implements StorageBackend {
  readonly documents = new Map<string, unknown>();

  read<T>(key: string): T | null {
    return (this.documents.get(key) as T) ?? null;
  }
  write(key: string, value: unknown): void {
    this.documents.set(key, value);
  }
  remove(key: string): void {
    this.documents.delete(key);
  }
  keys(prefix: string): string[] {
    return [...this.documents.keys()].filter((key) => key.startsWith(prefix));
  }
}

/**
 * A `settings.json` as 0.1.0 wrote one: four reading fields, and no idea that
 * a palette or a reading font were ever going to exist.
 */
const SETTINGS_0_1_0 = {
  connection: { provider: 'nanogpt', baseUrl: 'https://x/v1', apiKey: '', model: 'm' },
  generation: { temperature: 0.7 },
  ui: { theme: 'light', bookStyleDialogue: false, fontSize: 22, showTokenCounts: false },
  activeStoryId: 'abc',
};

describe('SettingsStore', () => {
  let storage: InMemoryStorage;

  beforeEach(() => {
    storage = new InMemoryStorage();
    TestBed.configureTestingModule({
      providers: [{ provide: STORAGE_BACKEND, useValue: storage }],
    });
  });

  /** The store reads at construction, so seed the document before asking. */
  const store = () => TestBed.inject(SettingsStore);

  it('opens a 0.1.0 settings file with no colours customised', () => {
    storage.write(KEYS.settings, SETTINGS_0_1_0);

    const ui = store().ui();
    // What it did say is kept, to the letter.
    expect(ui.theme).toBe('light');
    expect(ui.fontSize).toBe(22);
    expect(ui.showTokenCounts).toBe(false);
    // What it did not say is the theme exactly as it shipped, and an app that
    // shows the writer's half of itself and nothing else.
    expect(ui.colours).toEqual({});
    expect(ui.font).toBe(DEFAULT_SETTINGS.ui.font);
    expect(ui.developerMode).toBe(false);
    // On by default, so an upgrade is something an old install hears about.
    expect(ui.checkForUpdates).toBe(true);
  });

  it('keeps developer mode once it is switched on', () => {
    const settings = store();
    expect(settings.ui().developerMode).toBe(false);

    settings.patchUi({ developerMode: true });
    expect(settings.ui().developerMode).toBe(true);
    // It is a setting, not a mode: nothing else moved with it.
    expect(settings.ui().colours).toEqual({});
    expect(settings.ui().showTokenCounts).toBe(DEFAULT_SETTINGS.ui.showTokenCounts);
  });

  it('keeps a colour per theme, and reset takes only the one theme back', () => {
    const settings = store();
    settings.setColour('dark', 'page', '#101010');
    settings.setColour('light', 'page', '#fafafa');
    settings.setColour('dark', 'ink', '#eeeeee');

    expect(settings.ui().colours).toEqual({
      dark: { page: '#101010', ink: '#eeeeee' },
      light: { page: '#fafafa' },
    });

    settings.resetColours('dark');
    expect(settings.ui().colours).toEqual({ light: { page: '#fafafa' } });
  });

  it('drops the override rather than storing the shipped colour', () => {
    const settings = store();
    settings.setColour('dark', 'accent', '#c0a060');
    settings.setColour('dark', 'accent', null);

    expect(settings.ui().colours.dark).toEqual({});
  });
});
