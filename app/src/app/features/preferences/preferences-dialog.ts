import { Component, computed, inject } from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { MatDialogModule } from '@angular/material/dialog';
import { MatExpansionModule } from '@angular/material/expansion';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatSelectModule } from '@angular/material/select';
import { MatSliderModule } from '@angular/material/slider';
import { MatSlideToggleModule } from '@angular/material/slide-toggle';
import { desktop } from '../../core/desktop';
import { ColourKey, ReadingFont } from '../../core/models';
import {
  AA_CONTRAST,
  READING_FONTS,
  THEME_COLOURS,
  contrastRatio,
  shippedColour,
} from '../../core/theming';
import { characterColour, characterColourLabel } from '../../core/character-colours';
import { PAGE_PALETTES, paletteLabel } from '../../core/page-palettes';
import { ChapterStore } from '../../store/chapter-store';
import { SettingsStore } from '../../store/settings-store';
import { StoryStore } from '../../store/story-store';
import { UpdatesStore } from '../../store/updates-store';
import { DialogsService } from '../../shared/dialogs.service';

/**
 * Everything about how the story looks to you, and nothing about what is sent.
 *
 * Reading is what the top bar's menu used to hold, unchanged and open on
 * arrival. Colours and Advanced are folded away, because the first is a long
 * grid nobody needs on the way to the text size and the second is where the
 * options that come with a warning will live.
 */
