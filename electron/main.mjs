import { BrowserWindow, Menu, app, dialog, ipcMain, session, shell } from 'electron';
import { existsSync } from 'node:fs';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { shouldCheck } from './updates.mjs';

/**
 * The desktop shell, and nothing else.
 *
 * It starts the same Express server the zip starts, on a free port on the
 * loopback, and opens one window at it. Everything the person sees is the same
 * web app, talking to the same API, saving the same JSON files — the only
 * difference is where those files live (the user's profile rather than a folder
 * beside a script) and the fact that Node came in the box.
 *
 * That is the whole design rule: nothing below is allowed to know anything
 * about stories, chapters or models. If something here starts needing to, the
 * shell is doing too much and the change belongs in `server/` or `app/`.
 */

const HERE = dirname(fileURLToPath(import.meta.url));

/**
 * Packaged, the staged folder from `tools/package.mjs` sits unpacked beside the
 * asar; in development it is the repository itself. Either way it holds
 * `server/` and the built app, which is all this file needs to find.
 */
const BUNDLE = app.isPackaged ? join(process.resourcesPath, 'app') : resolve(HERE, '..');
const SERVER = join(BUNDLE, 'server', 'src');
const PUBLIC_DIR = app.isPackaged
  ? join(BUNDLE, 'public')
  : join(BUNDLE, 'app', 'dist', 'app', 'browser');

/**
 * Where everything this person has written lives. The installer's answer is the
 * profile, which is the only user-visible difference from the zip and is what
 * *docs/desktop.md* documents. Two things move it:
 *
 * - `PORTABLE_EXECUTABLE_DIR`, set by electron-builder's portable build, which
 *   puts `data/` beside the .exe exactly as the zip does — the point of a
 *   portable build being that the stick holds the stories too.
 * - `LAMPLIT_USER_DATA`, which is how the desktop spec gets a first run every time,
 *   and how anyone else can keep a profile somewhere of their choosing.
 */
const PROFILE =
  process.env['LAMPLIT_USER_DATA'] ??
  process.env['PORTABLE_EXECUTABLE_DIR'] ??
  app.getPath('userData');
if (PROFILE !== app.getPath('userData')) app.setPath('userData', resolve(PROFILE));
// Moving `userData` moves Chromium's own caches with it — fifteen folders of
// them, next to the two that hold the writing. On a stick that is churn on the
// stick; anywhere it is a profile nobody can read at a glance. They go into a
// folder of their own, still inside the profile, so a portable copy is still
// self-contained.
app.setPath('sessionData', join(app.getPath('userData'), 'browser'));

const DATA_DIR = join(app.getPath('userData'), 'data');
const BACKUPS_DIR = join(app.getPath('userData'), 'backups');
const WINDOW_STATE = join(app.getPath('userData'), 'window.json');

const DEFAULT_WINDOW = { width: 1180, height: 820 };
/** Small enough for a laptop, wide enough that the reading column is not squeezed. */
const MINIMUM_WINDOW = { width: 720, height: 520 };

/** A second launch over the same files would be two writers, so there is one. */
if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', focusWindow);
  // `.catch` rather than a second argument: that one only answers for
  // `whenReady` itself, and everything that can actually go wrong — a profile
  // that cannot be written, a port that will not open, an app that will not
  // load — happens inside `start`. Unanswered, it left a process with no
  // window holding the single-instance lock, so relaunching did nothing
  // either, and said nothing at all.
  app.whenReady().then(start).catch(fatal);
}

/** @type {import('node:http').Server | null} */
let server = null;
let finished = false;
/** @type {BrowserWindow | null} */
let window = null;
/** @type {{version: string, commit: string, builtAt: string, build: string, channel: string} | null} */
let build = null;

async function start() {
  if (!existsSync(join(PUBLIC_DIR, 'index.html'))) {
    return fatal(new Error(`no built app at ${PUBLIC_DIR} — run \`npm run build\` first.`));
  }

  const { createApp } = await import(pathToFileURL(join(SERVER, 'app.js')).href);
  // The same stamp the zip reads, from the same file, so the window and the
  // browser tab cannot disagree about which build this is. `app.getVersion()`
  // knows the version and nothing else — no commit, no build number.
  const { readBuildInfo, recordRun } = await import(pathToFileURL(join(SERVER, 'version.js')).href);
  build = readBuildInfo({ root: BUNDLE, publicDir: PUBLIC_DIR, channel: 'desktop' });
  const { previousVersion, upgraded } = await recordRun(DATA_DIR, build.version);
  if (upgraded) console.log(`upgraded ${previousVersion} → ${build.version}`);

  // The same endpoint the zip serves, so the What's new sheet reads the same
  // answer here as it does there. What the shell *does* with an update is its
  // own business and unchanged: electron-updater downloads it and installs it
  // on quit, which is why the sheet says so rather than offering a download.
  const { createUpdateChecker } = await import(pathToFileURL(join(SERVER, 'updates.js')).href);
  const updates = createUpdateChecker({
    version: build.version,
    enabled: process.env['LAMPLIT_UPDATE_CHECK'] !== '0',
  });

  const expressApp = createApp({
    dataDir: DATA_DIR,
    publicDir: PUBLIC_DIR,
    build,
    previousVersion,
    updates,
  });
  await expressApp.locals['store'].init();

  server = await listen(expressApp);
  const url = `http://127.0.0.1:${server.address().port}/`;

  // The same daily backup the zip takes, into the profile beside the data.
  const { backupOnStartup } = await import(pathToFileURL(join(SERVER, 'backup.js')).href);
  backupOnStartup(DATA_DIR, BACKUPS_DIR).catch((error) =>
    console.warn(`backup failed: ${error.message}`),
  );

  denyPermissions();
  ipcMain.handle('lamplit:open-data-folder', openDataFolder);
  // The page asks for the update check rather than the shell taking it: the
  // switch that governs it is in the app's settings.json, which the shell
  // deliberately cannot read. It does not wait for an answer, and there is
  // none — the check takes as long as GitHub takes, and downloads after that.
  ipcMain.handle('lamplit:check-for-updates', (_event, setting) => {
    void checkForUpdates(setting);
  });
  Menu.setApplicationMenu(buildMenu());
  await openWindow(url);
}

