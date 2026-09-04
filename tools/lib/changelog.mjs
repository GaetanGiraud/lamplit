/**
 * The changelog, read the two ways the release needs it read: what belongs on
 * the website, and whether the section at the top is the one being tagged.
 */

/** The heading of the first `## ` section, without its hashes. */
export function topSection(changelog) {
  return /^## +(.+?) *$/m.exec(changelog.replace(/\r\n/g, '\n'))?.[1] ?? '';
}

/**
 * What is wrong with publishing this changelog as `version`'s notes, or ''.
 *
 * The tag's workflow copies the top section onto the draft release without
 * reading it. The top section is `## Unreleased` for the whole of the time
 * between releases — which is exactly when a tag gets pushed — so the release
 * would be published under a heading that says it is not one, while the
 * website, which drops the unreleased section on purpose, showed no notes for
 * it at all.
 */
export function notesProblem(changelog, version) {
  const heading = topSection(changelog);
  if (!heading) return 'CHANGELOG.md has no section to publish.';
  if (heading === version) return '';
  return (
    `CHANGELOG.md’s top section is “${heading}”, and the tag is ${version}. ` +
    'Rename that section to the version before tagging: it is what the release ' +
    'notes and the website are both made from.'
  );
}