@Component({
  selector: 'ms-preferences-dialog',
  imports: [
    MatButtonModule,
    MatDialogModule,
    MatExpansionModule,
    MatFormFieldModule,
    MatSelectModule,
    MatSliderModule,
    MatSlideToggleModule,
  ],
  template: `
    <h2 mat-dialog-title class="ms-dialog-title">Preferences</h2>

    <mat-dialog-content>
      <mat-accordion multi>
        <mat-expansion-panel expanded>
          <mat-expansion-panel-header>
            <mat-panel-title>Reading</mat-panel-title>
            <mat-panel-description>{{ readingSummary() }}</mat-panel-description>
          </mat-expansion-panel-header>

          <div class="stack">
            <mat-slide-toggle
              [checked]="ui().theme === 'dark'"
              (change)="settings.patchUi({ theme: $event.checked ? 'dark' : 'light' })"
            >
              Dark theme
            </mat-slide-toggle>
            <mat-slide-toggle
              [checked]="ui().bookStyleDialogue"
              (change)="settings.patchUi({ bookStyleDialogue: $event.checked })"
            >
              Dialogue on its own line
            </mat-slide-toggle>
            <mat-slide-toggle
              [checked]="ui().showTokenCounts"
              (change)="settings.patchUi({ showTokenCounts: $event.checked })"
            >
              Show token counts
            </mat-slide-toggle>
            <label class="size">
              Text size
              <mat-slider min="14" max="26" step="1" discrete>
                <input
                  matSliderThumb
                  [value]="ui().fontSize"
                  (valueChange)="settings.patchUi({ fontSize: $event })"
                />
              </mat-slider>
            </label>
          </div>
        </mat-expansion-panel>

        <mat-expansion-panel>
          <mat-expansion-panel-header>
            <mat-panel-title>Colours</mat-panel-title>
            <mat-panel-description>{{ coloursSummary() }}</mat-panel-description>
          </mat-expansion-panel-header>

          <div class="row-head">
            <span class="row-name">Page palette</span>
            @if (customised()) {
              <span class="tag">custom</span>
            }
          </div>
          <p class="ms-hint palette-lead">
            @if (editingChapter()) {
              <strong>Chapter {{ chapters.chapter().number }} has a page of its own.</strong> This
              row is editing that one and not the story's. The chapter keeps it when you come back
              to it; set it back to the page it ships with and the story's own is underneath.
            } @else {
              A preset for the swatches below: one click sets every one of them, in both themes.
              Change a colour afterwards and yours wins — that is what <em>custom</em> means, and
              Reset is the way out of it.
            }
          </p>

          <div class="palettes">
            @for (option of paletteOptions(); track option.name) {
              <button
                type="button"
                class="palette"
                [class.on]="option.name === currentPalette()"
                [title]="option.title"
                (click)="choosePalette(option.name)"
              >
                <span class="preview" [style.background]="option.page">
                  <span class="sheet" [style.background]="option.surface">
                    <span class="line" [style.background]="option.ink"></span>
                    <span class="line short" [style.background]="option.speech"></span>
                  </span>
                  <span class="dot" [style.background]="option.accent"></span>
                </span>
                <span class="palette-label">{{ option.label }}</span>
              </button>
            }
          </div>

          <mat-form-field appearance="outline" class="font" subscriptSizing="dynamic">
            <mat-label>Reading font</mat-label>
            <mat-select [value]="ui().font" (valueChange)="setFont($event)">
              @for (font of fonts; track font.key) {
                <mat-option [value]="font.key">{{ font.label }}</mat-option>
              }
            </mat-select>
            <mat-hint>The story itself, not the app around it.</mat-hint>
          </mat-form-field>

          <p class="ms-hint editing">
            You are editing the <strong>{{ ui().theme }}</strong> theme. Switch it above and the
            other set is edited instead; each keeps its own colours.
          </p>

          <div class="swatches">
            @for (swatch of swatches(); track swatch.key) {
              <label class="swatch" [class.custom]="swatch.custom">
                <input
                  type="color"
                  [value]="swatch.colour"
                  (input)="setColour(swatch.key, $event)"
                />
                <span class="text">
                  <span class="name">{{ swatch.label }}</span>
                  <span class="ms-hint">{{ swatch.hint }}</span>
                </span>
              </label>
            }
          </div>

          @if (contrastWarning()) {
            <p class="warning" role="status">{{ contrastWarning() }}</p>
          }

          <div class="reset">
            <button matButton [disabled]="!customised()" (click)="reset()">
              Reset the {{ ui().theme }} colours
            </button>
          </div>

          <!-- The cast's own colours. They belong to the story rather than to
               the app, but this is where colours are changed, so this is where
               somebody comes looking for them. -->
          @if (cast().length) {
            <hr />
            <p class="ms-hint editing">
              <strong>The cast of {{ stories.story().title }}.</strong> Each one has a colour from
              the palette, and the swatch beside their name in the chapter panel is the way to
              another of the ten. Below is the way out of the ten altogether — one colour, used in
              both themes, and yours to keep legible.
            </p>

            <div class="swatches">
              @for (character of cast(); track character.id) {
                <label class="swatch" [class.custom]="!!character.colourOverride">
                  <input
                    type="color"
                    [value]="character.colour"
                    (input)="setCharacterColour(character.id, $event)"
                  />
                  <span class="text">
                    <span class="name">{{ character.name || 'Unnamed character' }}</span>
                    <span class="ms-hint">{{ character.label }}</span>
                  </span>
                  @if (character.colourOverride) {
                    <button
                      matButton
                      class="revert"
                      (click)="clearCharacterColour($event, character.id)"
                    >
                      Back to the palette
                    </button>
                  }
                </label>
              }
            </div>
          }
        </mat-expansion-panel>

        <mat-expansion-panel>
          <mat-expansion-panel-header>
            <mat-panel-title>Advanced</mat-panel-title>
            <mat-panel-description>{{ advancedSummary() }}</mat-panel-description>
          </mat-expansion-panel-header>

          <p class="ms-hint under-the-hood">Options for people who want to look under the hood.</p>

          <div class="stack">
            <mat-slide-toggle
              [checked]="ui().checkForUpdates"
              (change)="setCheckForUpdates($event.checked)"
            >
              Check for a new version when Lamplit starts
            </mat-slide-toggle>
            <p class="ms-hint">
              Once per start, the server asks GitHub which versions have been published and the top
              bar says so if one of them is newer. Switched off, it is not asked at all. Your
              stories never leave this machine either way.
            </p>

            @if (isDesktop) {
              <hr />

              <mat-slide-toggle
                [checked]="ui().systemProxy"
                (change)="setSystemProxy($event.checked)"
              >
                Reach the model through this computer’s proxy
              </mat-slide-toggle>
              <p class="ms-hint">
                Off, Lamplit connects straight to whichever endpoint you have given it, the same as
                the zip and a browser tab do. Switch it on if your network only lets you out through
                a proxy — a work laptop, usually. Lamplit's window then takes a moment to find that
                proxy the first time it needs it, which is why it is not the default: on some
                networks that search takes twenty seconds, and nobody should wait for it just to
                open the app.
              </p>
            }

            <hr />

            <mat-slide-toggle
              [checked]="ui().developerMode"
              (change)="settings.patchUi({ developerMode: $event.checked })"
            >
              Developer mode — show how the prompt is built and what the app is doing
            </mat-slide-toggle>
            <p class="ms-hint">
              Puts the context pill back under the composer, which is the way into what the model
              actually sees, and adds the folder your documents are in to the About sheet. It
              changes nothing about the request itself.
            </p>
          </div>
        </mat-expansion-panel>
      </mat-accordion>
    </mat-dialog-content>

    <mat-dialog-actions align="end">
      <button matButton="filled" mat-dialog-close>Done</button>
    </mat-dialog-actions>
  `,
  styles: `
    mat-dialog-content {
      /* Tall enough that Advanced is reachable without hunting for a scrollbar. */
      max-height: min(78vh, 46rem) !important;
      padding-top: 0.5rem !important;
    }

    mat-expansion-panel {
      background: transparent !important;
    }

    mat-panel-description {
      flex: none;
      color: var(--ms-muted);
      font-size: 0.8rem;
    }

    .stack {
      display: flex;
      flex-direction: column;
      gap: 0.7rem;
      padding-bottom: 0.35rem;
    }

    .under-the-hood {
      margin: 0 0 1rem;
    }

    hr {
      width: 100%;
      border: 0;
      border-top: 1px solid var(--ms-border);
      margin: 0.35rem 0;
    }

    /* A switch with a sentence for a label wraps, and its own text should not
       run back under the switch when it does. */
    mat-slide-toggle {
      align-items: flex-start;
    }

    .size {
      display: flex;
      flex-direction: column;
      font-size: 0.8rem;
      color: var(--ms-muted);
    }

    .font {
      width: 18rem;
      max-width: 100%;
    }

    .editing {
      margin: 1.1rem 0 0.9rem;

      strong {
        color: var(--ms-ink);
        font-weight: 600;
      }
    }

    .row-head {
      display: flex;
      align-items: baseline;
      gap: 0.5rem;
      margin: 0.9rem 0 0.35rem;
    }

    .row-name {
      font-size: 0.9rem;
      color: var(--ms-ink);
    }

    /* Said rather than implied: a preset with your own colours over it is not
       that preset any more, and Reset is the only way back to one. */
    .tag {
      padding: 0.05rem 0.4rem;
      border: 1px solid color-mix(in srgb, var(--ms-accent) 45%, var(--ms-border));
      border-radius: 999px;
      color: var(--ms-muted);
      font-size: 0.7rem;
      letter-spacing: 0.02em;
    }

    .palette-lead {
      margin: 0 0 0.7rem;

      strong {
        color: var(--ms-ink);
        font-weight: 600;
      }
    }

    .palettes {
      display: grid;
      grid-template-columns: repeat(auto-fill, minmax(5.2rem, 1fr));
      gap: 0.5rem;
    }

    .palette {
      display: flex;
      flex-direction: column;
      align-items: stretch;
      gap: 0.3rem;
      padding: 0.3rem;
      border: 1px solid transparent;
      border-radius: 10px;
      background: none;
      color: var(--ms-muted);
      font: inherit;
      font-size: 0.75rem;
      text-align: center;
      cursor: pointer;

      &:hover {
        background: color-mix(in srgb, var(--ms-ink) 5%, transparent);
      }

      &.on {
        border-color: color-mix(in srgb, var(--ms-accent) 60%, transparent);
        color: var(--ms-ink);
      }
    }

    /* A page in miniature: the tint behind, a sheet on it, two lines of story
       and the accent. Enough to tell ten of them apart at a glance. */
    .preview {
      position: relative;
      display: block;
      height: 2.9rem;
      padding: 0.4rem 0.35rem;
      border: 1px solid var(--ms-border);
      border-radius: 7px;
      overflow: hidden;
    }

    .sheet {
      display: flex;
      flex-direction: column;
      justify-content: center;
      gap: 0.25rem;
      height: 100%;
      padding: 0 0.3rem;
      border-radius: 4px;
    }

    .line {
      height: 2px;
      border-radius: 1px;
      opacity: 0.85;
    }

    .line.short {
      width: 60%;
    }

    .dot {
      position: absolute;
      right: 0.3rem;
      bottom: 0.3rem;
      width: 0.42rem;
      height: 0.42rem;
      border-radius: 50%;
    }

    .palette-label {
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }

    .swatches {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(16rem, 1fr));
      gap: 0.35rem 1.25rem;
    }

    .swatch {
      display: flex;
      align-items: center;
      gap: 0.7rem;
      padding: 0.4rem 0.5rem;
      border: 1px solid transparent;
      border-radius: 10px;
      cursor: pointer;

      &:hover {
        background: color-mix(in srgb, var(--ms-ink) 5%, transparent);
      }

      /* A changed colour says so, so that Reset is not the only way to tell. */
      &.custom {
        border-color: color-mix(in srgb, var(--ms-accent) 45%, transparent);
      }
    }

    /* The native picker, with the browser's chrome around it pared back to a
       swatch: it is the only control here that is not Material's. */
    input[type='color'] {
      flex: none;
      width: 2.4rem;
      height: 2.4rem;
      padding: 0;
      border: 1px solid var(--ms-border);
      border-radius: 8px;
      background: none;
      cursor: pointer;

      &::-webkit-color-swatch-wrapper {
        padding: 3px;
      }

      &::-webkit-color-swatch {
        border: none;
        border-radius: 5px;
      }

      &::-moz-color-swatch {
        border: none;
        border-radius: 5px;
      }
    }

    .text {
      display: flex;
      flex-direction: column;
      min-width: 0;
    }

    .name {
      font-size: 0.9rem;
      color: var(--ms-ink);
    }

    .warning {
      margin: 0.9rem 0 0;
      padding: 0.6rem 0.8rem;
      border: 1px solid color-mix(in srgb, var(--ms-danger) 45%, var(--ms-border));
      border-radius: 10px;
      color: var(--ms-ink-soft);
      font-size: 0.8rem;
      line-height: 1.5;
      background: color-mix(in srgb, var(--ms-danger) 8%, transparent);
    }

    .reset {
      display: flex;
      justify-content: flex-end;
      margin-top: 0.75rem;
    }

    hr {
      border: 0;
      border-top: 1px solid var(--ms-border);
      margin: 1.1rem 0 0.9rem;
    }

    .revert {
      flex: none;
      font-size: 0.75rem;
    }
  `,
})
export class PreferencesDialog {
  protected readonly settings = inject(SettingsStore);
  protected readonly stories = inject(StoryStore);
  protected readonly chapters = inject(ChapterStore);
  private readonly updates = inject(UpdatesStore);
  private readonly dialogs = inject(DialogsService);

