# Development

[← Documentation](README.md) · Previous: [Running it anywhere](running-anywhere.md)

---

## Layout

```
app/        Angular 21 workspace — standalone components, signals, zoneless
  core/       model client, SSE reader, error mapping, token estimates,
              story formatting, the prompt builder
  store/      signal stores (one per document type), and the persistence layer
              they write through: the session's documents, and the server
  features/   chapters (page, message list, composer, scene sheet, chapters
              list, close chapter, prompt preview), connection, generation,
              story, world
  shared/     top bar, save indicator, dialog openers, editor field, controls
server/     Express 5 — JSON documents on disk, the built app in front of them,
            a dependency-free zip writer
electron/   the desktop shell: main process, preload, electron-builder config.
            It starts the same server in-process and opens one window at it,
            and knows nothing else about the app
tools/      dev.mjs (both halves at once), package.mjs (the runnable zip),
            desktop.mjs (the window, and the installers), smoke.mjs (a fresh
            install to walk by hand), screenshots.mjs (every picture in docs/),
            icons.mjs (the raster icons), probe-providers.mjs (the CORS table)
e2e/        Playwright specs + a fake OpenAI endpoint
docs/       these pages, and — served by GitHub Pages — the website
.github/    release.yml: builds installers on a tag and publishes them
```

`PLAN.md` at the root is the plan of record: four steps, what each one had to do, and — more
usefully — why each decision went the way it did.

## Scripts

| | |
|---|---|
| `npm start` | Both halves: persistence server on 4177, dev server on 4200 proxying `/api` to it |
| `npm run server` | Just the server (and the built app, if there is one). The front end has no standalone mode: it reads its documents from the server or does not start |
| `npm run build` | Angular production build into `app/dist` |
| `npm run package` | The runnable zip — see [Running it anywhere](running-anywhere.md) |
| `npm test` | Unit tests, both workspaces |
| `npm run e2e` | Builds the app, then the full Playwright suite |
| `npm run e2e:quick` | Playwright without the build (skips the specs that need it) |
| `npm run smoke` | Packages, unzips the archive into an empty folder, and starts it — a genuinely fresh install to walk by hand |
| `npm run screenshots` | Regenerates every picture in `docs/images` |
| `npm run icons` | Regenerates favicon.ico and apple-touch-icon.png from `app/public/favicon.svg` |
| `npm run providers` | Asks every provider in the list whether it still lets a browser call it, and prints the table for [Models and parameters](models-and-parameters.md). Not in CI: it talks to twenty companies |
| `npm run electron` | Downloads Electron's binary. Runs on `postinstall`, so normally you never call it — Electron 44 ships no install script of its own, and `npm ci` alone leaves you with the JavaScript and no executable |
| `npm run desktop` | Opens the Electron window against the repository — no packaging, so a change to the app needs `npm run build` and a reload |
| `npm run desktop:stage` | Stages the folder the installers wrap (`build/desktop-stage`), and stops |
| `npm run desktop:dist` | Stages, then builds installers for the OS you are on, into `build/desktop` |
| `npm run check:docs` | Every link in `docs/` resolves, and will survive being turned into a website. Offline, and in the release workflow |
| `npm run format` | Prettier over everything |

## Tests

**Unit — `npm test`.** Vitest for the app: the SSE reader, the request builder, error mapping,
token estimates, the story formatter, the prompt builder (block order, the scene verbatim, lore
scanning, budget trimming, chapter titles, the summary request), and the persistence layer (the
startup load, coalescing, sequence numbers, offline queueing, and refusing to start without a
server). `node --test` for the server: the document store's write ordering and atomic writes, the
API, the zip writer, the daily backup.

**End to end — `npm run e2e`.** Playwright drives the real app against
`e2e/fake-openai-server.mjs`, a deterministic stand-in for an OpenAI-compatible endpoint. Both
servers start automatically; no tokens are spent and no key is needed. The fake endpoint takes
instructions from the message text: `!slow`, `!long`, `!error`, `!401`, `!prose`.

**Every** spec runs against the real server serving the real production build, on its own port
with its own empty data folder — the `server` fixture in `specs/fixtures.ts`. There is no dev
server in the suite and no browser-storage mode to fall back on, so a spec seeds by writing JSON
into that folder, which is exactly what a person does when they copy a story onto a new machine.
Each test is isolated by construction: nothing carries over, because there is nowhere for it to
carry over in. That is why `npm run e2e` builds first; `npm run e2e:quick` skips the build, and
skips everything if there is nothing built.

- **`persistence.spec.ts`** — the disk as the story: documents written as the UI changes them, a
  reload coming back to what is on disk rather than to what was there before, a second browser
  seeing the same story, the server going away mid-chat and catching up, two tabs, deleting a
  story taking its files with it, and the app refusing to start when the documents cannot be
  read.
- **`journey.spec.ts`** — the whole app, once, in narrator mode, from nothing. Eleven stages in
  order, sharing one page, walked through the interface the way a person would: the connection
  sheet insisting, the story questions, the scene refusing whitespace, the first turn's prompt in
  the right order, the story so far, lore staying out until the story mentions it, closing a
  chapter, chapter 2 carrying the summary and not the transcript, and an empty browser reading the
  lot back. It is the regression net for the shape of the app rather than for any one feature.

The human half of the same walk is `npm run smoke` plus the script in `e2e/LIVE-TEST.md` — every
prompt written out, a table per stage with the expected result beside it, and a worksheet for the
one thing a fake model cannot check: whether a real one tells a decent story, and what it costs.

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
- **One place a document lives.** The server. The app reads every document once at startup into a
  map that lasts the session; writes go to that map and to the server. The stores stay synchronous
  and know about neither. It used to keep a `localStorage` copy as well, which bought a merge on
  every startup, a persisted write queue and a rule for which side wins — all of it gone, and
  `Persistence` says why in its header.
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
