import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, it } from 'node:test';
import { createApp } from '../src/app.js';
import { createUpdateChecker } from '../src/updates.js';

/** Starts the real app on a free port and hands back a `fetch` bound to it. */
async function serve({ withApp = false, updates } = {}) {
  const dataDir = await mkdtemp(join(tmpdir(), 'lamplit-api-'));
  let publicDir;
  if (withApp) {
    publicDir = join(dataDir, 'public');
    await mkdir(publicDir, { recursive: true });
    await writeFile(join(publicDir, 'index.html'), '<!doctype html><title>app</title>', 'utf8');
    await writeFile(join(publicDir, 'main.js'), 'console.log(1)', 'utf8');
  }
  const app = createApp({
    dataDir,
    publicDir,
    build: {
      version: '9.9.9',
      commit: 'abc1234',
      builtAt: '2026-09-04T00:00:00.000Z',
      build: '42',
      channel: 'zip',
    },
    previousVersion: '9.9.8',
    ...(updates ? { updates } : {}),
  });
  await app.locals.store.init();
  const server = await new Promise((fulfil) => {
    const instance = app.listen(0, '127.0.0.1', () => fulfil(instance));
  });
  const base = `http://127.0.0.1:${server.address().port}`;
  return {
    dataDir,
    close: () => new Promise((fulfil) => server.close(fulfil)),
    call: (path, init) => fetch(`${base}${path}`, init),
    put: (path, body, seq) =>
      fetch(`${base}${path}`, {
        method: 'PUT',
        headers: {
          'content-type': 'application/json',
          ...(seq === undefined ? {} : { 'x-doc-seq': String(seq) }),
        },
        body: JSON.stringify(body),
      }),
  };
}

describe('GET /api/health', () => {
  it('says who it is, which is how the client tells a server from a static host', async () => {
    const api = await serve();
    const response = await api.call('/api/health');
    const body = await response.json();
    assert.equal(response.status, 200);
    assert.equal(body.name, 'lamplit');
    assert.equal(body.version, '9.9.9');
    assert.equal(body.ok, true);
    await api.close();
  });

  it('carries the build stamp, which is what makes a bug report answerable', async () => {
    const api = await serve();
    const body = await (await api.call('/api/health')).json();
    assert.equal(body.commit, 'abc1234');
    assert.equal(body.builtAt, '2026-09-04T00:00:00.000Z');
    assert.equal(body.build, '42');
    assert.equal(body.channel, 'zip');
    assert.equal(body.previousVersion, '9.9.8');
    await api.close();
  });

  it('answers with defaults when nothing stamped the build', async () => {
    const dataDir = await mkdtemp(join(tmpdir(), 'lamplit-api-'));
    const app = createApp({ dataDir });
    const server = await new Promise((fulfil) => {
      const instance = app.listen(0, '127.0.0.1', () => fulfil(instance));
    });
    const body = await (await fetch(`http://127.0.0.1:${server.address().port}/api/health`)).json();
    assert.equal(body.version, '0.0.0');
    assert.equal(body.channel, 'dev');
    assert.equal(body.previousVersion, null);
    await new Promise((fulfil) => server.close(fulfil));
  });
});

describe('GET /api/updates', () => {
  /** GitHub, without GitHub: one release, and a count of who asked for it. */
  function fakeGithub() {
    const calls = [];
    return {
      calls,
      fetchImpl: async (url) => {
        calls.push(url);
        return Response.json([
          {
            tag_name: 'v9.9.10',
            name: 'Lamplit v9.9.10',
            published_at: '2026-10-01T00:00:00Z',
            body: 'A newer one.',
            html_url: 'https://example.invalid/v9.9.10',
            draft: false,
            prerelease: false,
            assets: [
              {
                name: 'Lamplit.zip',
                browser_download_url: 'https://example.invalid/Lamplit.zip',
                size: 10,
              },
            ],
          },
        ]);
      },
    };
  }

  it('hands the app what is newer than the build it is serving', async () => {
    const github = fakeGithub();
    const api = await serve({
      updates: createUpdateChecker({ version: '9.9.9', fetchImpl: github.fetchImpl }),
    });

    const body = await (await api.call('/api/updates')).json();

    assert.equal(body.ok, true);
    assert.equal(body.enabled, true);
    assert.equal(body.version, '9.9.9');
    assert.equal(body.newer.length, 1);
    assert.equal(body.newer[0].version, '9.9.10');
    assert.equal(body.newer[0].body, 'A newer one.');
    assert.equal(github.calls.length, 1);
    await api.close();
  });

  it('asks GitHub once, however many browser tabs are open', async () => {
    const github = fakeGithub();
    const api = await serve({
      updates: createUpdateChecker({ version: '9.9.9', fetchImpl: github.fetchImpl }),
    });

    await Promise.all([api.call('/api/updates'), api.call('/api/updates')]);
    await api.call('/api/updates');

    assert.equal(github.calls.length, 1);
    await api.close();
  });

  it('never asks GitHub when the check is switched off', async () => {
    const github = fakeGithub();
    const api = await serve({
      updates: createUpdateChecker({
        version: '9.9.9',
        enabled: false,
        fetchImpl: github.fetchImpl,
      }),
    });

    const body = await (await api.call('/api/updates')).json();

    assert.equal(github.calls.length, 0);
    assert.equal(body.enabled, false);
    assert.deepEqual(body.newer, []);
    await api.close();
  });

  it('is switched off by default, so a caller has to have meant it', async () => {
    const api = await serve();
    const body = await (await api.call('/api/updates')).json();
    assert.equal(body.enabled, false);
    await api.close();
  });
});