  protected readonly ui = this.settings.ui;
  /** Only the desktop shell has a proxy to switch; in a tab it is the browser's. */
  protected readonly isDesktop = desktop() !== null;
  protected readonly fonts = READING_FONTS;

  /**
   * What the stylesheet ships, for both themes, read once. These do not move
   * while the dialog is open — the only thing that changes is which of them an
   * override is sitting on top of.
   */
  private readonly shipped = new Map(
    THEME_COLOURS.flatMap(({ key }) =>
      (['dark', 'light'] as const).map(
        (theme) =>
          [`${theme}/${key}`, shippedColour(document.documentElement, key, theme)] as const,
      ),
    ),
  );

  /**
   * Whose page the row edits. A chapter with a palette of its own is the page
   * on screen, so a click here that quietly changed the story's instead would
   * look like it had done nothing at all.
   */
  protected readonly editingChapter = computed(() => !!this.chapters.chapter().palette);

  protected readonly currentPalette = computed(
    () => this.chapters.chapter().palette || this.ui().palette,
  );

  /** The presets, with the page as it ships in front of them. */
  protected readonly paletteOptions = computed(() => {
    const theme = this.ui().theme;
    const shipped = (key: ColourKey) => this.shipped.get(`${theme}/${key}`) || '#000000';
    return [
      {
        name: '',
        label: 'As it ships',
        title: 'The page Lamplit opens with.',
        page: shipped('page'),
        surface: shipped('surface'),
        ink: shipped('ink'),
        speech: shipped('speech'),
        accent: shipped('accent'),
      },
      ...PAGE_PALETTES.map((palette) => ({
        name: palette.name,
        label: palette.label,
        title: `${palette.description} ${palette.tags.join(', ')}.`,
        page: palette[theme].page,
        surface: palette[theme].surface,
        ink: palette[theme].ink,
        speech: palette[theme].speech,
        accent: palette[theme].accent,
      })),
    ];
  });

