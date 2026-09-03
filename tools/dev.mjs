import { spawn } from 'node:child_process';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * `npm start`: the persistence server and the Angular dev server, together.
 *
 * The dev server is started with app/proxy.conf.json, which sends `/api` to the
 * persistence server, so the app on 4200 saves to `data/` exactly as a packaged
 * one does. The proxy lives here rather than in angular.json on purpose: a bare
 * `ng serve` should stay what it has always been, an app with no backend.
 *
 * Either process going down takes the other with it — two half-running halves
 * is the one state that would be confusing.
 */

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const APP_PORT = process.env['MS_APP_PORT'] ?? '4200';
const WINDOWS = process.platform === 'win32';

const children = [];
let stopping = false;

start('server', process.execPath, [join(ROOT, 'server', 'src', 'index.js')]);
// npm is a .cmd on Windows, which Node will not spawn without a shell — and a
// shell would split the path to node.exe on its space, so only npm gets one.
start(
  'app',
  WINDOWS ? 'npm.cmd' : 'npm',
  ['run', 'start', '-w', 'app', '--', '--port', APP_PORT, '--proxy-config', 'proxy.conf.json'],
  { shell: WINDOWS },
);

for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => stop(0));

function start(name, command, args, options = {}) {
  const child = spawn(command, args, { cwd: ROOT, stdio: 'inherit', ...options });
  child.on('exit', (code) => {
    if (stopping) return;
    console.error(`\n[${name}] exited (${code ?? 'signal'}); stopping the rest.`);
    stop(code ?? 1);
  });
  child.on('error', (error) => {
    console.error(`[${name}] ${error.message}`);
    stop(1);
  });
  children.push(child);
}

function stop(code) {
  if (stopping) return;
  stopping = true;
  for (const child of children) child.kill();
  process.exit(code);
}