describe('/api/docs', () => {
  it('stores, lists, reads back and deletes a document', async () => {
    const api = await serve();
    const story = { id: 'abc', title: 'The Lighthouse', updatedAt: '2026-01-01T00:00:00.000Z' };

    const written = await api.put('/api/docs/stories/abc', story, 1);
    assert.deepEqual(await written.json(), { ok: true, seq: 1, skipped: false });

    assert.deepEqual(await (await api.call('/api/docs/stories')).json(), [story]);
    assert.deepEqual(await (await api.call('/api/docs/stories/abc')).json(), story);
    assert.deepEqual(await (await api.call('/api/docs/stories?index')).json(), [
      { id: 'abc', updatedAt: '2026-01-01T00:00:00.000Z' },
    ]);

    const removed = await api.call('/api/docs/stories/abc', { method: 'DELETE' });
    assert.equal(removed.status, 200);
    assert.equal((await api.call('/api/docs/stories/abc')).status, 404);
    await api.close();
  });

  it('holds the three collections apart', async () => {
    const api = await serve();
    await api.put('/api/docs/settings/settings', { activeStoryId: 'abc' });
    await api.put('/api/docs/stories/abc', { id: 'abc' });
    await api.put('/api/docs/chapters/one', { id: 'one', storyId: 'abc' });
    assert.equal((await (await api.call('/api/docs/settings')).json()).length, 1);
    assert.equal((await (await api.call('/api/docs/stories')).json()).length, 1);
    assert.equal((await (await api.call('/api/docs/chapters')).json()).length, 1);
    await api.close();
  });

  it('drops a write that arrives out of order', async () => {
    const api = await serve();
    await api.put('/api/docs/stories/abc', { title: 'newer' }, 200);
    const stale = await api.put('/api/docs/stories/abc', { title: 'older' }, 100);
    assert.deepEqual(await stale.json(), { ok: true, seq: 200, skipped: true });
    assert.deepEqual(await (await api.call('/api/docs/stories/abc')).json(), { title: 'newer' });
    await api.close();
  });

  it('refuses an unknown collection, a bad id and a path that climbs out', async () => {
    const api = await serve();
    assert.equal((await api.call('/api/docs/backups')).status, 404);
    assert.equal((await api.call('/api/docs/stories/..%2F..%2Fsettings')).status, 404);
    assert.equal((await api.put('/api/docs/settings/other', {})).status, 404);
    await api.close();
  });

  it('refuses a body that is not a JSON document', async () => {
    const api = await serve();
    const response = await api.put('/api/docs/stories/abc', 'just a string');
    assert.equal(response.status, 400);
    await api.close();
  });

  it('answers an unknown API path with JSON, never with the app', async () => {
    const api = await serve({ withApp: true });
    const response = await api.call('/api/nothing-here');
    assert.equal(response.status, 404);
    assert.match(response.headers.get('content-type'), /application\/json/);
    await api.close();
  });
});

describe('serving the built app', () => {
  it('serves files, and the app itself for any other path', async () => {
    const api = await serve({ withApp: true });
    assert.match(await (await api.call('/main.js')).text(), /console\.log/);
    assert.match(await (await api.call('/')).text(), /<title>app<\/title>/);
    // A single page: a deep link is still the app, not a 404.
    assert.match(await (await api.call('/some/deep/link')).text(), /<title>app<\/title>/);
    await api.close();
  });

  it('says so plainly when there is no build to serve', async () => {
    const api = await serve();
    const response = await api.call('/');
    assert.equal(response.status, 200);
    assert.match(await response.text(), /API is running/);
    await api.close();
  });
});

describe('CORS', () => {
  it('lets a localhost dev server through and nobody else', async () => {
    const api = await serve();
    const allowed = await api.call('/api/health', { headers: { origin: 'http://localhost:4200' } });
    assert.equal(allowed.headers.get('access-control-allow-origin'), 'http://localhost:4200');

    const refused = await api.call('/api/health', { headers: { origin: 'https://evil.example' } });
    assert.equal(refused.headers.get('access-control-allow-origin'), null);
    await api.close();
  });

  it('answers a preflight without reaching the routes', async () => {
    const api = await serve();
    const response = await api.call('/api/docs/stories/abc', {
      method: 'OPTIONS',
      headers: { origin: 'http://127.0.0.1:4200' },
    });
    assert.equal(response.status, 204);
    assert.match(response.headers.get('access-control-allow-methods'), /PUT/);
    await api.close();
  });
});