  protected choosePalette(name: string): void {
    if (this.editingChapter()) this.chapters.setPalette(this.chapters.chapter().id, name);
    else this.settings.setPalette(name);
  }

  /** Each colour as the page draws it now: the override, or the shipped one. */
  /** The open story's cast, each with the colour the input should show. */
  protected readonly cast = computed(() => {
    const theme = this.ui().theme;
    return this.stories.story().characters.map((character) => ({
      ...character,
      colour: characterColour(character, theme),
      label: characterColourLabel(character),
    }));
  });

  protected setCharacterColour(id: string, event: Event): void {
    this.stories.setCharacterColourOverride(id, (event.target as HTMLInputElement).value);
  }

  /** The label wraps the input, so a click on the button would open it too. */
  protected clearCharacterColour(event: Event, id: string): void {
    event.preventDefault();
    this.stories.setCharacterColourOverride(id, null);
  }

  protected readonly swatches = computed(() => {
    const { theme, colours } = this.ui();
    const overrides = colours[theme] ?? {};
    return THEME_COLOURS.map((spec) => ({
      ...spec,
      custom: !!overrides[spec.key],
      // Black is the last resort of a stylesheet that is not attached, which
      // outside a unit test does not happen; a colour input needs *some* hex.
      colour: overrides[spec.key] || this.shipped.get(`${theme}/${spec.key}`) || '#000000',
    }));
  });

