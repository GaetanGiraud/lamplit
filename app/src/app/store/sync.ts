import { Injectable, computed, inject, signal } from '@angular/core';
import { DocRef, DocumentApi, keyOf, refOf } from './document-api';
import { LocalStorageBackend, StorageBackend } from './storage';

/**
 * saved   every document on disk matches what is on screen
 * saving  a write is on its way
 * offline the server was there and stopped answering; work is kept and retried
 * local   nothing is listening on /api, so this browser is the disk
 */
export type SyncStatus = 'saved' | 'saving' | 'offline' | 'local';

/** Long enough to coalesce a burst of keystrokes, short enough to feel saved. */
const DEBOUNCE = 300;
const RETRY_FIRST = 1000;
const RETRY_MAX = 15_000;

/** What is queued but not yet acknowledged, kept across a reload. */
const PENDING_KEY = 'sync:pending';
type PendingKind = 'write' | 'delete';

interface Queued {
  ref: DocRef;
  kind: PendingKind;
  document: unknown;
}

/**
 * Mirrors the stores to the server, and decides at startup which side is right.
 *
 * The stores stay synchronous and keep writing to `localStorage`, which is what
 * makes the app paint instantly on reload; this service rides along behind
 * them. Writes are debounced and coalesced per document — a document with a
 * newer version waiting is never sent twice — and only one request is in flight
 * at a time, so the server sees them in the order they happened.
 *
 * When the server cannot be reached the queue simply stops draining and retries
 * with a widening delay. Nothing is dropped, and because the queue itself is
 * persisted, nothing is dropped by a reload either.
 */
@Injectable({ providedIn: 'root' })
export class SyncService {
  private readonly api = inject(DocumentApi);
  private readonly local = inject(LocalStorageBackend);

  private readonly statusState = signal<SyncStatus>('local');
  private readonly errorState = signal('');

  readonly status = this.statusState.asReadonly();
  readonly error = this.errorState.asReadonly();
  readonly isServed = computed(() => this.statusState() !== 'local');

  private enabled = false;
  private readonly pending = new Map<string, Queued>();
  private draining = false;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private retryDelay = 0;
  /** Wall-clock based, so it keeps rising across reloads as the server needs. */
  private lastSeq = 0;

  /**
   * Runs before the app is created, so the stores load whatever it settles on.
   * Never rejects: no server, or a server that stops answering, is a mode the
   * app runs in rather than a failure to start.
   */
  async bootstrap(): Promise<void> {
    if (!(await this.api.health())) {
      this.statusState.set('local');
      return;
    }
    this.enabled = true;
    this.restorePending();
    try {
      await this.reconcile();
      this.statusState.set(this.pending.size ? 'saving' : 'saved');
    } catch (error) {
      // It answered /health and then did not: keep the cached documents, keep
      // the queue, and let the retry loop sort it out.
      this.fail(error);
    }
    this.listen();
    if (this.pending.size) void this.drain();
  }

  queueWrite(key: string, document: unknown): void {
    this.enqueue(key, 'write', document);
  }

  queueRemove(key: string): void {
    this.enqueue(key, 'delete', null);
  }

  /**
   * The offline indicator is a button; this is what it does. The point of
   * asking is not to wait out the retry that is already pending, so that one
   * is cancelled rather than joined.
   */
  retryNow(): void {
    if (!this.enabled) return;
    this.retryDelay = 0;
    if (this.timer !== null) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    this.schedule(0);
  }

  // -- the queue -------------------------------------------------------------

  private enqueue(key: string, kind: PendingKind, document: unknown): void {
    if (!this.enabled) return;
    const ref = refOf(key);
    if (!ref) return;
    this.pending.set(key, { ref, kind, document });
    this.savePending();
    this.schedule(DEBOUNCE);
  }

