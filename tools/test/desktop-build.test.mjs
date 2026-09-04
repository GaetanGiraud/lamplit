import assert from 'node:assert/strict';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readFileSync } from 'node:fs';
import { describe, it } from 'node:test';
import { builderArgs, rootVersion } from '../lib/desktop-build.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');

describe('the desktop build’s arguments', () => {
  it('stamps the version the repository is at, not the shell’s own', () => {
    const args = builderArgs({ version: '9.9.9', publish: false });
    assert.ok(args.includes('--config.extraMetadata.version=9.9.9'));

    // The shell's package.json is not what `npm version` writes, so a build
    // that trusted it would carry the same version out of every release.
    const shell = JSON.parse(readFileSync(join(ROOT, 'electron', 'package.json'), 'utf8'));
    assert.equal(
      typeof shell.version,
      'string',
      'the shell still needs a version; it is just not the one that ships',
    );
  });

  it('publishes only when it was asked to', () => {
    assert.deepEqual(builderArgs({ version: '1.0.0', publish: true }).slice(-2), [
      '--publish',
      'always',
    ]);
    // Said out loud rather than left out: off a tag, CI makes electron-builder
    // publish "on tag or draft" by default, and a draft is exactly what a
    // release waiting to be looked at is.
    assert.deepEqual(builderArgs({ version: '1.0.0', publish: false }).slice(-2), [
      '--publish',
      'never',
    ]);
  });

  it('reads the version from the root package.json', () => {
    const root = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8'));
    assert.equal(rootVersion(ROOT), root.version);
  });
});
