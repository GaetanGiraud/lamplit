import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * The desktop build, in three modes.
 *
 *   npm run desktop            build the app if needed, then open the window
 *   npm run desktop:stage      stage the folder the installers wrap, and stop
 *   npm run desktop:dist       stage, then build installers for this OS
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

const mode = parseMode(process.argv.slice(2));

if (mode === 'run') {
  if (!existsSync(join(BUILT_APP, 'index.html'))) {
    step('the app has not been built yet');
    run('npm', ['run', 'build', '-w', 'app'], ROOT);
  }
  step('opening the window (the repository, not a packaged build)');
  run('npx', ['electron', '.'], ELECTRON_DIR);
} else {
  step(`staging into ${STAGE_DIR}`);
  run('node', [join(ROOT, 'tools', 'package.mjs'), '--stage', STAGE_DIR, '--no-zip'], ROOT);

  if (mode === 'dist') {
    step('building installers');
    run('npx', ['electron-builder', '--config', 'electron-builder.yml'], ELECTRON_DIR);
    step('done');
    console.log(`   installers  ${join(ROOT, 'build', 'desktop')}`);
  } else {
    step('done');
    console.log(`   staged      ${STAGE_DIR}`);
  }
}

function parseMode(argv) {
  if (!argv.length) return 'run';
  if (argv.length === 1 && argv[0] === '--dist') return 'dist';
  if (argv.length === 1 && argv[0] === '--stage-only') return 'stage';
  fail(`unknown option ${argv.join(' ')} — expected --dist or --stage-only`);
}

/** `shell` on Windows: npm and npx are .cmd there, which Node will not spawn. */
function run(command, args, cwd) {
  const result = spawnSync(command, args, {
    cwd,
    stdio: 'inherit',
    shell: process.platform === 'win32',
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
