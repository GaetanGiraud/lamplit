import { ChildProcess, spawn } from 'node:child_process';
import { createServer } from 'node:net';
import { existsSync } from 'node:fs';
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * The real persistence server, started per test on its own port with its own
 * empty data folder, serving the real production build.
 *
 * Every spec runs against this, because it is the only arrangement the app has:
 * the browser holds no documents of its own, so a test seeds by writing JSON
 * into the data folder — which is exactly what a person does when they copy a
 * story onto a new machine.
 */

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, '..', '..');
const ENTRY = join(ROOT, 'server', 'src', 'index.js');
export const BUILT_APP = join(ROOT, 'app', 'dist', 'app', 'browser');

/** The specs skip rather than fail when the app has not been built. */
export const IS_BUILT = existsSync(join(BUILT_APP, 'index.html'));

export class PersistenceServer {
  readonly dataDir: string;
  readonly port: number;
  readonly url: string;
  private child: ChildProcess | null = null;

  private constructor(dataDir: string, port: number) {
    this.dataDir = dataDir;
    this.port = port;
    this.url = `http://127.0.0.1:${port}`;
  }

  /** A fresh folder and a free port, so nothing carries over between tests. */
  static async create(): Promise<PersistenceServer> {
    const dataDir = await mkdtemp(join(tmpdir(), 'lamplit-e2e-'));
    return new PersistenceServer(dataDir, await freePort());
  }

  async start(): Promise<void> {
    if (this.child) return;
    this.child = spawn(process.execPath, [ENTRY], {
      env: {
        ...process.env,
        LAMPLIT_DATA_DIR: this.dataDir,
        LAMPLIT_PUBLIC_DIR: BUILT_APP,
        LAMPLIT_PORT: String(this.port),
        LAMPLIT_BACKUP: '0',
      },
      stdio: 'ignore',
    });
    await this.waitFor(true);
  }

  async stop(): Promise<void> {
    const child = this.child;
    if (!child) return;
    this.child = null;
    const exited = new Promise<void>((fulfil) => child.once('exit', () => fulfil()));
    child.kill();
    await exited;
    await this.waitFor(false);
  }

  async dispose(): Promise<void> {
    await this.stop();
    await rm(this.dataDir, { recursive: true, force: true });
  }

  /**
   * Puts documents on disk before the app is opened, keyed the way the client
   * keys them: `settings`, `story:<id>`, `chapter:<id>`. This is the only way
   * to seed anything now — there is nowhere else for a document to be.
   */
  async seed(documents: Record<string, unknown>): Promise<void> {
    for (const [key, document] of Object.entries(documents)) {
      const path = this.pathOf(key);
      await mkdir(dirname(path), { recursive: true });
      await writeFile(
        path,
        `${JSON.stringify(document, null, 2)}
`,
        'utf8',
      );
    }
  }

  private pathOf(key: string): string {
    if (key === 'settings') return join(this.dataDir, 'settings.json');
    if (key.startsWith('story:')) {
      return join(this.dataDir, 'stories', `${key.slice('story:'.length)}.json`);
    }
    if (key.startsWith('chapter:')) {
      return join(this.dataDir, 'chapters', `${key.slice('chapter:'.length)}.json`);
    }
    throw new Error(`not a document key: ${key}`);
  }

  /** Takes a document off disk behind the app's back. */
  async remove(collection: 'stories' | 'chapters', id: string): Promise<void> {
    await rm(join(this.dataDir, collection, `${id}.json`), { force: true });
  }

  /** What is actually on disk, which is the whole point of these specs. */
  async document<T = Record<string, unknown>>(
    collection: 'settings' | 'stories' | 'chapters',
    id?: string,
  ): Promise<T | null> {
    const path =
      collection === 'settings'
        ? join(this.dataDir, 'settings.json')
        : join(this.dataDir, collection, `${id}.json`);
    try {
      return JSON.parse(await readFile(path, 'utf8')) as T;
    } catch {
      return null;
    }
  }

  async ids(collection: 'stories' | 'chapters'): Promise<string[]> {
    const files = await readdir(join(this.dataDir, collection)).catch(() => []);
    return files
      .filter((file) => file.endsWith('.json'))
      .map((file) => file.slice(0, -5))
      .sort();
  }

  private async waitFor(up: boolean, timeout = 20_000): Promise<void> {
    const deadline = Date.now() + timeout;
    for (;;) {
      const alive = await fetch(`${this.url}/api/health`)
        .then((response) => response.ok)
        .catch(() => false);
      if (alive === up) return;
      if (Date.now() > deadline) {
        throw new Error(`persistence server never came ${up ? 'up' : 'down'} on ${this.url}`);
      }
      await new Promise((fulfil) => setTimeout(fulfil, 100));
    }
  }
}

/** Ask the OS for a port, then give it straight back. */
function freePort(): Promise<number> {
  return new Promise((fulfil, reject) => {
    const probe = createServer();
    probe.on('error', reject);
    probe.listen(0, '127.0.0.1', () => {
      const { port } = probe.address() as { port: number };
      probe.close(() => fulfil(port));
    });
  });
}
