import { createRequire } from 'node:module';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * `npm run icons` — the raster icons, from app/public/favicon.svg.
 *
 * favicon.svg is the source and the one modern browsers use. This produces the
 * three that still have to be bitmaps: favicon.ico for the browsers that ignore
 * SVG icons, apple-touch-icon.png for the home screen, and electron/icons/
 * icon.png for the desktop build — electron-builder makes the per-platform
 * icons from that one, provided it is at least 256 px. Edit the SVG, run this,
 * commit all four.
 *
 * Rasterising is done by the browser Playwright already brings, so there is no
 * image library in the dependency list for two files that change once a year.
 */

const require = createRequire(import.meta.url);
const { chromium } = require('@playwright/test');

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const PUBLIC = join(ROOT, 'app', 'public');
const DESKTOP = join(ROOT, 'electron', 'icons');
const SOURCE = join(PUBLIC, 'favicon.svg');

/** What actually gets asked for: the tab, the bookmark bar, and the desktop. */
const ICO_SIZES = [16, 32, 48];
const APPLE_SIZE = 180;
/** electron-builder's minimum is 256; 512 is what it wants for Linux. */
const DESKTOP_SIZE = 512;

const svg = await readFile(SOURCE, 'utf8');
const browser = await chromium.launch();
const rendered = new Map();

try {
  for (const size of [...ICO_SIZES, APPLE_SIZE, DESKTOP_SIZE]) {
    rendered.set(size, await render(svg, size));
  }
} finally {
  await browser.close();
}

await mkdir(DESKTOP, { recursive: true });
await writeFile(join(PUBLIC, 'favicon.ico'), ico(ICO_SIZES.map((s) => rendered.get(s))));
await writeFile(join(PUBLIC, 'apple-touch-icon.png'), rendered.get(APPLE_SIZE));
await writeFile(join(DESKTOP, 'icon.png'), rendered.get(DESKTOP_SIZE));

console.log(`favicon.ico            ${ICO_SIZES.join(', ')} px`);
console.log(`apple-touch-icon.png   ${APPLE_SIZE} px`);
console.log(`electron/icons/icon.png ${DESKTOP_SIZE} px`);

/** One PNG of the source at `size`, drawn by a real browser. */
async function render(source, size) {
  const page = await browser.newPage({ viewport: { width: size, height: size } });
  await page.setContent(
    `<style>html,body{margin:0;background:transparent}svg{display:block}</style>${source.replace(
      /<svg([^>]*)width="\d+" height="\d+"/,
      `<svg$1width="${size}" height="${size}"`,
    )}`,
  );
  const png = await page.screenshot({ omitBackground: true });
  await page.close();
  return png;
}

/**
 * A .ico wrapping PNGs — legal since Vista and understood everywhere that
 * still asks for a .ico at all. Header, one 16-byte entry per image, then the
 * images themselves.
 */
function ico(images) {
  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0); // reserved
  header.writeUInt16LE(1, 2); // 1 = icon
  header.writeUInt16LE(images.length, 4);

  const entries = [];
  let offset = 6 + images.length * 16;
  images.forEach((png, index) => {
    const size = ICO_SIZES[index];
    const entry = Buffer.alloc(16);
    entry.writeUInt8(size === 256 ? 0 : size, 0);
    entry.writeUInt8(size === 256 ? 0 : size, 1);
    entry.writeUInt8(0, 2); // palette size: none
    entry.writeUInt8(0, 3); // reserved
    entry.writeUInt16LE(1, 4); // colour planes
    entry.writeUInt16LE(32, 6); // bits per pixel
    entry.writeUInt32LE(png.length, 8);
    entry.writeUInt32LE(offset, 12);
    offset += png.length;
    entries.push(entry);
  });

  return Buffer.concat([header, ...entries, ...images]);
}
