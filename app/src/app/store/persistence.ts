import { Injectable, computed, inject, signal } from '@angular/core';
import { DocRef, DocumentApi, refOf } from './document-api';
import { StorageBackend } from './storage';

/**
 * saving   a write is on its way
 * saved    every document on disk matches what is on screen
 * offline  the server stopped answering; the session carries on and retries
 */
export type SaveStatus = 'saving' | 'saved' | 'offline';

/** Long enough to coalesce a burst of keystrokes, short enough to feel saved. */
const DEBOUNCE = 300;
const RETRY_FIRST = 1000;
const RETRY_MAX = 15_000;

/** The server is usually still finding its feet when the browser is opened. */
const LOAD_ATTEMPTS = 4;
const LOAD_RETRY = 400;

interface Queued {
  ref: DocRef;
  kind: 'write' | 'delete';
}

/**
 * The documents, and the server they came from.
 *
 * There is exactly one copy of a document in the browser: this map, filled at
 * startup by a single read of the server and thrown away when the tab closes.
 * The server is the only place a document lives, a reload starts again from
 * what is on disk, and there is nothing to reconcile because there is nothing
 * to reconcile *with*.
 *
 * It did not start out this way. The app was built without a backend and kept
 * its documents in `localStorage`; when the server arrived, that cache stayed
 * on as a "write-through cache" and bought a merge on every startup, a
 * persisted write queue, a rule for which side wins, and a class of bug where
 * the browser quietly uploaded an old story into a new install. None of that
 * was worth the reload being fast, on a local app whose whole database is a few
 * JSON files on the same machine.
 *
 * Writes go into the map and onto a queue: debounced, coalesced per document,
 * one request in flight so the server sees them in the order they happened. If
 * the server stops answering the queue stops draining and retries with a
 * widening delay; the session keeps working, because everything it needs is
 * already in memory.
 */
@Injectable({ providedIn: 'root' })
export class Persistence implements StorageBackend {
  private readonly api = inject(DocumentApi);

  private readonly documents = new Map<string, unknown>();
  private readonly statusState = signal<SaveStatus>('saved');
  private readonly errorState = signal('');
  private readonly readyState = signal(false);

  readonly status = this.statusState.asReadonly();
  readonly error = this.errorState.asReadonly();
  /** False until the server has handed over its documents. Nothing runs before. */
  readonly ready = this.readyState.asReadonly();
  readonly isOffline = computed(() => this.statusState() === 'offline');

  private readonly pending = new Map<string, Queued>();
  private listening = false;
  private draining = false;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private retryDelay = 0;
  /** Wall-clock based, so it keeps rising across reloads as the server needs. */
  private lastSeq = 0;

  // -- startup ---------------------------------------------------------------

  /**
   * Runs before the app is created. Everything the session will read is fetched
   * here, once; if it cannot be, the app does not start and says so, because
   * without the server there is nothing to show and nowhere to put what you
   * write.
   */
  async load(): Promise<void> {
    for (let attempt = 1; ; attempt++) {
      try {
        const { documents } = await this.api.snapshot();
        this.documents.clear();
        for (const [key, document] of documents) this.documents.set(key, document);
        this.readyState.set(true);
        this.errorState.set('');
        return;
      } catch (error) {
        if (attempt >= LOAD_ATTEMPTS) {
          this.errorState.set(message(error));
          this.readyState.set(false);
          return;
        }
        await delay(LOAD_RETRY * attempt);
      }
    }
  }

  /** The "try again" on the no-server screen. */
  async retryLoad(): Promise<boolean> {
    await this.load();
    if (this.readyState()) this.listen();
    return this.readyState();
  }

  /** Called once the app has actually started, to arm the unload handler. */
  listen(): void {
    if (this.listening) return;
    this.listening = true;
    window.addEventListener('beforeunload', (event) => {
      if (!this.pending.size) return;
      // One keepalive request per document is all the browser will still carry.
      for (const [key, queued] of this.pending) {
        if (queued.kind === 'write') {
          this.api.sendBeacon(queued.ref, this.documents.get(key), this.nextSeq());
        }
      }
      // Debounced writes almost always make it. A queue that is already failing
      // almost certainly will not, and that is worth stopping someone for.
      if (this.statusState() === 'offline') event.preventDefault();
    });
    window.addEventListener('online', () => this.retryNow());
  }

  // -- the documents ---------------------------------------------------------

  read<T>(key: string): T | null {
    return (this.documents.get(key) as T | undefined) ?? null;
  }

  write(key: string, value: unknown): void {
    this.documents.set(key, value);
    this.enqueue(key, 'write');
  }

  remove(key: string): void {
    this.documents.delete(key);
    this.enqueue(key, 'delete');
  }

  keys(prefix: string): string[] {
    return [...this.documents.keys()].filter((key) => key.startsWith(prefix));
  }

  // -- the queue -------------------------------------------------------------

  /** The offline indicator is a button; this is what it does. */
  retryNow(): void {
    this.retryDelay = 0;
    if (this.timer !== null) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    this.schedule(0);
  }

  private enqueue(key: string, kind: Queued['kind']): void {
    const ref = refOf(key);
    if (!ref) return;
    this.pending.set(key, { ref, kind });
    this.schedule(DEBOUNCE);
  }

  private schedule(delayMs: number): void {
    if (this.timer !== null || this.draining) return;
    this.timer = setTimeout(() => {
      this.timer = null;
      void this.drain();
    }, delayMs);
  }

  private async drain(): Promise<void> {
    if (this.draining || !this.pending.size) return;
    this.draining = true;
    this.statusState.set('saving');
    let failure: unknown = null;
    try {
      while (this.pending.size) {
        const [key, queued] = this.pending.entries().next().value!;
        this.pending.delete(key);
        try {
          await this.send(key, queued);
        } catch (error) {
          // Put it back, unless a store has already queued something newer.
          if (!this.pending.has(key)) this.pending.set(key, queued);
          throw error;
        }
      }
    } catch (error) {
      failure = error;
    } finally {
      this.draining = false;
    }

    if (failure) {
      this.errorState.set(message(failure));
      this.statusState.set('offline');
      this.retryDelay = Math.min(this.retryDelay ? this.retryDelay * 2 : RETRY_FIRST, RETRY_MAX);
      this.schedule(this.retryDelay);
      return;
    }
    this.retryDelay = 0;
    this.errorState.set('');
    this.statusState.set('saved');
    if (this.pending.size) this.schedule(DEBOUNCE);
  }

  private send(key: string, queued: Queued): Promise<void> {
    const seq = this.nextSeq();
    if (queued.kind === 'delete') return this.api.remove(queued.ref, seq);
    // Always what the document says now: a write that sat through a retry
    // should carry the latest version, not the one that was queued.
    return this.api.put(queued.ref, this.documents.get(key), seq);
  }

  private nextSeq(): number {
    this.lastSeq = Math.max(Date.now(), this.lastSeq + 1);
    return this.lastSeq;
  }
}

function message(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function delay(ms: number): Promise<void> {
  return new Promise((fulfil) => setTimeout(fulfil, ms));
}
