import { mkdir, readdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';

/**
 * The three document kinds the app persists, and where each one lives.
 * `settings` is one file rather than a folder because there is exactly one.
 */
export const COLLECTIONS = {
  settings: { single: 'settings', file: 'settings.json' },
  stories: { dir: 'stories' },
  chapters: { dir: 'chapters' },
};

/** Ids come from `crypto.randomUUID()`; this also keeps `..` out of paths. */
const ID = /^[A-Za-z0-9_-]{1,128}$/;

export function isCollection(name) {
  return Object.hasOwn(COLLECTIONS, name);
}

export function isId(collection, id) {
  if (!ID.test(id)) return false;
  const config = COLLECTIONS[collection];
  return config.single ? id === config.single : true;
}

/**
 * JSON documents on disk, one file each.
 *
 * Two rules make concurrent writes safe. Whoever comes first gets written
 * first: every path has its own FIFO promise chain, so two writes to the same
 * document never interleave and never land out of order. And every write goes
 * to a temporary file that is then renamed over the target, which is atomic on
 * both Windows and POSIX — a reader sees the old document or the new one, and
 * a crash mid-write leaves the old one intact.
 *
 * A client-supplied `seq` (monotonic per document) guards against the wire
 * reordering two requests: a write older than the last one applied is dropped.
 */
export class DocumentStore {
  #dataDir;
  #chains = new Map();
  #seqs = new Map();

  constructor(dataDir) {
    this.#dataDir = dataDir;
  }

  get dataDir() {
    return this.#dataDir;
  }

  async init() {
    await mkdir(this.#dataDir, { recursive: true });
    for (const config of Object.values(COLLECTIONS)) {
      if (config.dir) await mkdir(join(this.#dataDir, config.dir), { recursive: true });
    }
  }

  pathOf(collection, id) {
    const config = COLLECTIONS[collection];
    return config.single
      ? join(this.#dataDir, config.file)
      : join(this.#dataDir, config.dir, `${id}.json`);
  }

  /** Every document in the collection, unparseable files skipped. */
  async list(collection) {
    const config = COLLECTIONS[collection];
    if (config.single) {
      const document = await this.read(collection, config.single);
      return document === null ? [] : [document];
    }
    const files = await readdir(join(this.#dataDir, config.dir)).catch(() => []);
    const documents = [];
    for (const file of files) {
      if (!file.endsWith('.json')) continue;
      const id = file.slice(0, -'.json'.length);
      // One entry that cannot be read — a folder wearing the name, a file held
      // open, a permission — costs that entry, not the collection. The listing
      // is what the app starts from; a 500 here is a no-server screen.
      const document = await this.read(collection, id).catch((error) => {
        console.warn(`[lamplit] skipping ${collection}/${file}: ${error.message}`);
        return null;
      });
      if (document !== null) documents.push(document);
    }
    return documents;
  }

  /** The light listing: enough to know what is there and how fresh it is. */
  async index(collection) {
    const documents = await this.list(collection);
    return documents.map((document, position) => ({
      id: document?.id ?? COLLECTIONS[collection].single ?? String(position),
      updatedAt: document?.updatedAt ?? null,
    }));
  }

  async read(collection, id) {
    try {
      return JSON.parse(await readFile(this.pathOf(collection, id), 'utf8'));
    } catch (error) {
      if (error.code === 'ENOENT') return null;
      // A truncated or hand-edited file reads as missing rather than as a 500:
      // the client still has its own copy and will write over it.
      if (error instanceof SyntaxError) return null;
      throw error;
    }
  }

  /**
   * Overwrites the document. Returns the sequence number now in force, and
   * whether this write was dropped for being older than one already applied.
   */
  async write(collection, id, document, seq) {
    return this.#enqueue(collection, id, seq, async (path) => {
      const temporary = `${path}.${randomUUID().slice(0, 8)}.tmp`;
      await writeFile(temporary, `${JSON.stringify(document, null, 2)}\n`, 'utf8');
      try {
        await rename(temporary, path);
      } catch (error) {
        // Windows refuses the rename while something holds the target open;
        // the write has failed either way, and the failure should not also
        // leave a stray file for the backup to pick up.
        await rm(temporary, { force: true }).catch(() => {});
        throw error;
      }
    });
  }

  async remove(collection, id, seq) {
    return this.#enqueue(collection, id, seq, async (path) => {
      await rm(path, { force: true });
    });
  }

  /** Serialises work on one document and applies the sequence guard. */
  #enqueue(collection, id, seq, work) {
    const key = `${collection}/${id}`;
    const path = this.pathOf(collection, id);
    const previous = this.#chains.get(key) ?? Promise.resolve();
    const run = previous.then(async () => {
      const applied = this.#seqs.get(key);
      if (seq !== undefined && applied !== undefined && seq <= applied) {
        return { ok: true, seq: applied, skipped: true };
      }
      await work(path);
      if (seq !== undefined) this.#seqs.set(key, seq);
      return { ok: true, seq: seq ?? applied ?? 0, skipped: false };
    });
    // The chain must survive a failed write, or the document jams for good.
    this.#chains.set(
      key,
      run.catch(() => {}),
    );
    return run;
  }
}
