import { once } from 'node:events';
import { createWriteStream } from 'node:fs';
import { readdir, readFile } from 'node:fs/promises';
import { finished } from 'node:stream/promises';
import { join, posix, sep } from 'node:path';
import { crc32, deflateRawSync } from 'node:zlib';

/**
 * A zip writer in a hundred lines, so that neither the backup on startup nor
 * the packaging script needs a dependency. Deflate, no zip64: a folder of JSON
 * documents and a built Angular app are nowhere near four gigabytes.
 */

const LOCAL_HEADER = 0x04034b50;
const CENTRAL_HEADER = 0x02014b50;
/** The last four bytes but eighteen of every archive this writes. */
export const END_OF_CENTRAL = 0x06054b50;
/** Bit 11 says the name is UTF-8, which every name we write is. */
const UTF8_FLAG = 0x0800;
const DEFLATE = 8;
const STORE = 0;

/** Already-compressed bytes only grow, so those entries go in as they are. */
const INCOMPRESSIBLE = /\.(zip|gz|br|png|jpe?g|webp|woff2?|ico|mp4|pdf)$/i;

/**
 * @typedef {object} ZipEntry
 * @property {string} name    path inside the archive, `/`-separated
 * @property {Buffer} data
 * @property {number} [mode]  unix permissions; 0o755 makes start.sh runnable
 * @property {Date}   [date]
 */

/** Writes `entries` to `target`. Returns the archive's size in bytes. */
export async function writeZip(target, entries) {
  const out = createWriteStream(target);
  const central = [];
  let offset = 0;

  // A folder that is not there or a disk that is full arrives as an event, and
  // an event nobody listens for takes the process down. Remembered here, so the
  // next write throws it; `once` throws it too if it lands while waiting.
  let failed = null;
  out.on('error', (error) => (failed = error));

  const put = async (buffer) => {
    if (failed) throw failed;
    if (!out.write(buffer)) await once(out, 'drain');
    offset += buffer.length;
  };

  for (const entry of entries) {
    const name = Buffer.from(entry.name, 'utf8');
    const raw = entry.data ?? Buffer.alloc(0);
    const isDirectory = entry.name.endsWith('/');
    const store = isDirectory || raw.length < 64 || INCOMPRESSIBLE.test(entry.name);
    const body = store ? raw : deflateRawSync(raw, { level: 9 });
    const method = store ? STORE : DEFLATE;
    const { time, date } = dosStamp(entry.date ?? new Date());
    const sum = raw.length ? crc32(raw) : 0;
    const start = offset;

    const local = Buffer.alloc(30);
    local.writeUInt32LE(LOCAL_HEADER, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(UTF8_FLAG, 6);
    local.writeUInt16LE(method, 8);
    local.writeUInt16LE(time, 10);
    local.writeUInt16LE(date, 12);
    local.writeUInt32LE(sum, 14);
    local.writeUInt32LE(body.length, 18);
    local.writeUInt32LE(raw.length, 22);
    local.writeUInt16LE(name.length, 26);
    await put(local);
    await put(name);
    if (body.length) await put(body);

    const head = Buffer.alloc(46);
    head.writeUInt32LE(CENTRAL_HEADER, 0);
    // High byte 3 = made on unix, so the mode below is read as permissions.
    head.writeUInt16LE(0x031e, 4);
    head.writeUInt16LE(20, 6);
    head.writeUInt16LE(UTF8_FLAG, 8);
    head.writeUInt16LE(method, 10);
    head.writeUInt16LE(time, 12);
    head.writeUInt16LE(date, 14);
    head.writeUInt32LE(sum, 16);
    head.writeUInt32LE(body.length, 20);
    head.writeUInt32LE(raw.length, 24);
    head.writeUInt16LE(name.length, 28);
    head.writeUInt32LE(externalAttributes(isDirectory, entry.mode), 38);
    head.writeUInt32LE(start, 42);
    central.push(Buffer.concat([head, name]));
  }

  const directory = Buffer.concat(central);
  const directoryOffset = offset;
  await put(directory);

  const end = Buffer.alloc(22);
  end.writeUInt32LE(END_OF_CENTRAL, 0);
  end.writeUInt16LE(central.length, 8);
  end.writeUInt16LE(central.length, 10);
  end.writeUInt32LE(directory.length, 12);
  end.writeUInt32LE(directoryOffset, 16);
  await put(end);

  out.end();
  // Resolves on finish, rejects on an error that has already happened or is
  // still to come; the callback form of `end` would have called back with the
  // error and been mistaken for success.
  await finished(out);
  return offset;
}

/** Every file under `dir`, ready for {@link writeZip}, `prefix/` deep. */
export async function collectEntries(dir, prefix = '', { mode } = {}) {
  const entries = [];
  const walk = async (current, at) => {
    const listing = await readdir(current, { withFileTypes: true });
    for (const item of listing.sort((a, b) => a.name.localeCompare(b.name))) {
      const full = join(current, item.name);
      const name = at ? posix.join(at, item.name) : item.name;
      if (item.isDirectory()) {
        entries.push({ name: `${name}/` });
        await walk(full, name);
      } else if (item.isFile()) {
        entries.push({ name, data: await readFile(full), mode: mode?.(name) });
      }
    }
  };
  await walk(dir, prefix.replaceAll(sep, '/').replace(/\/$/, ''));
  return entries;
}

function externalAttributes(isDirectory, mode) {
  if (isDirectory) return (((0o40000 | 0o755) << 16) >>> 0) | 0x10;
  return ((0o100000 | (mode ?? 0o644)) << 16) >>> 0;
}

/** MS-DOS packed date and time: two seconds of resolution, from 1980. */
function dosStamp(when) {
  const year = Math.max(1980, when.getFullYear());
  return {
    date: ((year - 1980) << 9) | ((when.getMonth() + 1) << 5) | when.getDate(),
    time: (when.getHours() << 11) | (when.getMinutes() << 5) | (when.getSeconds() >> 1),
  };
}
