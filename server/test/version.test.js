import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, it } from 'node:test';
import { RUN_FILE, STAMP_FILE, buildStamp, readBuildInfo, recordRun } from '../src/version.js';

async function emptyDir(prefix) {
  return mkdtemp(join(tmpdir(), `lamplit-${prefix}-`));
}

/** A staged copy: a public folder with the stamp the packaging writes into it. */
async function staged(stamp) {
  const root = await emptyDir('stamp');
  const publicDir = join(root, 'public');
  await mkdir(publicDir, { recursive: true });
  await writeFile(join(publicDir, STAMP_FILE), JSON.stringify(stamp), 'utf8');
  return { root, publicDir };
}

describe('readBuildInfo', () => {
  it('reads the stamp next to the built app', async () => {
    const { root, publicDir } = await staged({
      version: '1.2.3',
      commit: 'a1b2c3d',
      builtAt: '2026-09-04T10:00:00.000Z',
      build: '42',
    });

    assert.deepEqual(readBuildInfo({ root, publicDir }), {
      version: '1.2.3',
      commit: 'a1b2c3d',
      builtAt: '2026-09-04T10:00:00.000Z',
      build: '42',
      // The one field the file does not carry: the zip and the installers are
      // the same folder, so only whoever started the server can say which.
      channel: 'zip',
    });
  });

  it('lets the caller say which channel it is, for the desktop shell', async () => {
    const { root, publicDir } = await staged({ version: '1.2.3' });
    const info = readBuildInfo({ root, publicDir, channel: 'desktop' });
    assert.equal(info.channel, 'desktop');
    assert.equal(info.build, 'local', 'a stamp without a build number is a local one');
  });

  it('falls back to package.json and calls itself a dev build', async () => {
    const root = await emptyDir('dev');
    await writeFile(join(root, 'package.json'), JSON.stringify({ version: '4.5.6' }), 'utf8');

    const info = readBuildInfo({ root, publicDir: join(root, 'public') });
    assert.equal(info.version, '4.5.6');
    assert.equal(info.build, 'local');
    assert.equal(info.channel, 'dev');
    assert.equal(info.commit, '', 'no .git next to it, so nothing to ask');
  });

  it('reads the version out of server/package.json when the root has none', async () => {
    const root = await emptyDir('server-version');
    await mkdir(join(root, 'server'), { recursive: true });
    await writeFile(
      join(root, 'server', 'package.json'),
      JSON.stringify({ version: '7.8.9' }),
      'utf8',
    );
    assert.equal(readBuildInfo({ root }).version, '7.8.9');
  });

  it('says 0.0.0 rather than throwing when there is nothing to read', async () => {
    assert.equal(readBuildInfo({ root: await emptyDir('nothing') }).version, '0.0.0');
    assert.equal(readBuildInfo().version, '0.0.0');
  });
});

describe('buildStamp', () => {
  it('stamps the version it was given, when it was made, and by which run', async () => {
    const root = await emptyDir('build-stamp');
    process.env['GITHUB_RUN_NUMBER'] = '99';
    try {
      const stamp = buildStamp({ version: '2.0.0', root });
      assert.equal(stamp.version, '2.0.0');
      assert.equal(stamp.build, '99');
      assert.ok(Date.parse(stamp.builtAt) > 0, 'builtAt is a date');
    } finally {
      delete process.env['GITHUB_RUN_NUMBER'];
    }
    assert.equal(buildStamp({ version: '2.0.0', root }).build, 'local');
  });
});

describe('recordRun', () => {
  it('writes down what is running, and reports no upgrade on a first run', async () => {
    const dataDir = join(await emptyDir('run'), 'data');

    const first = await recordRun(dataDir, '1.0.0');
    assert.deepEqual(first, { previousVersion: null, upgraded: false });

    const written = JSON.parse(await readFile(join(dataDir, RUN_FILE), 'utf8'));
    assert.equal(written.version, '1.0.0');
    assert.equal(written.previousVersion, null);
  });

  it('reports the version that wrote the folder, once it differs', async () => {
    const dataDir = await emptyDir('upgrade');
    await recordRun(dataDir, '1.0.0');

    const second = await recordRun(dataDir, '2.0.0');
    assert.deepEqual(second, { previousVersion: '1.0.0', upgraded: true });
  });

  it('keeps reporting it across restarts, so an unacknowledged upgrade is not lost', async () => {
    const dataDir = await emptyDir('restart');
    await recordRun(dataDir, '1.0.0');
    await recordRun(dataDir, '2.0.0');

    const restart = await recordRun(dataDir, '2.0.0');
    assert.equal(restart.previousVersion, '1.0.0');
    assert.equal(restart.upgraded, false, 'nothing changed this time');
  });

  it('replaces it with the version actually left behind on the next upgrade', async () => {
    const dataDir = await emptyDir('twice');
    await recordRun(dataDir, '1.0.0');
    await recordRun(dataDir, '2.0.0');

    const third = await recordRun(dataDir, '3.0.0');
    assert.deepEqual(third, { previousVersion: '2.0.0', upgraded: true });
  });

  it('treats an unreadable record as a first run rather than failing to start', async () => {
    const dataDir = await emptyDir('corrupt');
    await writeFile(join(dataDir, RUN_FILE), 'not json at all', 'utf8');

    assert.deepEqual(await recordRun(dataDir, '1.0.0'), {
      previousVersion: null,
      upgraded: false,
    });
  });
});
