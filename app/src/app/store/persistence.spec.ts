import { TestBed } from '@angular/core/testing';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { keyOf, refOf } from './document-api';
import { Persistence } from './persistence';

/** A stand-in for the server, answering from a set of documents it holds. */
class FakeServer {
  readonly documents = new Map<string, unknown>();
  readonly requests: { method: string; url: string; seq: number; body: unknown }[] = [];
  failWith: string | null = null;

  readonly fetch = async (url: string, init: RequestInit = {}): Promise<Response> => {
    if (this.failWith) throw new TypeError(this.failWith);
    const method = init.method ?? 'GET';
    const path = url.replace('/api', '');
    const seq = Number((init.headers as Record<string, string> | undefined)?.['x-doc-seq'] ?? 0);
    const body: unknown = init.body ? JSON.parse(init.body as string) : null;
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

describe('refOf', () => {
  it('maps the three document kinds onto the server, and nothing else', () => {
    expect(refOf('settings')).toEqual({ collection: 'settings', id: 'settings' });
    expect(refOf('story:abc')).toEqual({ collection: 'stories', id: 'abc' });
    expect(refOf('chapter:one')).toEqual({ collection: 'chapters', id: 'one' });
    expect(refOf('something-else')).toBeNull();
  });

  it('round-trips back to the key the stores use', () => {
    for (const key of ['settings', 'story:abc', 'chapter:one']) {
      expect(keyOf(refOf(key)!)).toBe(key);
    }
  });
});

describe('Persistence', () => {
  let server: FakeServer;
  let persistence: Persistence;

  beforeEach(() => {
    server = new FakeServer();
    vi.stubGlobal('fetch', server.fetch);
    vi.useFakeTimers();
    TestBed.configureTestingModule({});
    persistence = TestBed.inject(Persistence);
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  /** Lets the debounce elapse and every queued request settle. */
  const settle = () => vi.advanceTimersByTimeAsync(500);

  it('starts with what the server has, and nothing else', async () => {
    server.documents.set('settings', SETTINGS);
    server.documents.set('story:abc', story('abc', 'The Lighthouse'));
    server.documents.set('chapter:one', { id: 'one', storyId: 'abc' });

    await persistence.load();

    expect(persistence.ready()).toBe(true);
    expect(persistence.read('story:abc')).toEqual(story('abc', 'The Lighthouse'));
    expect(persistence.keys('chapter:')).toEqual(['chapter:one']);
    expect(persistence.read('story:missing')).toBeNull();
  });

  it('does not start at all when the server cannot be reached', async () => {
    server.failWith = 'Failed to fetch';

    // load() waits between attempts, so the clock has to be wound on for it.
    const loading = persistence.load();
    await vi.advanceTimersByTimeAsync(5000);
    await loading;

    expect(persistence.ready()).toBe(false);
    expect(persistence.error()).toContain('Failed to fetch');
    // Nothing invented to fill the gap: an empty app would look like a fresh
    // install and would be written over the real one.
    expect(persistence.keys('')).toEqual([]);
  });

  it('comes up when the server was only slow to start', async () => {
    server.failWith = 'Failed to fetch';
    const loading = persistence.load();
    await vi.advanceTimersByTimeAsync(500);
    server.failWith = null;
    await vi.advanceTimersByTimeAsync(2000);
    await loading;

    expect(persistence.ready()).toBe(true);
  });

  it('reads back a write immediately, before it has been sent anywhere', async () => {
    await persistence.load();
    persistence.write('story:abc', story('abc', 'Just typed'));

    expect(persistence.read('story:abc')).toEqual(story('abc', 'Just typed'));
    expect(server.documents.has('story:abc')).toBe(false);

    await settle();
    expect(server.documents.get('story:abc')).toEqual(story('abc', 'Just typed'));
  });

  it('sends one request per document however fast the store writes', async () => {
    await persistence.load();
    server.requests.length = 0;

    for (let i = 1; i <= 5; i++) persistence.write('chapter:one', { id: 'one', turn: i });
    await settle();

    const writes = server.requests.filter((request) => request.method === 'PUT');
    expect(writes).toHaveLength(1);
    expect(writes[0].body).toEqual({ id: 'one', turn: 5 });
  });

  it('stamps every write with a sequence number that only goes up', async () => {
    await persistence.load();
    server.requests.length = 0;

    persistence.write('story:abc', story('abc', 'One'));
    await settle();
    persistence.write('chapter:one', { id: 'one' });
    await settle();
    persistence.remove('story:abc');
    await settle();

    const seqs = server.requests.map((request) => request.seq);
    expect(seqs).toHaveLength(3);
    expect(seqs).toEqual([...seqs].sort((a, b) => a - b));
    expect(new Set(seqs).size).toBe(3);
  });

  it('deletes on the server what the store deletes here', async () => {
    server.documents.set('chapter:one', { id: 'one' });
    await persistence.load();

    persistence.remove('chapter:one');
    expect(persistence.read('chapter:one')).toBeNull();

    await settle();
    expect(server.documents.has('chapter:one')).toBe(false);
  });

  it('sends a delete the tab was closed on, not only a write', async () => {
    server.documents.set('chapter:one', { id: 'one' });
    server.documents.set('story:abc', story('abc', 'The Lighthouse'));
    await persistence.load();
    persistence.listen();
    server.requests.length = 0;

    // Deleted, and the window closed inside the debounce: the queue never runs,
    // so the request either leaves with the page or does not leave at all.
    persistence.remove('chapter:one');
    window.dispatchEvent(new Event('beforeunload', { cancelable: true }));

    expect(server.requests.map((request) => request.method)).toEqual(['DELETE']);
    await settle();
    expect(server.documents.has('chapter:one')).toBe(false);
  });

  it('keeps the session going while the server is away, and catches up after', async () => {
    await persistence.load();
    server.failWith = 'Failed to fetch';

    persistence.write('story:abc', story('abc', 'Written while offline'));
    await settle();

    expect(persistence.status()).toBe('offline');
    // The session still has everything it needs; only the disk is behind.
    expect(persistence.read('story:abc')).toEqual(story('abc', 'Written while offline'));

    server.failWith = null;
    persistence.retryNow();
    await settle();

    expect(persistence.status()).toBe('saved');
    expect(server.documents.get('story:abc')).toEqual(story('abc', 'Written while offline'));
  });

  it('retries on its own, with a widening delay', async () => {
    await persistence.load();
    server.failWith = 'Failed to fetch';
    persistence.write('story:abc', story('abc', 'A'));
    await settle();
    expect(persistence.status()).toBe('offline');

    server.failWith = null;
    await vi.advanceTimersByTimeAsync(2000);

    expect(persistence.status()).toBe('saved');
    expect(server.documents.has('story:abc')).toBe(true);
  });

  it('sends what the document says now, not what it said when it was queued', async () => {
    await persistence.load();
    server.failWith = 'Failed to fetch';
    persistence.write('chapter:one', { id: 'one', turn: 1 });
    await settle();

    persistence.write('chapter:one', { id: 'one', turn: 2 });
    server.failWith = null;
    persistence.retryNow();
    await settle();

    expect(server.documents.get('chapter:one')).toEqual({ id: 'one', turn: 2 });
  });

  it('picks the server up again after a failed start', async () => {
    server.failWith = 'Failed to fetch';
    const failing = persistence.load();
    await vi.advanceTimersByTimeAsync(5000);
    await failing;
    expect(persistence.ready()).toBe(false);

    server.failWith = null;
    server.documents.set('story:abc', story('abc', 'It was there all along'));
    const recovered = persistence.retryLoad();
    await vi.advanceTimersByTimeAsync(2000);

    expect(await recovered).toBe(true);
    expect(persistence.read('story:abc')).toEqual(story('abc', 'It was there all along'));
  });
});
