import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createApp } from './app.js';
import { backupOnStartup } from './backup.js';
import { readBuildInfo, recordRun } from './version.js';

/**
 * The one process a packaged Lamplit runs: documents on disk, the built
 * app in front of them, one URL to open. `start.bat` and `start.sh` do nothing
 * but call this file.
 */

/** `server/src/index.js` → the folder the app was unzipped (or cloned) into. */
const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const DEFAULT_PORT = 4177;
/** A busy port should not turn a double-click into a stack trace. */
const PORT_ATTEMPTS = 10;

const options = parseArguments(process.argv.slice(2));
const dataDir = resolve(options.data ?? process.env['LAMPLIT_DATA_DIR'] ?? join(ROOT, 'data'));
const backupsDir = resolve(process.env['LAMPLIT_BACKUP_DIR'] ?? join(ROOT, 'backups'));
const publicDir = resolve(options.public ?? process.env['LAMPLIT_PUBLIC_DIR'] ?? findBuiltApp());
const host = process.env['LAMPLIT_HOST'] ?? '127.0.0.1';
const wanted = Number(
  options.port ?? process.env['LAMPLIT_PORT'] ?? process.env['PORT'] ?? DEFAULT_PORT,
);
// The start scripts pass --open, so LAMPLIT_OPEN=0 has to be able to override it.
const shouldOpen =
  process.env['LAMPLIT_OPEN'] === '0' ? false : options.open || process.env['LAMPLIT_OPEN'] === '1';

// Which build this is: the stamp next to the built app in a packaged copy,
// package.json and git when running from the repository.
const build = readBuildInfo({ root: ROOT, publicDir });

// What ran here last. A data folder written by an older version is the only
// signal that an upgrade happened, and the app shows one notice for it.
const { previousVersion, upgraded } = await recordRun(dataDir, build.version);

const app = createApp({ dataDir, publicDir, build, previousVersion });
const store = app.locals['store'];

await store.init();

const server = await listen(app, host, wanted);
const url = `http://${host === '0.0.0.0' ? 'localhost' : host}:${server.address().port}/`;

console.log(`Lamplit ${versionLine(build)} — ${url}`);
console.log(`  documents  ${dataDir}`);
if (upgraded) console.log(`  upgraded   ${previousVersion} → ${build.version}`);
console.log(
  `  app        ${existsSync(join(publicDir, 'index.html')) ? publicDir : '(not built; API only)'}`,
);

if (process.env['LAMPLIT_BACKUP'] !== '0') {
  backupOnStartup(dataDir, backupsDir).then(
    (made) => made && console.log(`  backup     ${made}`),
    // A backup that cannot be written is worth saying out loud and no more.
    (error) => console.warn(`  backup failed: ${error.message}`),
  );
}

if (shouldOpen) openBrowser(url);

for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => server.close(() => process.exit(0)));
}

/** Takes the next free port when the wanted one is in use. */
function listen(application, hostname, from) {
  return new Promise((fulfil, reject) => {
    let port = from;
    const attempt = () => {
      const instance = application.listen(port, hostname);
      instance.once('listening', () => fulfil(instance));
      instance.once('error', (error) => {
        if (error.code !== 'EADDRINUSE' || port >= from + PORT_ATTEMPTS) return reject(error);
        console.warn(`port ${port} is busy, trying ${port + 1}`);
        port += 1;
        attempt();
      });
    };
    attempt();
  });
}

/** Packaged layout first, then the repository's Angular output. */
function findBuiltApp() {
  const packaged = join(ROOT, 'public');
  if (existsSync(join(packaged, 'index.html'))) return packaged;
  return join(ROOT, 'app', 'dist', 'app', 'browser');
}

/** `0.1.0 (build 42 · a1b2c3d)`, or just the version when nothing stamped it. */
function versionLine({ version, build: number, commit }) {
  const detail = [number === 'local' ? '' : `build ${number}`, commit].filter(Boolean).join(' · ');
  return detail ? `${version} (${detail})` : version;
}

function parseArguments(argv) {
  const options = {};
  for (let i = 0; i < argv.length; i++) {
    const argument = argv[i];
    if (argument === '--open') options.open = true;
    else if (argument.startsWith('--')) options[argument.slice(2)] = argv[++i];
  }
  return options;
}

function openBrowser(target) {
  const [command, args] =
    process.platform === 'win32'
      ? ['cmd', ['/c', 'start', '', target]]
      : process.platform === 'darwin'
        ? ['open', [target]]
        : ['xdg-open', [target]];
  // Best effort: a headless machine simply has nothing to open it with.
  spawn(command, args, { detached: true, stdio: 'ignore' })
    .on('error', () => {})
    .unref();
}
