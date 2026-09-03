import { describe, expect, it } from 'vitest';
import { DEFAULT_SETTINGS } from './defaults';
import { UiSettings } from './models';
import {
  AA_CONTRAST,
  READING_FAMILY,
  READING_FONTS,
  THEME_COLOURS,
  applyUi,
  contrastRatio,
  propertyOf,
} from './theming';

function ui(patch: Partial<UiSettings> = {}): UiSettings {
  return { ...structuredClone(DEFAULT_SETTINGS.ui), ...patch };
}

describe('contrastRatio', () => {
  it('runs from 1 to 21', () => {
    expect(contrastRatio('#000000', '#ffffff')).toBeCloseTo(21, 5);
    expect(contrastRatio('#7a7a7a', '#7a7a7a')).toBe(1);
  });

  it('does not care which colour is the lighter one', () => {
    expect(contrastRatio('#22201c', '#fffdf8')).toBeCloseTo(
      contrastRatio('#fffdf8', '#22201c'),
      10,
    );
  });

  it('reads the short form, and refuses anything that is not a hex', () => {
    expect(contrastRatio('#fff', '#000')).toBeCloseTo(21, 5);
    expect(contrastRatio('white', '#000000')).toBeNaN();
    expect(contrastRatio('rgb(0 0 0)', '#ffffff')).toBeNaN();
  });

  it('agrees with WCAG on the pair the dialog warns about', () => {
    // The shipped light theme: ink on paper, comfortably over the floor.
    expect(contrastRatio('#22201c', '#fffdf8')).toBeGreaterThan(AA_CONTRAST);
    // Grey on white, the classic near miss.
    expect(contrastRatio('#949494', '#ffffff')).toBeLessThan(AA_CONTRAST);
  });
});

describe('applyUi', () => {
  it('writes the theme, and only the colours that were customised', () => {
    const root = document.createElement('html');
    applyUi(root, ui({ theme: 'dark', colours: { dark: { page: '#101010' } } }));

    expect(root.style.colorScheme).toBe('dark');
    expect(root.style.getPropertyValue(propertyOf('page'))).toBe('#101010');
    expect(root.style.getPropertyValue(propertyOf('ink'))).toBe('');
  });

  it('leaves the other theme alone, and puts a colour back when it is dropped', () => {
    const root = document.createElement('html');
    const colours = { dark: { page: '#101010' }, light: { page: '#fafafa' } };

    applyUi(root, ui({ theme: 'light', colours }));
    expect(root.style.getPropertyValue(propertyOf('page'))).toBe('#fafafa');

    // Reset is the override going away; nothing is left on the element to
    // override the stylesheet with, which is the whole of "back to default".
    applyUi(root, ui({ theme: 'light', colours: { dark: colours.dark } }));
    expect(root.style.getPropertyValue(propertyOf('page'))).toBe('');
    expect(root.style.colorScheme).toBe('light');
  });

  it('sets the reading face only when it is not the one that ships', () => {
    const root = document.createElement('html');

    applyUi(root, ui({ font: 'mono' }));
    expect(root.style.getPropertyValue(READING_FAMILY)).toBe('var(--ms-mono)');

    applyUi(root, ui({ font: 'serif' }));
    expect(root.style.getPropertyValue(READING_FAMILY)).toBe('');
  });

  it('ignores a name it does not know, rather than writing it out', () => {
    const root = document.createElement('html');
    const colours = { dark: { page: '#101010', gilding: '#c0a060' } } as UiSettings['colours'];
    applyUi(root, ui({ theme: 'dark', colours }));

    expect(root.style.getPropertyValue(propertyOf('page'))).toBe('#101010');
    expect(root.style.getPropertyValue('--ms-gilding')).toBe('');
  });
});

describe('the palette', () => {
  it('names every colour once, and every font stack points at the stylesheet', () => {
    const keys = THEME_COLOURS.map((c) => c.key);
    expect(new Set(keys).size).toBe(keys.length);
    for (const font of READING_FONTS) expect(font.stack).toMatch(/^var\(--ms-[a-z]+\)$/);
  });
});
