import { describe, expect, it } from 'vitest';
import {
  PAGE_PALETTES,
  buildPalettePrompt,
  pagePalette,
  paletteLabel,
  paletteSchema,
  readPaletteName,
} from './page-palettes';
import { THEME_COLOURS, contrastRatio } from './theming';

/**
 * A palette is a claim — a whole page, in both themes, that a story can be read
 * on — and this is the claim being checked rather than restated. The floors are
 * the shipped theme's own: its text sits at 13:1 on its paper and its muted
 * furniture at 3.35:1, so a palette that came in under either would be a page
 * Lamplit does not otherwise offer.
 */

/** Every surface text is ever set on, and the roles that are set on them. */
const SHEETS = ['page', 'surface', 'surface-raised'] as const;
const FLOORS = {
  ink: 8,
  'ink-soft': 4.5,
  action: 4.5,
  accent: 4.5,
  speech: 4.5,
  danger: 4.5,
  muted: 3.2,
} as const;

describe('the page palettes', () => {
  it('is ten pages, each named and described once', () => {
    expect(PAGE_PALETTES).toHaveLength(10);
    expect(new Set(PAGE_PALETTES.map((p) => p.name)).size).toBe(10);
    expect(new Set(PAGE_PALETTES.map((p) => p.label)).size).toBe(10);
    for (const palette of PAGE_PALETTES) {
      expect(palette.name).toMatch(/^[a-z]+$/);
      expect(palette.description.length).toBeGreaterThan(20);
      expect(palette.tags.length).toBeGreaterThanOrEqual(4);
    }
  });

  it('says something about every colour the panel edits, in both themes', () => {
    for (const palette of PAGE_PALETTES) {
      for (const theme of ['light', 'dark'] as const) {
        for (const { key } of THEME_COLOURS) {
          expect(palette[theme][key], `${palette.name}/${theme}/${key}`).toMatch(/^#[0-9a-f]{6}$/);
        }
      }
    }
  });

  it('clears WCAG AA for body text on every paper of both themes', () => {
    for (const palette of PAGE_PALETTES) {
      for (const theme of ['light', 'dark'] as const) {
        for (const [key, floor] of Object.entries(FLOORS)) {
          for (const sheet of SHEETS) {
            const ratio = contrastRatio(
              palette[theme][key as keyof typeof FLOORS],
              palette[theme][sheet],
            );
            expect(
              ratio,
              `${palette.name} ${theme}: ${key} on ${sheet} is ${ratio.toFixed(2)}:1`,
            ).toBeGreaterThanOrEqual(floor);
          }
        }
      }
    }
  });

  it('is ten different pages, not one page ten times', () => {
    for (const theme of ['light', 'dark'] as const) {
      const papers = PAGE_PALETTES.map((p) => p[theme].page);
      expect(new Set(papers).size).toBe(papers.length);
    }
  });
});

describe('the request', () => {
  it('offers the model the names, and nothing but the names', () => {
    const schema = paletteSchema();
    const property = (schema.schema['properties'] as { palette: { enum: string[] } }).palette;
    expect(property.enum).toEqual(PAGE_PALETTES.map((p) => p.name));
  });

  it('carries the scene, every palette and what each one is for', () => {
    const [system, user] = buildPalettePrompt('  A lighthouse gallery. Dusk.  ');
    expect(system.role).toBe('system');
    expect(user.content).toContain('A lighthouse gallery. Dusk.');
    for (const palette of PAGE_PALETTES) {
      expect(user.content).toContain(palette.name);
      expect(user.content).toContain(palette.tags[0]);
    }
    // The colours are the one thing it never sees.
    expect(user.content).not.toContain('#');
  });
});

describe('reading the answer', () => {
  it('takes the name out of the object a schema produces', () => {
    expect(readPaletteName({ palette: 'frost' })).toBe('frost');
    expect(readPaletteName({ palette: ' Frost ' })).toBe('frost');
  });

  it('takes a bare word out of an endpoint that never saw the schema', () => {
    expect(readPaletteName(null, 'nocturne')).toBe('nocturne');
    expect(readPaletteName(null, 'The scene is cold, so: frost.')).toBe('frost');
  });

  it('refuses a name that is not one of ours, however confidently offered', () => {
    expect(readPaletteName({ palette: 'moonlight' }, 'moonlight')).toBe('');
    expect(readPaletteName(null, 'frostbite')).toBe('');
    expect(readPaletteName(undefined, '')).toBe('');
  });
});

describe('looking one up', () => {
  it('knows the ones it has and admits to the ones it does not', () => {
    expect(pagePalette('tide')?.label).toBe('Tide');
    expect(pagePalette('')).toBeNull();
    expect(pagePalette(undefined)).toBeNull();
    // A name from a later version, in a document this build opened.
    expect(pagePalette('gaslight')).toBeNull();
    expect(paletteLabel('gaslight')).toBe('As it ships');
  });
});
