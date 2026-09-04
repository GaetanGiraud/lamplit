import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { builderArgs, rootVersion } from './lib/desktop-build.mjs';

/**
 * The desktop build, in three modes.
 *
 *   npm run desktop            build the app if needed, then open the window
 *   npm run desktop:stage      stage the folder the installers wrap, and stop
 *   npm run desktop:dist       stage, then build installers for this OS
 *
 * `--publish` on the last of those uploads them to the draft release for the
 * tag being built, which is the only thing the release workflow does that a
 * person running it here would not.
 *
 * Staging goes through `tools/package.mjs`, which is the one place that decides
 * what ships. The Electron shell is put around the result rather than beside
 * it: `electron/electron-builder.yml` copies that folder in whole, so the
 * desktop app and the zip are demonstrably the same server, the same built app
 * and the same dependencies.
 *
 * Development skips the staging altogether — `electron/main.mjs` reads the
 * repository directly when it is not packaged, so a change to the app needs
 * `npm run build` and a reload, not a rebuild of anything here.
 */

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const ELECTRON_DIR = join(ROOT, 'electron');
const STAGE_DIR = join(ROOT, 'build', 'desktop-stage');
const BUILT_APP = join(ROOT, 'app', 'dist', 'app', 'browser');

const options = parseArguments(process.argv.slice(2));

if (options.mode === 'run') {
  if (!existsSync(join(BUILT_APP, 'index.html'))) {
    step('the app has not been built yet');
    run('npm', ['run', 'build', '-w', 'app'], ROOT);
  }
  step('opening the window (the repository, not a packaged build)');
  run('npx', ['electron', '.'], ELECTRON_DIR);
} else {
  step(`staging into ${STAGE_DIR}`);
  // `process.execPath` and no shell: cmd.exe would split the path to node.exe,
  // and the path to this repository, on any space either of them contains.
  // `tools/dev.mjs` says the same thing where it starts the server.
  run(
    process.execPath,
    [join(ROOT, 'tools', 'package.mjs'), '--stage', STAGE_DIR, '--no-zip'],
    ROOT,
    {
      shell: false,
    },
  );

  if (options.mode === 'dist') {
    const version = rootVersion(ROOT);
    step(
      options.publish
        ? `building installers for ${version} and publishing them`
        : `building installers for ${version}`,
    );
    run('npx', builderArgs({ version, publish: options.publish }), ELECTRON_DIR);
    step('done');
    console.log(`   installers  ${join(ROOT, 'build', 'desktop')}`);
  } else {
    step('done');
    console.log(`   staged      ${STAGE_DIR}`);
  }
}

function parseArguments(argv) {
  const parsed = { mode: 'run', publish: false };
  for (const argument of argv) {
    if (argument === '--dist') parsed.mode = 'dist';
    else if (argument === '--stage-only') parsed.mode = 'stage';
    else if (argument === '--publish') parsed.publish = true;
    else fail(`unknown option ${argument} — expected --dist, --stage-only or --publish`);
  }
  if (parsed.publish && parsed.mode !== 'dist') fail('--publish only means something with --dist');
  return parsed;
}

/**
 * `shell` on Windows: npm and npx are .cmd there, which Node will not spawn.
 * Only they need it — a shell splits every argument on its spaces, so anything
 * carrying a path says `shell: false` and is spawned directly.
 */
function run(command, args, cwd, { shell = process.platform === 'win32' } = {}) {
  const result = spawnSync(command, args, {
    cwd,
    stdio: 'inherit',
    shell,
  });
  if (result.error) fail(`${command}: ${result.error.message}`);
  if (result.status !== 0) fail(`${command} ${args.join(' ')} failed`);
}

function step(message) {
  console.log(`\n• ${message}`);
}

function fail(message) {
  console.error(`\ndesktop: ${message}`);
  process.exit(1);
}
