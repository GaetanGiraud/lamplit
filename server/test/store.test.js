import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, readdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, describe, it } from 'node:test';
import { DocumentStore, isCollection, isId } from '../src/store.js';

async function freshStore() {
  const dir = await mkdtemp(join(tmpdir(), 'lamplit-store-'));
  const store = new DocumentStore(dir);
  await store.init();
  return store;
}

/**
 * A document as its writer wrote it, without the revision the store stamped on
 * it. Every read has one and none of them is predictable, so the assertions
 * that are about the writing say so by leaving it out.
 */
function written(document) {
  if (document === null) return null;
  const copy = { ...document };
  delete copy.rev;
  return copy;
}

describe('paths', () => {
  it('knows the three collections and nothing else', () => {
    assert.ok(isCollection('settings'));
    assert.ok(isCollection('stories'));
    assert.ok(isCollection('chapters'));
    assert.ok(!isCollection('backups'));
    assert.ok(!isCollection('__proto__'));
  });

  it('rejects ids that could climb out of the data folder', () => {
    assert.ok(isId('stories', 'a1b2-c3'));
    assert.ok(!isId('stories', '../secret'));
    assert.ok(!isId('stories', 'a/b'));
    assert.ok(!isId('stories', ''));
  });

  it('allows settings only under its own name', () => {
    assert.ok(isId('settings', 'settings'));
    assert.ok(!isId('settings', 'anything-else'));
  });
});

