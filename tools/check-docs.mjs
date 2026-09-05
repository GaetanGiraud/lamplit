import { readdir, readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { dirname, join, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * `npm run check:docs` — the links in docs/ still work as a website.
 *
 * The guide is served by GitHub Pages exactly as it is written, which means
 * `jekyll-relative-links` is what turns `[Chapters](chapters.md)` into a working
 * `.html` link. It is a regex, and it has two blind spots that fail silently:
 * the page still builds, the link still looks right in the markdown, and the
 * visitor gets a page of raw markdown. Both were live on the first deploy.
 *
 *   1. A link whose *text* wraps onto the next line is not matched at all.
 *      Re-wrapping a paragraph is enough to break one, which is exactly the
 *      kind of edit nobody re-checks.
 *   2. An `href` in raw HTML is never rewritten — only markdown links are. The
 *      landing page is mostly raw HTML, so its internal links say `.html`
 *      already; anywhere else, `.md` in an href is a mistake.
 *
 *   3. jekyll-optional-front-matter refuses to make a page out of four repo
 *      meta-files — README, CONTRIBUTING, CODE_OF_CONDUCT, LICENSE — so a link
 *      to one of those is raw markdown unless _config.yml names it under
 *      `include`. Every page in the guide links to README.md, and this is the
 *      fault that shipped.
 *
 * Plus the ordinary one: a link or picture pointing at a file that is not there.
 *
 * Offline, deterministic, and in the release workflow, because the failure it
 * catches is invisible until someone clicks.
 *
 * The second job is the promise the landing page makes in its foot: this site
 * sets no cookies and loads nothing from anyone else. A stylesheet from a CDN,
 * a web font, an embedded video, an analytics snippet — each is a request that
 * tells a company we do not control that someone read this page, and any of
 * them can arrive in one line that looks like an improvement. So the rule
 * written at the top of _config.yml is checked here rather than remembered:
 * everything the browser fetches must be served from this site.
 */

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const DOCS = join(ROOT, 'docs');

/** Written as HTML on purpose: it is the website's page and never read on GitHub. */
const HTML_LINKS_ALLOWED = new Set(['index.md']);

/** Jekyll will not build a page from these unless _config.yml asks it to. */
const META_FILES = ['README.md', 'CONTRIBUTING.md', 'CODE_OF_CONDUCT.md', 'LICENSE.md'];

/**
 * Everything a browser goes and fetches on its own, as opposed to a link a
 * reader chooses to follow. Attributes, `@import` and CSS `url()`, plus
 * markdown pictures, which the link pass above lets through when they are
 * absolute.
 */
const FETCHED = [
  [/<script\b[^>]*\bsrc=["']?([^"'\s>]+)/gi, 'a script'],
  [/<link\b[^>]*\bhref=["']?([^"'\s>]+)/gi, 'a stylesheet, font or icon'],
  [
    /<(?:img|iframe|video|audio|source|track|embed)\b[^>]*\bsrc=["']?([^"'\s>]+)/gi,
    'an embedded file',
  ],
  [/<object\b[^>]*\bdata=["']?([^"'\s>]+)/gi, 'an embedded file'],
  [/@import\s+(?:url\()?\s*["']?([^"')\s;]+)/gi, 'an imported stylesheet'],
  [/\burl\(\s*["']?([^"')]+)/gi, 'a file named in CSS'],
  [/!\[[^\]]*\]\(\s*([^)\s]+)/g, 'a picture'],
];

/** `https://x`, `http://x` and `//x` — anything with a host of its own. */
const ANOTHER_HOST = /^(?:[a-z][a-z0-9+.-]*:)?\/\//i;

const problems = [];
const files = (await readdir(DOCS)).filter((f) => f.endsWith('.md')).sort();
/** The pages, and the two folders of HTML that wrap every one of them. */
const served = [
  ...files,
  ...(await readdir(DOCS, { recursive: true }))
    .filter((f) => f.endsWith('.html'))
    .map((f) => f.split(sep).join('/'))
    .sort(),
];
// Normalised: this repo is edited on Windows, so every one of these files is
// CRLF on disk, and a pattern anchored on \n silently matches nothing.
const config = normalise(await readFile(join(DOCS, '_config.yml'), 'utf8'));
// Only the `include:` block. `header_pages:` lists README.md too, and reading
// both would have this check pass while the site served raw markdown.
const included = new Set(
  (config.match(/^include:\n((?:[ \t]+-[^\n]*\n)+)/m)?.[1] ?? '')
    .split('\n')
    .map((line) => line.replace(/^[ \t]*-[ \t]*/, '').trim())
    .filter(Boolean),
);

for (const file of files) {
  const source = withoutCode(normalise(await readFile(join(DOCS, file), 'utf8')));

  // [text](target) and ![alt](target); `s` so link text may span lines.
  for (const match of source.matchAll(/(!?)\[([^\]]*)\]\(([^)\s]+)\)/gs)) {
    const [, bang, text, target] = match;
    if (/^(https?:|mailto:|#)/.test(target)) continue;

    const [path] = target.split('#');
    if (path && !existsSync(join(DOCS, path))) {
      problems.push(`${file}: link to ${path}, which does not exist`);
      continue;
    }
    if (bang || !path.endsWith('.md')) continue;

    const base = path.split('/').pop();
    if (META_FILES.includes(base) && !included.has(base)) {
      problems.push(
        `${file}: links to ${base}, which jekyll-optional-front-matter skips, so no ` +
          `${base.replace(/\.md$/, '.html')} is built and the visitor gets raw markdown. ` +
          `Add "${base}" under include: in docs/_config.yml.`,
      );
      continue;
    }

    if (text.includes('\n')) {
      problems.push(
        `${file}: the link to ${path} has text that wraps onto the next line, so ` +
          `jekyll-relative-links will leave it as .md and the visitor gets raw markdown. ` +
          `Put the whole [text](${path}) on one line.`,
      );
    }
  }

  if (HTML_LINKS_ALLOWED.has(file)) continue;
  for (const match of source.matchAll(/href="([^"]+\.md)(#[^"]*)?"/g)) {
    problems.push(
      `${file}: href="${match[1]}" is inside raw HTML, which is never rewritten. ` +
        `Use a markdown link, or write .html.`,
    );
  }
}

for (const file of served) {
  // Markdown hides its examples in code fences; HTML hides its notes in
  // comments. Neither is fetched by anybody.
  const source = file.endsWith('.md')
    ? withoutCode(normalise(await readFile(join(DOCS, file), 'utf8')))
    : normalise(await readFile(join(DOCS, file), 'utf8')).replace(/<!--[\s\S]*?-->/g, '');

  for (const [pattern, what] of FETCHED) {
    for (const [, target] of source.matchAll(pattern)) {
      if (!ANOTHER_HOST.test(target)) continue;
      problems.push(
        `${file}: ${what} is fetched from ${target}, which is not this site. ` +
          `The rule is at the top of _config.yml: no analytics, no CDN, no web ` +
          `font, no embed. Serve the file from docs/ or do without it.`,
      );
    }
  }
}

if (problems.length) {
  console.error(`\ncheck:docs — ${problems.length} problem(s):\n`);
  for (const problem of problems) console.error(`  ${problem}`);
  console.error('');
  process.exit(1);
}
console.log(
  `check:docs — ${files.length} pages, every link resolves and will be rewritten, ` +
    `and nothing in ${served.length} files is fetched from another host.`,
);

function normalise(text) {
  return text.replace(/\r\n/g, '\n');
}

/** Code and comments talk *about* links; they do not contain any. */
function withoutCode(source) {
  return source
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/```[\s\S]*?```/g, '')
    .replace(/(^|\n)(?: {4}|\t)[^\n]*/g, '$1')
    .replace(/`[^`\n]*`/g, '');
}
