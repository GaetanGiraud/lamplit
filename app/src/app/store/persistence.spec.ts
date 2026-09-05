import { TestBed } from '@angular/core/testing';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { keyOf, refOf } from './document-api';
import { Persistence } from './persistence';

/** A stand-in for the server, answering from a set of documents it holds. */
class FakeServer {
  readonly documents = new Map<string, unknown>();
  readonly requests: { method: string; url: string; seq: number; body: unknown }[] = [];
  failWith: string | null = null;
  /** Takes the request and never answers: a server mid-restart, or a stalled disk. */
  hang = false;
  /** Keys the server answers with a status and a reason instead of taking them. */
  readonly refuse = new Map<string, { status: number; error: string }>();
  /** Keys the server answers 200 to and then drops, as a newer write has won. */
  readonly skip = new Set<string>();

  readonly fetch = async (url: string, init: RequestInit = {}): Promise<Response> => {
    if (this.failWith) throw new TypeError(this.failWith);
    const method = init.method ?? 'GET';
    const path = url.replace('/api', '');
    const seq = Number((init.headers as Record<string, string> | undefined)?.['x-doc-seq'] ?? 0);
    const body: unknown = init.body ? JSON.parse(init.body as string) : null;
    this.requests.push({ method, url, seq, body });
    if (this.hang) await new Promise(() => undefined);

    const list = /^\/docs\/(settings|stories|chapters)$/.exec(path);
    if (list) return this.json(this.of(list[1]));

    const one = /^\/docs\/(settings|stories|chapters)\/(.+)$/.exec(path);
    if (!one) return this.json({ ok: false }, 404);
    const key = keyOf({ collection: one[1] as 'stories', id: decodeURIComponent(one[2]) });
    const refusal = this.refuse.get(key);
    if (refusal) return this.json({ ok: false, error: refusal.error }, refusal.status);
    if (this.skip.has(key)) return this.json({ ok: true, seq, skipped: true });
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

  /**
   * Every listener this test's `Persistence` puts on the window, so that it can
   * be taken off again. It is a page-long singleton in the app and has no
   * reason to stop listening there; here, one left behind would answer the next
   * test's `beforeunload` with the last test's queue.
   */
  let listeners: [string, EventListener][] = [];

  beforeEach(() => {
    server = new FakeServer();
    vi.stubGlobal('fetch', server.fetch);
    vi.useFakeTimers();
    listeners = [];
    const add = window.addEventListener.bind(window);
    vi.spyOn(window, 'addEventListener').mockImplementation((type, handler, options) => {
      listeners.push([type, handler as EventListener]);
      add(type, handler, options);
    });
    TestBed.configureTestingModule({});
    persistence = TestBed.inject(Persistence);
  });

  afterEach(() => {
    vi.restoreAllMocks();
    for (const [type, handler] of listeners) window.removeEventListener(type, handler);
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

  it('says it is saving from the moment there is something to save', async () => {
    await persistence.load();
    expect(persistence.status()).toBe('saved');

    persistence.write('chapter:one', { id: 'one', turn: 1 });
    // Still in the debounce: nothing has been sent, and nothing is on disk.
    expect(persistence.status()).toBe('saving');

    await settle();
    expect(persistence.status()).toBe('saved');
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

  it('sends again from the unload when a write is still in the air', async () => {
    await persistence.load();
    persistence.listen();
    server.requests.length = 0;
    server.hang = true;

    persistence.write('chapter:one', { id: 'one', turn: 1 });
    // Long enough for the queue to have taken it and sent it, not long enough
    // for anything to have come back: the server is not answering.
    await vi.advanceTimersByTimeAsync(400);
    expect(server.requests).toHaveLength(1);

    window.dispatchEvent(new Event('beforeunload', { cancelable: true }));

    expect(server.requests).toHaveLength(2);
    expect(server.requests[1].body).toEqual({ id: 'one', turn: 1 });
    // The later one wins wherever the two land: the server drops the older seq.
    expect(server.requests[1].seq).toBeGreaterThan(server.requests[0].seq);
  });

  it('says a chapter is unsaved rather than posting it into a refusal', async () => {
    await persistence.load();
    persistence.listen();
    server.requests.length = 0;

    // A chapter of a few dozen exchanges: past the 64 KiB the browser will
    // carry for a page that is leaving, which it refuses without a word.
    persistence.write('chapter:long-one', { id: 'long-one', text: 'x'.repeat(70_000) });
    const event = new Event('beforeunload', { cancelable: true });
    window.dispatchEvent(event);

    expect(event.defaultPrevented).toBe(true);
    expect(server.requests).toHaveLength(0);
  });

  it('carries what does fit, and says nothing about it', async () => {
    await persistence.load();
    persistence.listen();
    server.requests.length = 0;

    persistence.write('chapter:short-one', { id: 'short-one', text: 'A short scene.' });
    const event = new Event('beforeunload', { cancelable: true });
    window.dispatchEvent(event);

    expect(event.defaultPrevented).toBe(false);
    expect(server.requests).toHaveLength(1);
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

  it('does not let a document the server refuses hold up the rest', async () => {
    await persistence.load();
    // A story the server will not have: an id it refuses, a body past its
    // limit, a Host it does not answer to. It never becomes acceptable.
    server.refuse.set('story:bad', { status: 413, error: 'document too large' });

    persistence.write('story:bad', story('bad', 'The Long One'));
    persistence.write('chapter:one', { id: 'one', turn: 1 });
    await settle();

    expect(persistence.status()).toBe('refused');
    // Named, in the server's own words, rather than reported as no network.
    expect(persistence.error()).toContain('The Long One');
    expect(persistence.error()).toContain('document too large');
    // Everything queued behind it went, and goes on going.
    expect(server.documents.get('chapter:one')).toEqual({ id: 'one', turn: 1 });

    persistence.write('chapter:two', { id: 'two', turn: 1 });
    await settle();
    expect(server.documents.get('chapter:two')).toEqual({ id: 'two', turn: 1 });
    expect(persistence.status()).toBe('refused');
  });

  it('stops asking for a refused document rather than retrying for ever', async () => {
    await persistence.load();
    server.refuse.set('story:bad', { status: 400, error: 'body must be a JSON document' });

    persistence.write('story:bad', story('bad', 'Unparseable'));
    await settle();
    const asked = server.requests.filter((request) => request.url.includes('bad')).length;
    expect(asked).toBe(1);

    // The widening retry would have come round several times over by now.
    await vi.advanceTimersByTimeAsync(30_000);
    expect(server.requests.filter((request) => request.url.includes('bad'))).toHaveLength(1);
    expect(persistence.status()).toBe('refused');
  });

  it('tells a server that will not answer apart from one that will not take this', async () => {
    await persistence.load();
    server.failWith = 'Failed to fetch';
    persistence.write('story:abc', story('abc', 'A'));
    await settle();
    expect(persistence.status()).toBe('offline');

    server.failWith = null;
    server.refuse.set('story:abc', { status: 404, error: 'not found' });
    persistence.retryNow();
    await settle();

    expect(persistence.status()).toBe('refused');
    expect(persistence.error()).toContain('not found');
  });

  it('tries a refused document again when asked, and settles once it is taken', async () => {
    await persistence.load();
    server.refuse.set('chapter:one', { status: 413, error: 'document too large' });
    persistence.write('chapter:one', { id: 'one', title: 'The Long Scene' });
    await settle();
    expect(persistence.status()).toBe('refused');

    // The reader shortened it, or the limit was raised: either way, ask again.
    server.refuse.delete('chapter:one');
    persistence.retryNow();
    await settle();

    expect(persistence.status()).toBe('saved');
    expect(persistence.error()).toBe('');
    expect(server.documents.get('chapter:one')).toEqual({ id: 'one', title: 'The Long Scene' });
  });

  it('does not call a write saved that the server took and dropped', async () => {
    await persistence.load();
    // Another window got there first with a higher sequence number, so this
    // write never reached the disk however cheerful the 200 looked.
    server.skip.add('story:abc');

    persistence.write('story:abc', story('abc', 'Written here'));
    await settle();

    expect(persistence.status()).toBe('refused');
    expect(persistence.error()).toContain('newer version');
    expect(server.documents.has('story:abc')).toBe(false);
  });

  it('warns on close about a document the server refused, not only a queue', async () => {
    await persistence.load();
    persistence.listen();
    server.refuse.set('story:bad', { status: 400, error: 'body must be a JSON document' });

    persistence.write('story:bad', story('bad', 'Unparseable'));
    await settle();
    expect(persistence.status()).toBe('refused');

    const event = new Event('beforeunload', { cancelable: true });
    window.dispatchEvent(event);

    // The queue is empty and everything else is on disk; this one is not, and
    // closing the tab is the last it will be seen of.
    expect(event.defaultPrevented).toBe(true);
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