/**
 * The one thing the app asks the browser for, and it asks for it on a click:
 * Copy, on a message and on the prompt preview. Everything else on Chromium's
 * list — the camera, the microphone, the location, notifications, reading the
 * clipboard rather than writing it — this app has never used and has no reason
 * to, and Electron grants all of them by default. A page that got in here
 * could ask; now it is told no before anyone is.
 *
 * Both handlers, because they answer different questions: `request` is a page
 * asking for something, `check` is `navigator.permissions.query` and the
 * silent grant behind `navigator.clipboard.writeText`.
 */
const ALLOWED_PERMISSIONS = new Set(['clipboard-sanitized-write']);

function denyPermissions() {
  const { defaultSession } = session;
  defaultSession.setPermissionRequestHandler((_contents, permission, callback) =>
    callback(ALLOWED_PERMISSIONS.has(permission)),
  );
  defaultSession.setPermissionCheckHandler((_contents, permission) =>
    ALLOWED_PERMISSIONS.has(permission),
  );
}

/** Port 0: the operating system hands back one that is free. */
function listen(expressApp) {
  return new Promise((fulfil, reject) => {
    const instance = expressApp.listen(0, '127.0.0.1');
    instance.once('listening', () => fulfil(instance));
    instance.once('error', reject);
  });
}

