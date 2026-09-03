import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtemp, mkdir, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, it } from 'node:test';
import { inflateRawSync } from 'node:zlib';
import { backupOnStartup } from '../src/backup.js';
import { collectEntries, writeZip } from '../src/zip.js';

const EOCD = 0x06054b50;
const CENTRAL = 0x02014b50;

/**
 * Reads an archive back the hard way — by walking its central directory — so
 * the test does not merely agree with the writer about a format it invented.
 */
function readZip(buffer) {
  let end = buffer.length - 22;
  while (end >= 0 && buffer.readUInt32LE(end) !== EOCD) end--;
  assert.ok(end >= 0, 'no end-of-central-directory record');

  const count = buffer.readUInt16LE(end + 10);
  let at = buffer.readUInt32LE(end + 16);
  const entries = new Map();
  for (let i = 0; i < count; i++) {
    assert.equal(buffer.readUInt32LE(at), CENTRAL);
    const method = buffer.readUInt16LE(at + 10);
    const compressed = buffer.readUInt32LE(at + 20);
    const uncompressed = buffer.readUInt32LE(at + 24);
    const nameLength = buffer.readUInt16LE(at + 28);
    const extraLength = buffer.readUInt16LE(at + 30);
    const commentLength = buffer.readUInt16LE(at + 32);
    const external = buffer.readUInt32LE(at + 38);
    const offset = buffer.readUInt32LE(at + 42);
    const name = buffer.toString('utf8', at + 46, at + 46 + nameLength);

    // The local header's own name and extra lengths say where the bytes start.
    const localNameLength = buffer.readUInt16LE(offset + 26);
    const localExtraLength = buffer.readUInt16LE(offset + 28);
    const start = offset + 30 + localNameLength + localExtraLength;
    const raw = buffer.subarray(start, start + compressed);
    const data = method === 0 ? raw : inflateRawSync(raw);
    assert.equal(data.length, uncompressed);

    entries.set(name, { data, mode: (external >>> 16) & 0o7777 });
    at += 46 + nameLength + extraLength + commentLength;
  }
  return entries;
}

describe('writeZip', () => {
  it('writes an archive whose entries read back byte for byte', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'lamplit-zip-'));
    const target = join(dir, 'out.zip');
    const prose = Buffer.from('The lantern room. '.repeat(200), 'utf8');
    await writeZip(target, [
      { name: 'folder/' },
      { name: 'folder/small.txt', data: Buffer.from('hi', 'utf8') },
      { name: 'folder/long.txt', data: prose },
      { name: 'start.sh', data: Buffer.from('#!/bin/sh\n', 'utf8'), mode: 0o755 },
    ]);

    const entries = readZip(await readFile(target));
    assert.deepEqual([...entries.keys()].sort(), [
      'folder/',
      'folder/long.txt',
      'folder/small.txt',
      'start.sh',
    ]);
    assert.equal(entries.get('folder/small.txt').data.toString(), 'hi');
    assert.deepEqual(entries.get('folder/long.txt').data, prose);
    assert.equal(entries.get('start.sh').mode, 0o755);
    assert.equal(entries.get('folder/small.txt').mode, 0o644);
  });

  it('is readable by whatever unzips archives on this machine', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'lamplit-zip-'));
    const target = join(dir, 'out.zip');
    await writeZip(target, [{ name: 'note.txt', data: Buffer.from('lantern', 'utf8') }]);

    const extracted = join(dir, 'out');
    const result =
      process.platform === 'win32'
        ? spawnSync(
            'powershell.exe',
            [
              '-NoProfile',
              '-Command',
              `Expand-Archive -Path '${target}' -DestinationPath '${extracted}'`,
            ],
            { encoding: 'utf8' },
          )
        : spawnSync('unzip', ['-q', target, '-d', extracted], { encoding: 'utf8' });
    if (result.error) return; // no unzip on this machine: the reader above stands
    assert.equal(result.status, 0, result.stderr);
    assert.equal(await readFile(join(extracted, 'note.txt'), 'utf8'), 'lantern');
  });
});

describe('collectEntries', () => {
  it('walks a folder into archive entries under a prefix', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'lamplit-walk-'));
    await mkdir(join(dir, 'stories'), { recursive: true });
    await writeFile(join(dir, 'settings.json'), '{}', 'utf8');
    await writeFile(join(dir, 'stories', 'abc.json'), '{"id":"abc"}', 'utf8');

    const entries = await collectEntries(dir, 'data');
    assert.deepEqual(
      entries.map((entry) => entry.name),
      ['data/settings.json', 'data/stories/', 'data/stories/abc.json'],
    );
  });
});

describe('backupOnStartup', () => {
  it('zips the data folder once a day and skips an empty one', async () => {
    const root = await mkdtemp(join(tmpdir(), 'lamplit-backup-'));
    const dataDir = join(root, 'data');
    const backupsDir = join(root, 'backups');
    await mkdir(dataDir, { recursive: true });

    assert.equal(await backupOnStartup(dataDir, backupsDir), null, 'nothing to back up yet');

    await writeFile(join(dataDir, 'settings.json'), '{"activeStoryId":"abc"}', 'utf8');
    const made = await backupOnStartup(dataDir, backupsDir);
    assert.ok(made?.endsWith('.zip'));

    const entries = readZip(await readFile(made));
    assert.equal(entries.get('data/settings.json').data.toString(), '{"activeStoryId":"abc"}');

    assert.equal(await backupOnStartup(dataDir, backupsDir), null, 'already taken today');
  });
});
