import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { notesProblem, topSection } from '../lib/changelog.mjs';

const RELEASED = `# Changelog\n\nA preamble.\n\n## 0.1.1\n\nWhat changed.\n\n## 0.1.0\n\nThe first one.\n`;
const UNRELEASED = RELEASED.replace('## 0.1.1', '## Unreleased');

describe('the changelog’s top section', () => {
  it('is the heading of the first section, whatever it says', () => {
    assert.equal(topSection(RELEASED), '0.1.1');
    assert.equal(topSection(UNRELEASED), 'Unreleased');
    assert.equal(topSection('# Changelog\n\nNothing yet.\n'), '');
    // Written on Windows, read anywhere.
    assert.equal(topSection('# Changelog\r\n\r\n## 0.2.0\r\n\r\nWhat changed.\r\n'), '0.2.0');
  });
});

describe('publishing a tag’s notes', () => {
  it('is content when the top section is the version being tagged', () => {
    assert.equal(notesProblem(RELEASED, '0.1.1'), '');
  });

  it('refuses to publish the unreleased section as a release', () => {
    // The state a repository is in for the whole of the time between releases,
    // which is exactly when a tag is pushed.
    assert.match(notesProblem(UNRELEASED, '0.1.1'), /Unreleased/);
    assert.match(notesProblem(UNRELEASED, '0.1.1'), /0\.1\.1/);
  });

  it('refuses a top section that is some other version', () => {
    assert.match(notesProblem(RELEASED, '0.2.0'), /0\.1\.1/);
  });

  it('says so when there is nothing to publish at all', () => {
    assert.match(notesProblem('# Changelog\n\nNothing yet.\n', '0.1.1'), /no section/);
  });
});
