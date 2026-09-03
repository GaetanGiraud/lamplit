# MagicStories

A single-page, chat-centred, text-only storytelling app. The browser talks straight to any
OpenAI-compatible endpoint — no backend in the way, no proxy, no SDK. A small local server holds
the stories as plain JSON files and serves the app; it never sees the model.

`PLAN.md` is the plan of record. This README covers running what exists.

## What works today (steps 1, 2 and 3)

- Streaming chat against any OpenAI-compatible `/chat/completions`, parsed as SSE.
- Connection modal: NanoGPT or a hand-typed URL, API key, model list (grouped, filterable),
  and a Test button that does one real round trip. **A fresh install opens on it** — there is no
  point writing a scene for a model the app cannot reach — and it insists: no Escape, no
  backdrop, and Done stays dark until there is an endpoint and a model. There is still a
  "Not now" for the stubborn case, and the composer stays shut and says why. Once a connection is
  stored the question never comes up again, so this is a first-run screen and nothing more.
- Parameters modal: the OpenAI sampling set plus the advanced ones NanoGPT accepts
  (`top_k`, `min_p`, `repetition_penalty`, `top_a`, `reasoning_effort`), each sent only once set.
- Book-style reading: markdown, speech in quotes set apart, `*actions*` in italics, and (via
  **Reading → Dialogue on its own line**) each spoken line broken onto its own line. That switch
  only has visible work to do when a model runs narration and dialogue together in one paragraph;
  models that already break their own lines look the same either way.
- Per-message edit, regenerate, replay-from-here, delete and copy; Stop mid-stream keeps the
  partial answer.
- **Chapters.** A story is a sequence of them, and each one opens on a scene: one plain-text
  field, written however you like, the way a scene opens in a playscript. A chapter cannot be
  written into until its scene is written — the one compulsory step in the app, and any non-empty
  text passes. The scene goes to the model verbatim, and can be edited at any time.
- **Close chapter** rewrites the story so far to include the chapter just finished — the model is
  handed the summary as it stands and asked for the whole thing back, so it stays one readable
  page instead of growing with every chapter. You edit what comes back before it lands, and the
  instruction behind it is editable per story (World → How a chapter is folded in, or from the
  review sheet). Then the next chapter's sheet opens, pre-filled with the scene just closed. **New chapter**
  is the same act from the other end: starting the next one closes the one being written, so a
  story always carries forward as summary rather than as transcript. A chapter with nothing in it
  just opens. Nothing is
  discarded: closed chapters stay in the Chapters list, readable, and can be continued.
  Chapter numbers are permanent — chapter 3 stays chapter 3 after chapter 2 is deleted.
- **Story modal**: Narrator or Role-play (with a cast), the persona you play, and style rules.
- **World modal**: the story so far (always sent) and keyword-activated lore, grouped by kind,
  with scan settings. Entries collapse to a single line — title, keys, state — so a world can hold
  dozens and still be read; "What is true" is required, and an entry without it is flagged rather
  than quietly skipped, since an entry is the sentence it contributes.
- **What the model sees**: the assembled prompt block by block, with each block's token cost and
  which lore entries fired on which key.
- Several stories, each self-contained: new, switch, rename, duplicate, delete.
- **Everything auto-saves to disk**, one JSON file per document: `data/settings.json`,
  `data/stories/<id>.json`, `data/chapters/<id>.json`. What the app shows is what the file says;
  copy the `data` folder and you have copied everything. A zip of it is taken into `backups/`
  once a day when the server starts.
- The saving is invisible until it is not. Writes are debounced and coalesced per document, and
  the browser keeps its own copy so a reload paints instantly. If the server goes away, an
  **Offline** button appears in the top bar, writing carries on, and everything queued — a reload
  included — is sent when it comes back.
- With no server behind `/api` at all, the app runs on `localStorage` exactly as it did in step 2.
  A step-1 conversation is migrated into Chapter 1 of a new story on first load.

## Requirements

Node 20.19+, 22.12+ or 24+ (Angular 21). Install through your configured npm registry.

