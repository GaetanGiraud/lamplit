import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { cp, mkdir, rm, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { collectEntries, writeZip } from '../server/src/zip.js';

/**
 * `npm run package` — the whole app as one folder, and that folder as one zip.
 *
 * Unzip it anywhere and run `start.bat` (Windows) or `start.sh` (Linux, macOS).
 * There is nothing to install: the server's dependencies travel inside, and
 * Node is the only thing expected to be on the machine already.
 *
 *   magicstories-<version>/
 *     start.bat  start.sh   one call, opens the browser
 *     server/               the persistence server, unchanged from the repo
 *     public/               the built Angular app, served by it
 *     node_modules/         the server's production dependencies, and only those
 *     package.json  README.txt
 *     data/                 created on first run, next to the script
 *
 * Electron comes later and wraps exactly this; nothing here is shaped for it
 * yet beyond the fact that the server already takes its folders as options.
 */

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const ROOT_MODULES = join(ROOT, 'node_modules');
const BUILT_APP = join(ROOT, 'app', 'dist', 'app', 'browser');

const options = parseArguments(process.argv.slice(2));
const version = readJson(join(ROOT, 'package.json')).version;
const name = `magicstories-${version}`;
const outDir = resolve(options.out ?? join(ROOT, 'build'));
const stageDir = join(outDir, name);
const zipPath = join(outDir, `${name}.zip`);

step(`MagicStories ${version} → ${zipPath}`);

if (options.build === false) {
  step('skipping the Angular build (--no-build)');
} else {
  step('building the app');
  run('npm', ['run', 'build', '-w', 'app']);
}
if (!existsSync(join(BUILT_APP, 'index.html'))) {
  fail(`no built app at ${BUILT_APP}. Run without --no-build.`);
}

step('staging');
await rm(stageDir, { recursive: true, force: true });
await mkdir(stageDir, { recursive: true });
await cp(join(ROOT, 'server', 'src'), join(stageDir, 'server', 'src'), { recursive: true });
await cp(BUILT_APP, join(stageDir, 'public'), { recursive: true });
await writeFile(join(stageDir, 'package.json'), manifest(), 'utf8');
await writeFile(join(stageDir, 'start.bat'), startBat().replaceAll('\n', '\r\n'), 'utf8');
await writeFile(join(stageDir, 'start.sh'), startSh(), { encoding: 'utf8', mode: 0o755 });
await writeFile(join(stageDir, 'README.txt'), readme(), 'utf8');

step('collecting the server’s production dependencies');
const dependencies = productionClosure(join(ROOT, 'server'));
for (const [dependency, from] of dependencies) {
  await cp(from, join(stageDir, 'node_modules', ...dependency.split('/')), { recursive: true });
}
console.log(`   ${dependencies.size} packages`);

step('zipping');
const entries = await collectEntries(stageDir, name, {
  mode: (entry) => (entry.endsWith('start.sh') ? 0o755 : 0o644),
});
const size = await writeZip(zipPath, entries);

step('done');
console.log(`   folder  ${stageDir}`);
console.log(`   zip     ${zipPath}  (${megabytes(size)}, ${entries.length} entries)`);
console.log(`   unzip it, then run start.bat (Windows) or ./start.sh (Linux, macOS).`);

// -- the pieces --------------------------------------------------------------

function manifest() {
  const server = readJson(join(ROOT, 'server', 'package.json'));
  return `${JSON.stringify(
    {
      name: 'magicstories',
      version,
      private: true,
      type: 'module',
      description: readJson(join(ROOT, 'package.json')).description,
      main: 'server/src/index.js',
      scripts: { start: 'node server/src/index.js --open' },
      dependencies: server.dependencies,
    },
    null,
    2,
  )}\n`;
}

function startBat() {
  return `@echo off
rem MagicStories — start the app and open it in the browser.
setlocal
cd /d "%~dp0"

where node >nul 2>nul
if errorlevel 1 (
  echo MagicStories needs Node.js 20.19 or newer.
  echo Install it from https://nodejs.org and run this again.
  echo.
  pause
  exit /b 1
)

node "%~dp0server\\src\\index.js" --open %*
if errorlevel 1 pause
`;
}

function startSh() {
  return `#!/bin/sh
# MagicStories — start the app and open it in the browser.
set -eu
cd "$(dirname "$0")"

if ! command -v node >/dev/null 2>&1; then
  echo "MagicStories needs Node.js 20.19 or newer." >&2
  echo "Install it from https://nodejs.org and run this again." >&2
  exit 1
fi

exec node server/src/index.js --open "$@"
`;
}

function readme() {
  return `MagicStories ${version}
=====================================

Running it
----------
  Windows      double-click start.bat
  Linux, macOS ./start.sh

One call starts the server and opens http://127.0.0.1:4177/ in your browser.
Close the window (or press Ctrl+C) to stop it. Node.js 20.19+ is the only thing
that has to be installed already — everything else is in this folder.

Your stories
------------
They are written to the "data" folder next to this file, one JSON file per
document: settings.json, stories/<id>.json, chapters/<id>.json. Copy that folder
and you have copied everything. A zip of it is taken into "backups" once a day
when the app starts.

Move the whole folder wherever you like; the data goes with it.

Options
-------
  start.bat --port 5000        listen somewhere else
  start.bat --data D:\\stories  keep the documents somewhere else
  MS_OPEN=0                    do not open a browser
  MS_BACKUP=0                  do not take the daily backup

Your API key
------------
The key you paste into Connection is stored in plain text in data/settings.json,
on this machine. That is deliberate for a single-user local tool. The server
listens on 127.0.0.1 only, so nothing on your network can reach it. Do not run
this on a machine you share.
`;
}

/**
 * Every package the server needs at runtime, resolved the way Node resolves
 * them rather than by asking npm — this works offline and copies exactly the
 * versions that were tested. Nested copies (a dependency pinned to its own
 * version of something) travel inside their parent's folder, so only packages
 * that sit at the top level are listed here.
 */
function productionClosure(from) {
  const found = new Map();
  const visited = new Set();

  const visit = (dir) => {
    if (visited.has(dir)) return;
    visited.add(dir);
    const manifest = readJson(join(dir, 'package.json'));
    const required = Object.keys(manifest.dependencies ?? {});
    const optional = Object.keys(manifest.optionalDependencies ?? {});
    for (const dependency of [...required, ...optional]) {
      const target = resolvePackage(dependency, dir);
      if (!target) {
        if (optional.includes(dependency)) continue;
        fail(`${manifest.name} needs ${dependency}, which is not installed. Run npm install.`);
      }
      if (target === join(ROOT_MODULES, ...dependency.split('/'))) found.set(dependency, target);
      visit(target);
    }
  };

  visit(from);
  return new Map([...found].sort(([a], [b]) => a.localeCompare(b)));
}

/** node_modules lookup: this folder's, then every folder above it. */
function resolvePackage(dependency, from) {
  let dir = from;
  for (;;) {
    const candidate = join(dir, 'node_modules', ...dependency.split('/'));
    if (existsSync(join(candidate, 'package.json'))) return candidate;
    const parent = dirname(dir);
    if (parent === dir) return null;
    dir = parent;
  }
}

/** `shell` on Windows: npm is a .cmd there, and Node will not spawn one directly. */
function run(command, args) {
  const result = spawnSync(command, args, {
    cwd: ROOT,
    stdio: 'inherit',
    shell: process.platform === 'win32',
  });
  if (result.error) fail(`${command}: ${result.error.message}`);
  if (result.status !== 0) fail(`${command} ${args.join(' ')} failed`);
}

function parseArguments(argv) {
  const parsed = {};
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--no-build') parsed.build = false;
    else if (argv[i] === '--out') parsed.out = argv[++i];
    else fail(`unknown option ${argv[i]}`);
  }
  return parsed;
}

function readJson(path) {
  return JSON.parse(readFileSync(path, 'utf8'));
}

function megabytes(bytes) {
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

function step(message) {
  console.log(`\n• ${message}`);
}

function fail(message) {
  console.error(`\npackage: ${message}`);
  process.exit(1);
}
