import { spawn, spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { createServer } from 'node:net';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * `npm run smoke` — a completely fresh install, in one command.
 *
 * Builds the package, unzips the archive (not the staging folder: the archive
 * is part of what is being tested) into an empty directory, and starts it the
 * way anyone else would, through start.bat or start.sh.
 *
 * **On a port this machine has not used for a smoke run before**, which is the
 * only reason that line is here. An empty `data/` folder is not a fresh install
 * on its own: the browser keeps its own copy of every document, and when a
 * browser holding documents meets a server holding none, the app uploads them —
 * that is the deliberate "first run after this app grew a backend" path, and
 * persistence.spec.ts asserts it. So a second smoke run on the same URL would
 * quietly restore the first run's story into the "empty" install and call it
 * new. Browser storage is keyed by origin, and the port is part of the origin,
 * so a port that has never served this app has no storage behind it. Used ports
 * are remembered in build/.smoke-ports.json so it is a guarantee rather than a
 * probability.
 *
 * Ctrl+C stops it. Run it again and the folder, the data and the origin are all
 * new.
 *
 *   --no-build   reuse the last archive
 *   --port N     pin the port. Then it is your job to clear site data for that
 *                origin first, and the script says so.
 *
 * The automated half of the same walk is e2e/specs/journey.spec.ts; the script
 * to follow here is PLAN.md §4.5.
 */

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const WINDOWS = process.platform === 'win32';
const BUILD = join(ROOT, 'build');
const SPENT_PORTS = join(BUILD, '.smoke-ports.json');
/** High enough to be out of the way, wide enough never to run out. */
const PORT_RANGE = [8300, 8999];

const version = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8')).version;
const zip = join(BUILD, `magicstories-${version}.zip`);
const fresh = join(BUILD, 'fresh-install');

const argv = process.argv.slice(2);
const skipBuild = argv.includes('--no-build');
const pinned = argv.includes('--port') ? Number(argv[argv.indexOf('--port') + 1]) : null;

let server = null;
let stopping = false;

await main().catch(async (error) => {
  console.error(`\nsmoke: ${error.message}`);
  await stop(1);
});

async function main() {
  if (skipBuild && !existsSync(zip))
    throw new Error(`no archive at ${zip}. Run without --no-build.`);
  if (!skipBuild) {
    step('packaging');
    run(process.execPath, [join(ROOT, 'tools', 'package.mjs')]);
  }

  step('unpacking into an empty folder');
  try {
    await rm(fresh, { recursive: true, force: true });
  } catch (error) {
    // Almost always the server from the last smoke run, still holding it open.
    if (error.code !== 'EBUSY' && error.code !== 'EPERM') throw error;
    throw new Error(
      `${fresh} is locked — a server from an earlier smoke run is probably still ` +
        'going. Stop it (Ctrl+C in its window) and try again.',
    );
  }
  extract(zip, fresh);
  const app = join(fresh, `magicstories-${version}`);
  if (!existsSync(app)) throw new Error(`the archive did not unpack as expected into ${fresh}`);

  const port = pinned ?? (await unusedPort());
  const url = `http://127.0.0.1:${port}/`;

  step('starting it the way anyone else would');
  console.log(`   ${app}`);
  server = spawn(join(app, WINDOWS ? 'start.bat' : 'start.sh'), [], {
    cwd: app,
    stdio: 'inherit',
    shell: WINDOWS,
    env: { ...process.env, MS_PORT: String(port), MS_OPEN: '1' },
  });
  server.on('exit', (code) => stop(code ?? 0));
  server.on('error', (error) => {
    console.error(`smoke: ${error.message}`);
    void stop(1);
  });
  for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => stop(0));

  await waitForHealth(url);

  console.log(`\n   ${url}`);
  if (pinned) {
    console.log('   ! you pinned the port, so this origin may still hold documents from an');
    console.log('     earlier run — the app will upload them into the empty install. Clear');
    console.log('     site data for it first, or drop --port and let the script pick one.');
  } else {
    console.log('   empty data folder, an origin no MagicStories has ever run on, no key.');
  }
  // The one thing worth checking by eye, because nothing here can check it for
  // you: a fresh install has no story in it.
  console.log('\n   It should open on the connection sheet, and the story behind it should be');
  console.log('   "Untitled story". Anything else means the browser brought a story with it.');
  console.log('\n   the script to follow is PLAN.md §4.5. Ctrl+C stops it.\n');
}

// -- the pieces --------------------------------------------------------------

/**
 * A free port this machine has not already served a smoke run on. Browser
 * storage lives under the origin, so reusing one would hand the new install the
 * old install's stories.
 */
async function unusedPort() {
  const spent = new Set(await readSpent());
  for (let attempt = 0; attempt < 200; attempt++) {
    const port = PORT_RANGE[0] + Math.floor(Math.random() * (PORT_RANGE[1] - PORT_RANGE[0] + 1));
    if (spent.has(port) || !(await isFree(port))) continue;
    spent.add(port);
    await mkdir(BUILD, { recursive: true });
    await writeFile(SPENT_PORTS, `${JSON.stringify([...spent].sort((a, b) => a - b))}\n`);
    return port;
  }
  throw new Error(
    `no unused port left in ${PORT_RANGE.join('–')}. Delete ${SPENT_PORTS} and clear the ` +
      'browser storage for those origins.',
  );
}

async function readSpent() {
  try {
    const parsed = JSON.parse(await readFile(SPENT_PORTS, 'utf8'));
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function isFree(port) {
  return new Promise((fulfil) => {
    const probe = createServer();
    probe.once('error', () => fulfil(false));
    probe.listen(port, '127.0.0.1', () => probe.close(() => fulfil(true)));
  });
}

async function waitForHealth(url, timeout = 30_000) {
  const deadline = Date.now() + timeout;
  for (;;) {
    if (stopping) process.exit(0);
    const up = await fetch(`${url}api/health`).then(
      (response) => response.ok,
      () => false,
    );
    if (up) return;
    if (Date.now() > deadline) throw new Error(`the server never came up on ${url}`);
    await new Promise((fulfil) => setTimeout(fulfil, 200));
  }
}

async function stop(code) {
  if (stopping) return;
  stopping = true;
  server?.kill();
  process.exit(code);
}

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
  if (result.error) throw new Error(`could not unzip: ${result.error.message}`);
  if (result.status !== 0) throw new Error('unzip failed');
}

function run(command, args) {
  const result = spawnSync(command, args, { cwd: ROOT, stdio: 'inherit' });
  if (result.error) throw new Error(`${command}: ${result.error.message}`);
  if (result.status !== 0) throw new Error(`${command} ${args.join(' ')} failed`);
}

function step(message) {
  console.log(`\n• ${message}`);
}
