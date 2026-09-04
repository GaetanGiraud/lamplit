import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * The arguments the desktop build hands to electron-builder, worked out in one
 * place so that a `node:test` can read them. `tools/desktop.mjs` is a script
 * with effects at the top of it and cannot be imported to be asked.
 */

/** The version the whole repository is at: `npm version` writes only this one. */
export function rootVersion(root) {
  return readJson(join(root, 'package.json')).version;
}

/**
 * `--config.extraMetadata.version` is what makes the installers, `latest.yml`,
 * `app.getVersion()` and the release tag electron-publish looks for say the
 * version that was actually tagged.
 *
 * Without it electron-builder reads `electron/package.json`, which `npm version`
 * never touches: every release after the first would be built as 0.1.0, uploaded
 * to the already-published v0.1.0 release (or, finding it published, to nothing
 * at all, with an exit code of zero), and would tell every installed copy that
 * the newest version is the one it already has.
 */
export function builderArgs({ version, publish }) {
  return [
    'electron-builder',
    '--config',
    'electron-builder.yml',
    `--config.extraMetadata.version=${version}`,
    '--publish',
    publish ? 'always' : 'never',
  ];
}

function readJson(path) {
  return JSON.parse(readFileSync(path, 'utf8'));
}