  private schedule(delay: number): void {
    if (this.timer !== null || this.draining) return;
    this.timer = setTimeout(() => {
      this.timer = null;
      void this.drain();
    }, delay);
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
          await this.send(queued);
        } catch (error) {
          // Put it back, unless a store has already queued something newer.
          if (!this.pending.has(key)) this.pending.set(key, queued);
          throw error;
        }
        this.savePending();
      }
    } catch (error) {
      failure = error;
    } finally {
      this.draining = false;
    }

    if (failure) {
      this.fail(failure);
      this.retryDelay = Math.min(this.retryDelay ? this.retryDelay * 2 : RETRY_FIRST, RETRY_MAX);
      this.schedule(this.retryDelay);
      return;
    }
    this.retryDelay = 0;
    this.errorState.set('');
    this.statusState.set('saved');
    if (this.pending.size) this.schedule(DEBOUNCE);
  }

  private async send(queued: Queued): Promise<void> {
    const seq = this.nextSeq();
    if (queued.kind === 'delete') return this.api.remove(queued.ref, seq);
    // Always the version on record rather than the one queued: a write that sat
    // through a retry should carry what the document says now.
    const document = this.local.read(keyOf(queued.ref)) ?? queued.document;
    return this.api.put(queued.ref, document, seq);
  }

  private nextSeq(): number {
    this.lastSeq = Math.max(Date.now(), this.lastSeq + 1);
    return this.lastSeq;
  }

  private fail(error: unknown): void {
    this.errorState.set(error instanceof Error ? error.message : String(error));
    this.statusState.set('offline');
  }

  // -- startup ---------------------------------------------------------------

  /**
   * Reconciles the cache with the server, document by document.
   *
   * The server is the truth, with one exception: a document this browser wrote
   * and never managed to send. That is exactly what the persisted queue
   * records, so those win and are sent. Everything else is taken from the
   * server, and a cached document the server does not have is one that was
   * deleted elsewhere — the cache lets it go.
   */
  private async reconcile(): Promise<void> {
    const { documents } = await this.api.snapshot();
    const mine = new Set(this.pending.keys());

    if (!documents.size && !mine.size) {
      // A server with nothing in it, and a browser that may have a story
      // already in progress: the first run after this app grew a backend.
      for (const key of this.documentKeys()) this.enqueue(key, 'write', this.local.read(key));
      return;
    }

    for (const [key, document] of documents) {
      if (!mine.has(key)) this.local.write(key, document);
    }
    for (const key of this.documentKeys()) {
      if (documents.has(key) || mine.has(key)) continue;
      this.local.remove(key);
    }
  }

  /** Every cached document, whatever else this browser keeps under the name. */
  private documentKeys(): string[] {
    return this.local.keys('').filter((key) => refOf(key) !== null);
  }

  private restorePending(): void {
    const stored = this.local.read<Record<string, PendingKind>>(PENDING_KEY) ?? {};
    for (const [key, kind] of Object.entries(stored)) {
      const ref = refOf(key);
      if (!ref) continue;
      const document = this.local.read(key);
      // A queued write whose document is gone from the cache has nothing left
      // to say; a queued delete is about a document that is meant to be gone.
      if (kind === 'write' && document === null) continue;
      this.pending.set(key, { ref, kind, document });
    }
  }

  private savePending(): void {
    if (!this.pending.size) {
      this.local.remove(PENDING_KEY);
      return;
    }
    const stored: Record<string, PendingKind> = {};
    for (const [key, queued] of this.pending) stored[key] = queued.kind;
    this.local.write(PENDING_KEY, stored);
  }

  private listen(): void {
    // The tab is closing with work in hand: one keepalive request per document
    // is all the browser will still carry out.
    window.addEventListener('beforeunload', () => {
      for (const queued of this.pending.values()) {
        if (queued.kind === 'write') {
          this.api.sendBeacon(queued.ref, this.local.read(keyOf(queued.ref)), this.nextSeq());
        }
      }
    });
    // Back on the network after the retries had widened out to a long wait.
    window.addEventListener('online', () => this.retryNow());
  }
}

/**
 * What the stores actually inject. Every write lands in `localStorage` first —
 * that is the cache the next reload paints from — and is then handed to the
 * sync service, which does nothing at all when there is no server.
 */
@Injectable({ providedIn: 'root' })
export class SyncedStorageBackend implements StorageBackend {
  private readonly local = inject(LocalStorageBackend);
  private readonly sync = inject(SyncService);

  read<T>(key: string): T | null {
    return this.local.read<T>(key);
  }

  write(key: string, value: unknown): void {
    this.local.write(key, value);
    this.sync.queueWrite(key, value);
  }

  remove(key: string): void {
    this.local.remove(key);
    this.sync.queueRemove(key);
  }

  keys(prefix: string): string[] {
    return this.local.keys(prefix);
  }
}
