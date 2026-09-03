# Development

[← Documentation](README.md) · Previous: [Running it anywhere](running-anywhere.md)

---

## Layout

```
app/        Angular 21 workspace — standalone components, signals, zoneless
  core/       model client, SSE reader, error mapping, token estimates,
              story formatting, the prompt builder
  store/      signal stores (one per document type), the storage backend they
              write through, and the sync layer behind it
  features/   chapters (page, message list, composer, scene sheet, chapters
              list, close chapter, prompt preview), connection, generation,
              story, world
  shared/     top bar, save indicator, dialog openers, editor field, controls
server/     Express 5 — JSON documents on disk, the built app in front of them,
            a dependency-free zip writer
tools/      dev.mjs (both halves at once), package.mjs (the runnable zip),
            smoke.mjs (a fresh install to walk by hand), screenshots.mjs
            (every picture in docs/), icons.mjs (the raster favicons)
e2e/        Playwright specs + a fake OpenAI endpoint
docs/       these pages
```

`PLAN.md` at the root is the plan of record: three steps, what each one had to do, and — more
usefully — why each decision went the way it did.

## Scripts

| | |
|---|---|
| `npm start` | Both halves: persistence server on 4177, dev server on 4200 proxying `/api` to it |
| `npm run start:app` | Just the front end, no backend, on browser storage alone |
| `npm run server` | Just the server (and the built app, if there is one) |
| `npm run build` | Angular production build into `app/dist` |
| `npm run package` | The runnable zip — see [Running it anywhere](running-anywhere.md) |
| `npm test` | Unit tests, both workspaces |
| `npm run e2e` | Builds the app, then the full Playwright suite |
| `npm run e2e:quick` | Playwright without the build (skips the specs that need it) |
| `npm run smoke` | Packages, unzips the archive into an empty folder, and starts it on an origin this machine has not used before — a genuinely fresh install to walk by hand |
| `npm run screenshots` | Regenerates every picture in `docs/images` |
| `npm run icons` | Regenerates favicon.ico and apple-touch-icon.png from `app/public/favicon.svg` |
| `npm run format` | Prettier over everything |

## Tests

**Unit — `npm test`.** Vitest for the app: the SSE reader, the request builder, error mapping,
token estimates, the story formatter, the prompt builder (block order, the scene verbatim, lore
scanning, budget trimming, chapter titles, the summary request), and the sync layer (coalescing,
sequence numbers, offline queueing, which side wins at startup). `node --test` for the server: the
document store's write ordering and atomic writes, the API, the zip writer, the daily backup.

**End to end — `npm run e2e`.** Playwright drives the real app against
`e2e/fake-openai-server.mjs`, a deterministic stand-in for an OpenAI-compatible endpoint. Both
servers start automatically; no tokens are spent and no key is needed. The fake endpoint takes
instructions from the message text: `!slow`, `!long`, `!error`, `!401`, `!prose`.

Most specs run against the dev server with no backend. Two are different, and both run against the
**real server serving the real production build**, on their own port with their own empty data
folder, asserting against the files on disk. That is why `npm run e2e` builds first —
`npm run e2e:quick` skips the build and skips those specs.

- **`persistence.spec.ts`** — the backend's own behaviour: documents written as the UI changes
  them, a fresh browser reading a story off disk, the server going away mid-chat and catching up,
  two tabs, deleting a story taking its files with it.
- **`journey.spec.ts`** — the whole app, once, in narrator mode, from nothing. Eleven stages in
  order, sharing one page, walked through the interface the way a person would: the connection
  sheet insisting, the story questions, the scene refusing whitespace, the first turn's prompt in
  the right order, the story so far, lore staying out until the story mentions it, closing a
  chapter, chapter 2 carrying the summary and not the transcript, and an empty browser reading the
  lot back. It is the regression net for the shape of the app rather than for any one feature.

The human half of the same walk is `npm run smoke` plus the script in `PLAN.md` §4.5 — the part a
fake model cannot check is whether a real one tells a decent story.

> `smoke` serves each run on a **port this machine has not used for one before**, and that is not
> fussiness. An empty `data/` folder is only half of a fresh install: the browser keeps its own
> copy of every document, and a browser holding documents that meets a server holding none uploads
> them — the deliberate "first run after this app grew a backend" path, asserted in
> `persistence.spec.ts`. Reuse the URL and the second run restores the first one's story into the
> "empty" install. Storage is keyed by origin, so a new port has nothing behind it; used ones are
> remembered in `build/.smoke-ports.json`.

## How the screenshots are made

`npm run screenshots` (`tools/screenshots.mjs`) starts the persistence server on the production
build, drives a real browser through the app, and writes what the app actually draws into
`docs/images`. Nothing in these pages is a mock-up.

The model behind it is a small stand-in inside the script that answers with the demo story's own
prose, so the pictures are identical every run and no tokens are spent taking them. Each phase
gets an empty data folder, because the server is the truth at startup.

Change the UI, re-run it, commit whatever moves.

## The shape of the code

A few things are worth knowing before reading it:

- **The whole prompt is rebuilt from the documents on every request.** There is no conversation
  object and no accumulated state. Edit, regenerate and replay are not special paths — they all go
  through the same builder as a fresh send. See [The prompt](the-prompt.md).
- **One store slice = one JSON file.** The stores are plain Angular services holding
  `signal()`/`computed()` state, one per document type. No NgRx: the persistence model maps onto a
  hand-rolled signal store 1:1 with no ceremony.
- **The stores stay synchronous.** They write through a `StorageBackend`; the localStorage
  implementation is the cache that makes a reload paint instantly, and the sync layer rides along
  behind it. Nothing above that line knows the server exists.
- **No SDK, no HTTP client, no state library.** `fetch`, a hand-written SSE parser, and
  `AbortController` for Stop.
- **Angular 21, zoneless.** Signals throughout, the new control flow, `inject()`, standalone
  components. Material is used for dialogs, menus, sliders, selects and tooltips; everything that
  has to look good — the chat itself — is hand-written.

## Conventions

- Prettier settings are in `.prettierrc`; `npm run format` before committing.
- The repo is LF everywhere (`.gitattributes`), including on Windows.
- Comments explain **why**, not what. If a comment restates the line under it, delete one of them.
- `data/`, `backups/`, `build/` and `dist/` are ignored, and should stay that way.