describe('DocumentStore', () => {
  it('round-trips a document and lists it', async () => {
    const store = await freshStore();
    const { rev } = await store.write('stories', 'one', { id: 'one', title: 'A' });
    assert.deepEqual(await store.read('stories', 'one'), { id: 'one', title: 'A', rev });
    assert.deepEqual(written(await store.read('stories', 'one')), { id: 'one', title: 'A' });
    assert.deepEqual((await store.list('stories')).map(written), [{ id: 'one', title: 'A' }]);
  });

  it('reads a missing document as null rather than throwing', async () => {
    const store = await freshStore();
    assert.equal(await store.read('stories', 'nope'), null);
    assert.deepEqual(await store.list('stories'), []);
  });

  it('treats a corrupted file as missing, so the client can write over it', async () => {
    const store = await freshStore();
    await store.write('stories', 'one', { id: 'one' });
    await writeFile(store.pathOf('stories', 'one'), '{ this is not json', 'utf8');
    assert.equal(await store.read('stories', 'one'), null);
    assert.deepEqual(await store.list('stories'), []);
  });

  it('keeps settings in one file at the top of the data folder', async () => {
    const store = await freshStore();
    await store.write('settings', 'settings', { activeStoryId: 'x' });
    assert.ok(store.pathOf('settings', 'settings').endsWith('settings.json'));
    assert.deepEqual((await store.list('settings')).map(written), [{ activeStoryId: 'x' }]);
  });

  it('writes in arrival order, whoever comes first', async () => {
    const store = await freshStore();
    const writes = [];
    for (let i = 0; i < 25; i++) writes.push(store.write('chapters', 'c', { turn: i }));
    await Promise.all(writes);
    assert.deepEqual(written(await store.read('chapters', 'c')), { turn: 24 });
  });

  it('writes unconditionally when nothing says what it was based on', async () => {
    const store = await freshStore();
    await store.write('stories', 'one', { title: 'first' });
    const over = await store.write('stories', 'one', { title: 'second' });
    assert.equal(over.ok, true);
    assert.deepEqual(written(await store.read('stories', 'one')), { title: 'second' });
  });

  it('stamps a fresh revision on every write', async () => {
    const store = await freshStore();
    const first = await store.write('stories', 'one', { title: 'first' });
    const second = await store.write('stories', 'one', { title: 'second' }, first.rev);
    assert.match(first.rev, /^[0-9a-f]{16}$/);
    assert.notEqual(second.rev, first.rev);
    assert.equal((await store.read('stories', 'one')).rev, second.rev);
  });

  it('creates a document for a writer that says it was based on nothing', async () => {
    const store = await freshStore();
    const made = await store.write('stories', 'one', { title: 'new' }, '');
    assert.equal(made.ok, true);
    // And refuses the same claim a second time: there is something here now.
    const again = await store.write('stories', 'one', { title: 'also new' }, '');
    assert.equal(again.conflict, true);
    assert.deepEqual(written(await store.read('stories', 'one')), { title: 'new' });
  });

  it('refuses a write based on a revision the document has moved past', async () => {
    const store = await freshStore();
    const first = await store.write('stories', 'one', { title: 'first' }, '');
    await store.write('stories', 'one', { title: 'from the phone' }, first.rev);

    const stale = await store.write('stories', 'one', { title: 'from the laptop' }, first.rev);
    assert.equal(stale.ok, false);
    assert.equal(stale.conflict, true);
    // The document comes back with the refusal, so reloading it is not a
    // second request the phone could win again in between.
    assert.deepEqual(written(stale.document), { title: 'from the phone' });
    assert.equal(stale.rev, (await store.read('stories', 'one')).rev);
    assert.deepEqual(written(await store.read('stories', 'one')), { title: 'from the phone' });
  });

  it('lets the writer that reloaded try again, and this time it lands', async () => {
    const store = await freshStore();
    const first = await store.write('stories', 'one', { title: 'first' }, '');
    const theirs = await store.write('stories', 'one', { title: 'theirs' }, first.rev);
    const refused = await store.write('stories', 'one', { title: 'mine' }, first.rev);
    assert.equal(refused.conflict, true);
    const retried = await store.write('stories', 'one', { title: 'mine' }, theirs.rev);
    assert.equal(retried.ok, true);
    assert.deepEqual(written(await store.read('stories', 'one')), { title: 'mine' });
  });

  it('refuses a stale write onto a deleted document rather than resurrecting it', async () => {
    const store = await freshStore();
    const first = await store.write('stories', 'one', { title: 'here' }, '');
    await store.remove('stories', 'one');
    const zombie = await store.write('stories', 'one', { title: 'back from the dead' }, first.rev);
    assert.equal(zombie.conflict, true);
    assert.equal(zombie.rev, '');
    assert.equal(zombie.document, null);
    assert.equal(await store.read('stories', 'one'), null);
  });

  it('deletes whatever the caller last saw, because deleting is somebody saying so', async () => {
    const store = await freshStore();
    const first = await store.write('stories', 'one', { title: 'here' }, '');
    await store.write('stories', 'one', { title: 'changed elsewhere' }, first.rev);
    // No revision is asked for and none is compared: a story taking its
    // chapters with it deletes chapters nobody has looked at.
    assert.equal((await store.remove('stories', 'one')).ok, true);
    assert.equal(await store.read('stories', 'one'), null);
  });

  it('holds the guard across a restart, because the revision is on the disk', async () => {
    const store = await freshStore();
    const first = await store.write('stories', 'one', { title: 'first' }, '');
    const second = await store.write('stories', 'one', { title: 'second' }, first.rev);

    // A new store over the same folder is what the next start is.
    const restarted = new DocumentStore(store.dataDir);
    assert.equal(
      (await restarted.write('stories', 'one', { title: 'x' }, first.rev)).conflict,
      true,
    );
    assert.equal((await restarted.write('stories', 'one', { title: 'x' }, second.rev)).ok, true);
  });

  it('notices a file that was changed behind its back', async () => {
    const store = await freshStore();
    const first = await store.write('stories', 'one', { title: 'first' }, '');
    // A hand edit, or a restored backup: the revision on disk is not the one
    // this writer was given, and that is exactly what the guard is for.
    await writeFile(store.pathOf('stories', 'one'), '{ "title": "by hand" }\n', 'utf8');
    const refused = await store.write('stories', 'one', { title: 'over the top' }, first.rev);
    assert.equal(refused.conflict, true);
    assert.deepEqual(refused.document, { title: 'by hand' });
  });

  it('leaves no temporary files behind', async () => {
    const store = await freshStore();
    await Promise.all([
      store.write('chapters', 'a', { n: 1 }),
      store.write('chapters', 'b', { n: 2 }),
      store.write('chapters', 'a', { n: 3 }),
    ]);
    const files = await readdir(join(store.dataDir, 'chapters'));
    assert.deepEqual(files.sort(), ['a.json', 'b.json']);
  });

  it('queues two spellings of one id on the chain the disk makes them share', async () => {
    const store = await freshStore();
    // Windows and macOS give `abc.json` and `ABC.json` the same file; Linux
    // gives two. Asked rather than assumed, because which one is running this
    // is the whole subject of the test.
    await store.write('stories', 'Probe', { probe: true });
    const oneFile = (await store.read('stories', 'probe')) !== null;

    // Enqueued in this order, and folding the key puts them on one chain, so
    // they are ordered rather than racing.
    const [first, second] = await Promise.all([
      store.write('stories', 'abc', { title: 'first' }),
      store.write('stories', 'ABC', { title: 'second' }),
    ]);
    assert.equal(first.ok, true);
    assert.equal(second.ok, true);

    // Where the two spellings are one file, that ordering is what decides
    // which write is the one left on disk; where they are two, each keeps its
    // own and there was never anything to order.
    assert.deepEqual(written(await store.read('stories', 'ABC')), { title: 'second' });
    assert.deepEqual(written(await store.read('stories', 'abc')), {
      title: oneFile ? 'second' : 'first',
    });
  });

  it('leaves no temporary file behind when the rename itself fails', async () => {
    const store = await freshStore();
    // A folder wearing the document's name: nothing can be renamed over it.
    await mkdir(store.pathOf('stories', 'one'));
    await assert.rejects(store.write('stories', 'one', { id: 'one' }));
    assert.deepEqual(await readdir(join(store.dataDir, 'stories')), ['one.json']);
  });

  it('lists the documents it can read and skips the one it cannot', async () => {
    const store = await freshStore();
    await store.write('stories', 'good', { id: 'good' });
    await mkdir(store.pathOf('stories', 'bad'));
    const warn = console.warn;
    console.warn = () => {};
    try {
      assert.deepEqual((await store.list('stories')).map(written), [{ id: 'good' }]);
    } finally {
      console.warn = warn;
    }
  });

  it('writes readable JSON, which is the point of files on disk', async () => {
    const store = await freshStore();
    await store.write('stories', 'one', { id: 'one', title: 'The Lighthouse' });
    const text = await readFile(store.pathOf('stories', 'one'), 'utf8');
    assert.ok(text.includes('\n  "title": "The Lighthouse"'));
    assert.ok(text.endsWith('\n'));
  });

  it('keeps taking writes after one of them fails', async () => {
    const store = await freshStore();
    const circular = {};
    circular.self = circular;
    await assert.rejects(store.write('stories', 'one', circular));
    await store.write('stories', 'one', { title: 'fine' });
    assert.deepEqual(written(await store.read('stories', 'one')), { title: 'fine' });
  });

  it('removes a document, and does not mind removing it twice', async () => {
    const store = await freshStore();
    await store.write('stories', 'one', { id: 'one' });
    await store.remove('stories', 'one');
    await store.remove('stories', 'one');
    assert.equal(await store.read('stories', 'one'), null);
  });

  it('indexes a collection by id, freshness and revision', async () => {
    const store = await freshStore();
    const a = await store.write('chapters', 'a', {
      id: 'a',
      updatedAt: '2026-01-02T00:00:00.000Z',
    });
    await store.write('chapters', 'b', { id: 'b', updatedAt: '2026-01-03T00:00:00.000Z' });
    const index = await store.index('chapters');
    assert.deepEqual(index.map((entry) => entry.id).sort(), ['a', 'b']);
    assert.ok(index.every((entry) => typeof entry.updatedAt === 'string'));
    // The revision is what makes coming back to a tab a comparison rather
    // than a download of everything.
    assert.equal(index.find((entry) => entry.id === 'a').rev, a.rev);
  });
});

after(() => {
  // The temporary folders are the OS's problem; nothing here holds handles.
});
