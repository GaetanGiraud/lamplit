import assert from 'node:assert/strict';
import { mkdtemp, readFile, readdir, writeFile } from 'node:fs/promises';
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
    await store.write('stories', 'one', { id: 'one', title: 'A' });
    assert.deepEqual(await store.read('stories', 'one'), { id: 'one', title: 'A' });
    assert.deepEqual(await store.list('stories'), [{ id: 'one', title: 'A' }]);
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
    assert.deepEqual(await store.list('settings'), [{ activeStoryId: 'x' }]);
  });

  it('writes in arrival order, whoever comes first', async () => {
    const store = await freshStore();
    const writes = [];
    for (let i = 0; i < 25; i++) writes.push(store.write('chapters', 'c', { turn: i }));
    await Promise.all(writes);
    assert.deepEqual(await store.read('chapters', 'c'), { turn: 24 });
  });

  it('drops a write older than the last one applied', async () => {
    const store = await freshStore();
    await store.write('stories', 'one', { title: 'first' }, 100);
    const stale = await store.write('stories', 'one', { title: 'stale' }, 60);
    assert.deepEqual(stale, { ok: true, seq: 100, skipped: true });
    assert.deepEqual(await store.read('stories', 'one'), { title: 'first' });

    const newer = await store.write('stories', 'one', { title: 'newer' }, 101);
    assert.equal(newer.skipped, false);
    assert.deepEqual(await store.read('stories', 'one'), { title: 'newer' });
  });

  it('applies the sequence guard to deletes, so a stale write cannot resurrect', async () => {
    const store = await freshStore();
    await store.write('stories', 'one', { title: 'here' }, 10);
    await store.remove('stories', 'one', 20);
    await store.write('stories', 'one', { title: 'back from the dead' }, 15);
    assert.equal(await store.read('stories', 'one'), null);
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
    assert.deepEqual(await store.read('stories', 'one'), { title: 'fine' });
  });

  it('removes a document, and does not mind removing it twice', async () => {
    const store = await freshStore();
    await store.write('stories', 'one', { id: 'one' });
    await store.remove('stories', 'one');
    await store.remove('stories', 'one');
    assert.equal(await store.read('stories', 'one'), null);
  });

  it('indexes a collection by id and freshness', async () => {
    const store = await freshStore();
    await store.write('chapters', 'a', { id: 'a', updatedAt: '2026-01-02T00:00:00.000Z' });
    await store.write('chapters', 'b', { id: 'b', updatedAt: '2026-01-03T00:00:00.000Z' });
    const index = await store.index('chapters');
    assert.deepEqual(index.map((entry) => entry.id).sort(), ['a', 'b']);
    assert.ok(index.every((entry) => typeof entry.updatedAt === 'string'));
  });
});

after(() => {
  // The temporary folders are the OS's problem; nothing here holds handles.
});
