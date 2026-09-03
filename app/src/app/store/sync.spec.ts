import { TestBed } from '@angular/core/testing';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { keyOf, refOf } from './document-api';
import { STORAGE_BACKEND } from './storage';
import { SyncService, SyncedStorageBackend } from './sync';

/** A stand-in for the server, answering from a set of documents it holds. */
class FakeServer {
  readonly documents = new Map<string, unknown>();
  readonly requests: { method: string; url: string; seq: number; body: unknown }[] = [];
  present = true;
  failWith: string | null = null;

  readonly fetch = async (url: string, init: RequestInit = {}): Promise<Response> => {
    const method = init.method ?? 'GET';
    const path = url.replace('/api', '');
    if (path === '/health') {
      return this.present
        ? this.json({ ok: true, name: 'magicstories', version: 'test' })
        : Promise.reject(new TypeError('Failed to fetch'));
    }
    if (this.failWith) throw new TypeError(this.failWith);

    const seq = Number((init.headers as Record<string, string>)?.['x-doc-seq'] ?? 0);
    const body = init.body ? JSON.parse(init.body as string) : null;
    this.requests.push({ method, url, seq, body });

    const list = /^\/docs\/(settings|stories|chapters)$/.exec(path);
    if (list) return this.json(this.of(list[1]));

    const one = /^\/docs\/(settings|stories|chapters)\/(.+)$/.exec(path);
    if (!one) return this.json({ ok: false }, 404);
    const key = keyOf({ collection: one[1] as 'stories', id: decodeURIComponent(one[2]) });
    if (method === 'PUT') this.documents.set(key, body);
    if (method === 'DELETE') this.documents.delete(key);
    return this.json({ ok: true, seq, skipped: false });
  };

  /** Every document of one collection, the way the API returns them. */
  private of(collection: string): unknown[] {
    const held: unknown[] = [];
    for (const [key, document] of this.documents) {
      if (refOf(key)?.collection === collection) held.push(document);
    }
    return held;
  }

  private json(body: unknown, status = 200): Promise<Response> {
    return Promise.resolve(
      new Response(JSON.stringify(body), {
        status,
        headers: { 'content-type': 'application/json' },
      }),
    );
  }
}

const SETTINGS = { activeStoryId: 'abc', ui: { theme: 'dark' } };
const story = (id: string, title: string) => ({ id, title, updatedAt: '2026-01-01T00:00:00.000Z' });

function local(key: string): unknown {
  const raw = localStorage.getItem(`magicstories:${key}`);
  return raw === null ? null : JSON.parse(raw);
}

function seedLocal(key: string, value: unknown): void {
  localStorage.setItem(`magicstories:${key}`, JSON.stringify(value));
}

describe('refOf', () => {
  it('maps the three document kinds onto the server, and nothing else', () => {
    expect(refOf('settings')).toEqual({ collection: 'settings', id: 'settings' });
    expect(refOf('story:abc')).toEqual({ collection: 'stories', id: 'abc' });
    expect(refOf('chapter:one')).toEqual({ collection: 'chapters', id: 'one' });
    // Step 1's conversation is migrated on load; it never reaches the server.
    expect(refOf('chat:old')).toBeNull();
    expect(refOf('active-chat')).toBeNull();
    expect(refOf('sync:pending')).toBeNull();
  });

  it('round-trips back to the key the stores use', () => {
    for (const key of ['settings', 'story:abc', 'chapter:one']) {
      expect(keyOf(refOf(key)!)).toBe(key);
    }
  });
});

