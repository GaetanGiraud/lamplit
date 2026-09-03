import { Component, computed, inject } from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { MatDialogModule } from '@angular/material/dialog';
import { MatExpansionModule } from '@angular/material/expansion';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatSelectModule } from '@angular/material/select';
import { MatSliderModule } from '@angular/material/slider';
import { MatSlideToggleModule } from '@angular/material/slide-toggle';
import { ColourKey, ReadingFont } from '../../core/models';
import {
  AA_CONTRAST,
  READING_FONTS,
  THEME_COLOURS,
  contrastRatio,
  shippedColour,
} from '../../core/theming';
import { SettingsStore } from '../../store/settings-store';
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
        </mat-expansion-panel>

        <mat-expansion-panel>
          <mat-expansion-panel-header>
            <mat-panel-title>Advanced</mat-panel-title>
            <mat-panel-description>{{ advancedSummary() }}</mat-panel-description>
          </mat-expansion-panel-header>

          <p class="ms-hint under-the-hood">Options for people who want to look under the hood.</p>

          <div class="stack">
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
  `,
})
export class PreferencesDialog {
  protected readonly settings = inject(SettingsStore);
  private readonly dialogs = inject(DialogsService);

  protected readonly ui = this.settings.ui;
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

  /** Each colour as the page draws it now: the override, or the shipped one. */
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

  protected readonly customised = computed(() => this.swatches().some((s) => s.custom));

  protected readonly advancedSummary = computed(() =>
    this.ui().developerMode ? 'developer mode on' : 'nothing switched on',
  );

  protected readonly readingSummary = computed(() => {
    const ui = this.ui();
    return `${ui.theme} theme, ${ui.fontSize}px`;
  });

  protected readonly coloursSummary = computed(() => {
    const changed = this.swatches().filter((s) => s.custom).length;
    const font = READING_FONTS.find((f) => f.key === this.ui().font)?.label.toLowerCase();
    if (!changed) return font === 'serif' ? 'as it ships' : `${font}`;
    return `${changed} changed in ${this.ui().theme}`;
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

  protected async reset(): Promise<void> {
    const theme = this.ui().theme;
    const ok = await this.dialogs.confirm({
      title: `Put the ${theme} colours back?`,
      message: `Every colour you have changed in the ${theme} theme returns to the one Lamplit ships. The other theme keeps yours.`,
      confirm: 'Reset',
    });
    if (ok) this.settings.resetColours(theme);
  }
}
