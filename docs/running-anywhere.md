# Running it anywhere

[← Documentation](README.md) · Previous: [The desktop app](desktop.md) · Next: [Development](development.md)

---

The repo is for working on MagicStories. To *use* it — on this machine, on a laptop, on a machine
that has never seen npm — build the package.

```bash
npm run package
```

That builds the app and writes two things into `build/`:

```
build/
  magicstories-0.1.0/          the folder, ready to run
  magicstories-0.1.0.zip       the same folder, ~1 MB
```

## What is in it

```
magicstories-0.1.0/
  start.bat          Windows: double-click it
  start.sh           Linux, macOS: ./start.sh
  server/            the persistence server
  public/            the built app, served by it
  node_modules/      the server's production dependencies, and only those
  package.json
  README.txt
  data/              created on first run, beside the script
```

The server's dependencies travel inside, resolved from the tree that was actually tested rather
than fetched again at the far end. **Node.js 20.19+ is the only thing that has to be on the
machine already.** There is nothing to install and nothing to build.

## Running it

Unzip it anywhere you like and make one call:

| Where | Call |
|---|---|
| Windows | `start.bat` (double-click, or `.\start.bat` in a terminal) |
| Linux, macOS | `./start.sh` |

It starts the server, opens <http://127.0.0.1:4177> in your browser, and creates `data/` beside
itself. Close the window or press **Ctrl+C** to stop it.

If port 4177 is busy it takes the next free one and says so.

## Options

Both scripts pass their arguments straight through:

```bash
./start.sh --port 5000              # listen somewhere else
./start.sh --data ~/stories         # keep the documents somewhere else
```

```
start.bat --port 5000
start.bat --data D:\stories
```

And by environment variable:

| | |
|---|---|
| `MS_PORT`, `MS_DATA_DIR` | the same two, as variables |
| `MS_OPEN=0` | do not open a browser |
| `MS_BACKUP=0` | skip the daily backup |
| `MS_BACKUP_DIR` | put backups somewhere else |
| `MS_HOST` | bind somewhere other than `127.0.0.1` — think before you do |

## Moving it

The folder is self-contained and writes nothing outside itself. Copy it to a USB stick, a NAS, a
second machine; the stories go with it. Nothing is registered with the operating system and
nothing is left behind if you delete it.

## Rebuilding

```bash
npm run package -- --no-build     # reuse the last Angular build
npm run package -- --out dist     # write somewhere other than build/
```

## The zip, or the desktop app?

[The desktop app](desktop.md) wraps exactly this folder — the same server, the same built app, the
same dependencies — and adds Node.js and a window. Take it if you want one file and one icon.

Take the zip when the machine already has Node and you would rather have a megabyte than a hundred
of them, when you want the stories in a folder you chose rather than in a profile, or when you are
putting it somewhere that has no desktop to speak of. Both read and write the same files, so
nothing stops you from using each where it suits.