describe('SyncService', () => {
  let server: FakeServer;

  beforeEach(() => {
    localStorage.clear();
    server = new FakeServer();
    vi.stubGlobal('fetch', server.fetch);
    vi.useFakeTimers();
    TestBed.configureTestingModule({
      providers: [{ provide: STORAGE_BACKEND, useExisting: SyncedStorageBackend }],
    });
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  /** Lets the debounce elapse and every queued request settle. */
  async function settle(): Promise<void> {
    await vi.advanceTimersByTimeAsync(500);
  }

  function start(): { sync: SyncService; storage: SyncedStorageBackend } {
    return {
      sync: TestBed.inject(SyncService),
      storage: TestBed.inject(SyncedStorageBackend),
    };
  }

  it('runs on localStorage alone when nothing is listening on /api', async () => {
    server.present = false;
    const { sync, storage } = start();
    await sync.bootstrap();
    storage.write('story:abc', story('abc', 'The Lighthouse'));
    await settle();

    expect(sync.status()).toBe('local');
    expect(server.requests).toHaveLength(0);
    expect(local('story:abc')).toEqual(story('abc', 'The Lighthouse'));
  });

  it('uploads what this browser already had when the server is empty', async () => {
    seedLocal('settings', SETTINGS);
    seedLocal('story:abc', story('abc', 'The Lighthouse'));
    seedLocal('chapter:one', { id: 'one', storyId: 'abc' });
    // A leftover from step 1 is not a document the server knows about.
    seedLocal('chat:old', { messages: [] });

    const { sync } = start();
    await sync.bootstrap();
    await settle();

    expect(sync.status()).toBe('saved');
    expect([...server.documents.keys()].sort()).toEqual(['chapter:one', 'settings', 'story:abc']);
    expect(server.documents.get('story:abc')).toEqual(story('abc', 'The Lighthouse'));
  });

  it('takes the server as the truth, and lets go of what it no longer has', async () => {
    seedLocal('story:abc', story('abc', 'Stale title'));
    seedLocal('story:gone', story('gone', 'Deleted in another tab'));
    server.documents.set('story:abc', story('abc', 'The Lighthouse'));
    server.documents.set('settings', SETTINGS);

    const { sync } = start();
    await sync.bootstrap();

    expect(sync.status()).toBe('saved');
    expect(local('story:abc')).toEqual(story('abc', 'The Lighthouse'));
    expect(local('settings')).toEqual(SETTINGS);
    expect(local('story:gone')).toBeNull();
  });

  it('keeps a document written while the server was down, and sends it', async () => {
    // What the previous session left behind: a write that never got through.
    seedLocal('story:abc', story('abc', 'Written offline'));
    seedLocal('sync:pending', { 'story:abc': 'write' });
    server.documents.set('story:abc', story('abc', 'Older, on the server'));

    const { sync } = start();
    await sync.bootstrap();
    await settle();

    expect(local('story:abc')).toEqual(story('abc', 'Written offline'));
    expect(server.documents.get('story:abc')).toEqual(story('abc', 'Written offline'));
    expect(sync.status()).toBe('saved');
    expect(local('sync:pending')).toBeNull();
  });

  it('replays a delete that never got through', async () => {
    seedLocal('sync:pending', { 'story:gone': 'delete' });
    server.documents.set('story:gone', story('gone', 'Should not survive'));

    const { sync } = start();
    await sync.bootstrap();
    await settle();

    expect(server.documents.has('story:gone')).toBe(false);
  });

  it('sends one request per document however fast the store writes', async () => {
    const { sync, storage } = start();
    await sync.bootstrap();
    server.requests.length = 0;

    for (let i = 1; i <= 5; i++) storage.write('chapter:one', { id: 'one', turn: i });
    await settle();

    const writes = server.requests.filter((request) => request.method === 'PUT');
    expect(writes).toHaveLength(1);
    expect(writes[0].body).toEqual({ id: 'one', turn: 5 });
  });

  it('stamps every write with a sequence number that only goes up', async () => {
    const { sync, storage } = start();
    await sync.bootstrap();
    server.requests.length = 0;

    storage.write('story:abc', story('abc', 'One'));
    await settle();
    storage.write('chapter:one', { id: 'one' });
    await settle();
    storage.remove('story:abc');
    await settle();

    const seqs = server.requests.map((request) => request.seq);
    expect(seqs).toHaveLength(3);
    expect(seqs).toEqual([...seqs].sort((a, b) => a - b));
    expect(new Set(seqs).size).toBe(3);
  });

  it('keeps writing while the server is away, and catches up when it returns', async () => {
    const { sync, storage } = start();
    await sync.bootstrap();
    server.failWith = 'Failed to fetch';

    storage.write('story:abc', story('abc', 'Written while offline'));
    await settle();

    expect(sync.status()).toBe('offline');
    expect(local('story:abc')).toEqual(story('abc', 'Written while offline'));
    // The queue survives a reload, so nothing written offline is lost.
    expect(local('sync:pending')).toEqual({ 'story:abc': 'write' });

    server.failWith = null;
    sync.retryNow();
    await settle();

    expect(sync.status()).toBe('saved');
    expect(server.documents.get('story:abc')).toEqual(story('abc', 'Written while offline'));
    expect(local('sync:pending')).toBeNull();
  });

  it('retries on its own, with a widening delay', async () => {
    const { sync, storage } = start();
    await sync.bootstrap();
    server.failWith = 'Failed to fetch';

    storage.write('story:abc', story('abc', 'A'));
    await settle();
    expect(sync.status()).toBe('offline');

    server.failWith = null;
    await vi.advanceTimersByTimeAsync(2000);
    expect(sync.status()).toBe('saved');
    expect(server.documents.has('story:abc')).toBe(true);
  });

  it('sends what the document says now, not what it said when it was queued', async () => {
    const { sync, storage } = start();
    await sync.bootstrap();
    server.failWith = 'Failed to fetch';
    storage.write('chapter:one', { id: 'one', turn: 1 });
    await settle();

    // The chapter kept being written into while the server was unreachable.
    storage.write('chapter:one', { id: 'one', turn: 2 });
    server.failWith = null;
    sync.retryNow();
    await settle();

    expect(server.documents.get('chapter:one')).toEqual({ id: 'one', turn: 2 });
  });

  it('deletes on the server what the store deletes here', async () => {
    server.documents.set('chapter:one', { id: 'one' });
    const { sync, storage } = start();
    await sync.bootstrap();

    storage.remove('chapter:one');
    await settle();

    expect(server.documents.has('chapter:one')).toBe(false);
    expect(local('chapter:one')).toBeNull();
  });
});