async function openWindow(url) {
  const state = await readWindowState();
  window = new BrowserWindow({
    ...state,
    minWidth: MINIMUM_WINDOW.width,
    minHeight: MINIMUM_WINDOW.height,
    show: false,
    backgroundColor: '#14151a',
    title: 'Lamplit',
    webPreferences: {
      preload: join(HERE, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });

  // A "get a key" link is somewhere to go, not somewhere to navigate the app.
  window.webContents.setWindowOpenHandler(({ url: target }) => {
    openExternal(target);
    return { action: 'deny' };
  });
  window.webContents.on('will-navigate', (event, target) => {
    if (!target.startsWith(url)) {
      event.preventDefault();
      openExternal(target);
    }
  });

  // The page stops the window closing when its queue is failing — the one case
  // where leaving loses what was written. A browser would ask; Electron does
  // not, it asks *us*, and a shell that says nothing here is a window whose
  // close button does nothing at all, with no reason given.
  window.webContents.on('will-prevent-unload', (event) => {
    const answer = dialog.showMessageBoxSync(window ?? undefined, {
      type: 'warning',
      buttons: ['Keep Lamplit open', 'Close anyway'],
      defaultId: 0,
      cancelId: 0,
      title: 'Lamplit',
      message: 'Some of what you have written has not been saved yet.',
      detail:
        'Lamplit cannot reach its own server, so the last few changes are still ' +
        'only in this window. Keep it open and they will be saved as soon as the ' +
        'server answers again.',
    });
    // preventDefault here means "overrule the page": close in spite of it.
    if (answer === 1) event.preventDefault();
  });

  window.once('ready-to-show', () => window?.show());
  window.on('close', rememberWindow);
  window.on('closed', () => (window = null));

  await window.loadURL(url);
}

/** The one thing the shell does that the web app cannot do for itself. */
async function openDataFolder() {
  await mkdir(DATA_DIR, { recursive: true }).catch(() => {});
  await shell.openPath(DATA_DIR);
}

function focusWindow() {
  if (!window) return;
  if (window.isMinimized()) window.restore();
  window.focus();
}

/** http(s) only: nothing else is a link the app could have produced. */
function openExternal(target) {
  if (/^https?:\/\//i.test(target)) shell.openExternal(target);
}

// -- the window's size and place ---------------------------------------------

async function readWindowState() {
  try {
    const saved = JSON.parse(await readFile(WINDOW_STATE, 'utf8'));
    const width = Math.max(MINIMUM_WINDOW.width, Number(saved.width) || DEFAULT_WINDOW.width);
    const height = Math.max(MINIMUM_WINDOW.height, Number(saved.height) || DEFAULT_WINDOW.height);
    const place =
      Number.isInteger(saved.x) && Number.isInteger(saved.y) ? { x: saved.x, y: saved.y } : {};
    return { width, height, ...place };
  } catch {
    return { ...DEFAULT_WINDOW };
  }
}

/**
 * Written on close rather than on every move: the app's own documents are
 * debounced through the server, and this is not one of them.
 */
function rememberWindow() {
  if (!window || window.isMinimized()) return;
  const [width, height] = window.getSize();
  const [x, y] = window.getPosition();
  const state = window.isMaximized() ? { width, height } : { width, height, x, y };
  writeFile(WINDOW_STATE, `${JSON.stringify(state, null, 2)}\n`, 'utf8').catch(() => {});
}

// -- the menu ----------------------------------------------------------------

function buildMenu() {
  return Menu.buildFromTemplate([
    {
      label: 'File',
      submenu: [
        { label: 'Open data folder', click: openDataFolder },
        { type: 'separator' },
        { role: 'quit' },
      ],
    },
    // Without these six, copy and paste do not work on macOS at all.
    {
      label: 'Edit',
      submenu: [
        { role: 'undo' },
        { role: 'redo' },
        { type: 'separator' },
        { role: 'cut' },
        { role: 'copy' },
        { role: 'paste' },
        { role: 'selectAll' },
      ],
    },
    {
      label: 'View',
      submenu: [
        { role: 'reload' },
        { role: 'toggleDevTools' },
        { type: 'separator' },
        { role: 'resetZoom' },
        { role: 'zoomIn' },
        { role: 'zoomOut' },
        { type: 'separator' },
        { role: 'togglefullscreen' },
      ],
    },
    {
      label: 'Help',
      submenu: [
        { label: 'Lamplit on the web', click: () => openExternal(WEBSITE) },
        { label: 'Report a problem', click: () => openExternal(`${REPOSITORY}/issues`) },
        { type: 'separator' },
        // The same line the About sheet shows, from the same stamp.
        { label: `Version ${versionLine()}`, enabled: false },
      ],
    },
  ]);
}

/** `0.1.0 (build 42 · a1b2c3d)`, or just the version when nothing stamped it. */
function versionLine() {
  const version = build?.version ?? app.getVersion();
  const detail = [
    build && build.build !== 'local' ? `build ${build.build}` : '',
    build?.commit ?? '',
  ]
    .filter(Boolean)
    .join(' · ');
  return detail ? `${version} (${detail})` : version;
}

const WEBSITE = 'https://gaetangiraud.github.io/lamplit/';
const REPOSITORY = 'https://github.com/GaetanGiraud/lamplit';

// -- updates -----------------------------------------------------------------

/**
 * Checked once, when the page says it may, against the same GitHub release the
 * installer came from. Best effort by design: a machine that is offline, or a
 * build that was never published, must not produce a dialog about it.
 *
 * Whether it may at all is `shouldCheck`, next door, where a test can ask it.
 *
 * @param {boolean} [setting] Preferences → Advanced, as the page reports it.
 */
async function checkForUpdates(setting) {
  const allowed = shouldCheck({
    isPackaged: app.isPackaged,
    portable: Boolean(process.env['PORTABLE_EXECUTABLE_DIR']),
    env: process.env,
    setting,
  });
  if (!allowed) return;
  try {
    const { autoUpdater } = await import('electron-updater');
    autoUpdater.autoDownload = true;
    autoUpdater.on('error', (error) => console.warn(`update check failed: ${error.message}`));
    await autoUpdater.checkForUpdatesAndNotify();
  } catch (error) {
    console.warn(`update check failed: ${error.message}`);
  }
}

// -- shutting down -----------------------------------------------------------

/**
 * The last debounced write leaves the page on `beforeunload`, which closing the
 * window fires; the server is closed after it so that write has somewhere to
 * land.
 */
app.on('window-all-closed', () => app.quit());

app.on('will-quit', (event) => {
  if (finished) return;
  event.preventDefault();
  const closing = server;
  server = null;

  const finish = () => {
    if (finished) return;
    finished = true;
    // Not app.quit(): once a quit has been prevented, Electron ignores the
    // next one, and by here the windows are gone and the server is shut. There
    // is nothing left to be graceful about.
    app.exit(0);
  };

  if (!closing) return finish();
  closing.close(finish);
  // The window's keep-alive sockets outlive the window they belonged to, and a
  // server holding one never finishes closing. Idle ones go at once; anything
  // still in flight — the last beacon — gets its moment and then goes too.
  closing.closeIdleConnections();
  setTimeout(() => {
    closing.closeAllConnections();
    finish();
  }, SHUTDOWN_GRACE);
});

/** Long enough for a beacon to land, short enough that Quit means quit. */
const SHUTDOWN_GRACE = 1500;

function fatal(error) {
  console.error(`Lamplit could not start: ${error.stack ?? error.message}`);
  // A packaged app has no console anyone is watching, and a launcher that
  // appears to do nothing is the worst way to say something went wrong.
  if (app.isPackaged) {
    dialog.showErrorBox('Lamplit could not start', String(error.message ?? error));
  }
  app.exit(1);
}
