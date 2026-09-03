import { spawn, spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { rm } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * `npm run smoke` — a completely fresh install, in one command.
 *
 * Builds the package, unzips the archive (not the staging folder: the archive
 * is part of what is being tested) into an empty directory, and starts it the
 * way anyone else would, through start.bat or start.sh. No data, no settings,
 * no key: the app opens on the connection sheet with nothing behind it.
 *
 * This is the human half of the acceptance run — the automated half is
 * `e2e/specs/journey.spec.ts`, which walks the same ground against a fake
 * model. What this is for is the half a fake model cannot check: whether a
 * real one, on a real key, actually tells a decent story. The script to follow
 * is in PLAN.md §4.5.
 *
 * Ctrl+C stops it. Run it again and the folder is wiped and rebuilt.
 */

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const WINDOWS = process.platform === 'win32';
const version = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8')).version;
const zip = join(ROOT, 'build', `magicstories-${version}.zip`);
const fresh = join(ROOT, 'build', 'fresh-install');

const skipBuild = process.argv.includes('--no-build');

if (skipBuild && !existsSync(zip)) fail(`no archive at ${zip}. Run without --no-build.`);
if (!skipBuild) {
  step('packaging');
  run(process.execPath, [join(ROOT, 'tools', 'package.mjs')]);
}

step('unpacking into an empty folder');
await rm(fresh, { recursive: true, force: true });
extract(zip, fresh);
const app = join(fresh, `magicstories-${version}`);
if (!existsSync(app)) fail(`the archive did not unpack as expected into ${fresh}`);

step('starting it the way anyone else would');
console.log(`   ${app}`);
console.log(`   no data, no settings, no key — the app opens on the connection sheet.`);
console.log(`   the script to follow is PLAN.md §4.5. Ctrl+C stops it.\n`);

const script = join(app, WINDOWS ? 'start.bat' : 'start.sh');
const child = spawn(script, [], { cwd: app, stdio: 'inherit', shell: WINDOWS });
child.on('exit', (code) => process.exit(code ?? 0));
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => child.kill());

// -- the pieces --------------------------------------------------------------

/** Whatever unzips archives on this machine; both are there by default. */
function extract(archive, into) {
  const result = WINDOWS
    ? spawnSync(
        'powershell.exe',
        [
          '-NoProfile',
          '-Command',
          `Expand-Archive -Path '${archive}' -DestinationPath '${into}' -Force`,
        ],
        { stdio: 'inherit' },
      )
    : spawnSync('unzip', ['-q', archive, '-d', into], { stdio: 'inherit' });
  if (result.error) fail(`could not unzip: ${result.error.message}`);
  if (result.status !== 0) fail('unzip failed');
}

function run(command, args) {
  const result = spawnSync(command, args, { cwd: ROOT, stdio: 'inherit' });
  if (result.error) fail(`${command}: ${result.error.message}`);
  if (result.status !== 0) fail(`${command} ${args.join(' ')} failed`);
}

function step(message) {
  console.log(`\n• ${message}`);
}

function fail(message) {
  console.error(`\nsmoke: ${message}`);
  process.exit(1);
}