  /** A colour set by hand: the state the palette row calls `custom`. */
  protected readonly customised = computed(() => this.swatches().some((s) => s.custom));

  protected readonly advancedSummary = computed(() => {
    const ui = this.ui();
    if (ui.developerMode) return 'developer mode on';
    return ui.checkForUpdates ? 'checking for new versions' : 'not checking for new versions';
  });

  protected readonly readingSummary = computed(() => {
    const ui = this.ui();
    return `${ui.theme} theme, ${ui.fontSize}px`;
  });

  protected readonly coloursSummary = computed(() => {
    const changed = this.swatches().filter((s) => s.custom).length;
    const font = READING_FONTS.find((f) => f.key === this.ui().font)?.label.toLowerCase();
    if (changed) return `${changed} changed in ${this.ui().theme}`;
    if (this.currentPalette()) return paletteLabel(this.currentPalette()).toLowerCase();
    return font === 'serif' ? 'as it ships' : `${font}`;
  });

  /**
   * Text on paper, which is the pair a reader loses the story over. A warning
   * and not a block: someone deliberately setting a low-contrast palette is
   * allowed to, they just should not do it by accident.
   */
  protected readonly contrastWarning = computed(() => {
    const swatches = this.swatches();
    const ink = swatches.find((s) => s.key === 'ink')?.colour ?? '';
    const paper = swatches.find((s) => s.key === 'surface')?.colour ?? '';
    const ratio = contrastRatio(ink, paper);
    if (Number.isNaN(ratio) || ratio >= AA_CONTRAST) return '';
    return (
      `Text on paper is ${ratio.toFixed(1)}:1, under the ${AA_CONTRAST}:1 that WCAG AA asks of ` +
      `body text. Nothing stops you — but this is the one pair the whole story is read in.`
    );
  });

  protected setColour(key: ColourKey, event: Event): void {
    const colour = (event.target as HTMLInputElement).value;
    this.settings.setColour(this.ui().theme, key, colour);
  }

  protected setFont(font: ReadingFont): void {
    this.settings.patchUi({ font });
  }

  /**
   * Switching it on asks now rather than at the next start: the label is about
   * what happens on a start, and waiting for one to find out would be silly.
   */
  protected setCheckForUpdates(on: boolean): void {
    this.settings.patchUi({ checkForUpdates: on });
    if (on) void this.updates.load();
  }

  /**
   * Takes effect on the next request rather than at the next start: the shell
   * changes the window's proxy when it is told, and there is nothing to restart.
   */
  protected setSystemProxy(on: boolean): void {
    this.settings.patchUi({ systemProxy: on });
    void desktop()
      ?.useSystemProxy(on)
      .catch(() => undefined);
  }

  protected async reset(): Promise<void> {
    const theme = this.ui().theme;
    const ok = await this.dialogs.confirm({
      title: `Put the ${theme} colours back?`,
      message: `Every colour you have changed in the ${theme} theme returns to the one underneath — the palette you picked, or what Lamplit ships. The other theme keeps yours.`,
      confirm: 'Reset',
    });
    if (ok) this.settings.resetColours(theme);
  }
}