Packages come from the corporate CodeArtifact registry, whose token expires. When `npm install`
answers `E401`, refresh it and try again:

```bash
npm run aws-login
```

## Running

```bash
npm install
npm start
```

`npm start` runs both halves: the persistence server on <http://localhost:4177> and the Angular
dev server on <http://localhost:4200>, which proxies `/api` to it. Open 4200 and the scene sheet
for Chapter 1 is waiting: say where we are and what is happening, confirm, then click
**Connect a model**, paste your key, fetch the model list, pick one, and write the first line.

`npm run start:app` runs the app on its own, with no backend, on `localStorage` alone.
`npm run server` runs the server on its own; if the app has been built, it serves that too.

## Building a copy you can run anywhere

```bash
npm run package
```

That builds the app and writes `build/magicstories-<version>.zip` — around a megabyte, with the
built app, the server, and the server's production dependencies inside. Unzip it wherever you
like and start it with one call:

| Where            | Call         |
| ---------------- | ------------ |
| Windows          | `start.bat`  |
| Linux, macOS     | `./start.sh` |

It serves the app on <http://127.0.0.1:4177>, opens your browser at it, and writes `data/` next
to itself. Node 20.19+ is the only thing that has to be on the machine already — there is nothing
to install and no build step at the far end. Move the folder and the stories move with it.

`--port 5000` and `--data D:\stories` are accepted by both scripts; `MS_OPEN=0` skips the browser
and `MS_BACKUP=0` skips the daily backup. `npm run package -- --no-build` reuses the last build.

This is the shape Electron will wrap later: the same server, the same folders, a window instead
of a browser tab. Nothing in it assumes Electron yet.

## Tests

```bash
npm test
```

Unit tests: vitest for the app (the SSE reader, the request builder, error mapping, token
estimates, the story formatter, the prompt builder, and the sync layer — coalescing, sequence
numbers, offline queueing, and which side wins at startup), `node --test` for the server (the
document store's write ordering and atomic writes, the API, the zip writer, the daily backup).

```bash
npm run e2e
```

Playwright drives the real app against `e2e/fake-openai-server.mjs`, a deterministic stand-in for
an OpenAI-compatible endpoint. Both servers start automatically. No tokens are spent and no key is
needed. The fake endpoint takes instructions from the message text: `!slow`, `!long`, `!error`,
`!401`, `!prose`.

Most specs run against the dev server with no backend. `persistence.spec.ts` runs against the
real server serving the real production build, on its own port and its own empty data folder per
test, and asserts against the files on disk — which is why `npm run e2e` builds the app first.
`npm run e2e:quick` skips the build, and skips those specs if there is nothing built to serve.

## Keyboard

| Key            | Does                                        |
| -------------- | ------------------------------------------- |
| Enter          | send                                        |
| Shift+Enter    | newline                                     |
| Ctrl/Cmd+Enter | regenerate the last answer                  |
| Ctrl/Cmd+K     | open Connection                             |
| Escape         | close a modal (everything is already saved) |

## Layout

```
app/      Angular 21 workspace (standalone components, signals, zoneless)
  core/     model client, SSE reader, errors, token estimates, story formatting, prompt builder
  store/    signal stores, the storage backend they write through, and the sync layer behind it
  features/ chapters (page, scene sheet, chapters list, close chapter, prompt preview),
            connection, generation, story, world
  shared/   top bar, save indicator, dialog openers, editor field, shared controls
server/   Express 5, JSON documents on disk, the built app in front of them, a zip writer
tools/    dev.mjs (both halves at once), package.mjs (the zip)
e2e/      Playwright specs + the fake endpoint
```

## A note on the API key

The key is stored in plain text, in `data/settings.json` on your own machine (and in the
browser's `localStorage` as a cache). That is deliberate: MagicStories is a single-user tool on
your own machine, and a local file you control beats a secret store you have to unlock every time.
The server listens on `127.0.0.1` only, so nothing else on your network can reach it. Do not run
it on a shared machine or serve it to a network you do not trust.
