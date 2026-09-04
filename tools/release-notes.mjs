import { readFile, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * `npm run notes` — writes docs/releases.md from CHANGELOG.md.
 * `npm run check:notes` — fails if the two have drifted apart.
 *
 * The changelog is the release notes: the tag's workflow copies its top section
 * onto the draft release, and this copies the whole of it onto the website. One
 * place to write them, three places they appear, and no summary of a summary.
 *
 * The unreleased section is deliberately left out. It is a section about a
 * version nobody can download, and the website's readers are people deciding
 * whether to download one.
 *
 * The check runs in the release workflow beside `check:docs`, so a changelog
 * that was edited without regenerating this page fails before anything is
 * published rather than after.
 */

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const SOURCE = join(ROOT, 'CHANGELOG.md');
const PAGE = join(ROOT, 'docs', 'releases.md');

const HEADER = `# Release notes

[← Documentation](README.md) · The [download page](index.md) · [Upgrading](upgrading.md)

---

What changed in each version, as it was written when the version went out. The app shows the same
notes: **⋯ → About Lamplit → Release notes**, and the top bar says so when a newer one exists.

<!-- Generated from CHANGELOG.md by tools/release-notes.mjs. Edit the changelog. -->
`;

const checking = process.argv.includes('--check');

const changelog = normalise(await readFile(SOURCE, 'utf8'));
const page = `${HEADER}\n${released(changelog)}`;
const current = await readFile(PAGE, 'utf8').then(normalise, () => null);

if (!checking) {
  await writeFile(PAGE, page, 'utf8');
  console.log(`notes — docs/releases.md, ${count(page)} version(s) from CHANGELOG.md`);
} else if (current !== page) {
  console.error(
    '\ncheck:notes — docs/releases.md does not match CHANGELOG.md.\n\n' +
      '  The website serves the page as it is committed, so a changelog edited\n' +
      '  without it would put out a release whose notes are last version’s.\n' +
      '  Run `npm run notes` and commit what it writes.\n',
  );
  process.exit(1);
} else {
  console.log(`check:notes — docs/releases.md matches CHANGELOG.md (${count(page)} version(s)).`);
}

/**
 * Every `## ` section except the unreleased one, in the order the changelog has
 * them, which is newest first. The preamble above the first heading explains
 * the file to whoever edits it and means nothing to a reader of the website.
 */
function released(source) {
  const sections = source.split(/^## /m).slice(1);
  return sections
    .filter((section) => !/^unreleased\b/i.test(section))
    .map((section) => `## ${section.trimEnd()}\n`)
    .join('\n');
}

function count(page) {
  return (page.match(/^## /gm) ?? []).length;
}

/** This repository is edited on Windows; the page it writes is not CRLF. */
function normalise(text) {
  return text.replace(/\r\n/g, '\n');
}
