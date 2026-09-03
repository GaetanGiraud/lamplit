# MagicStories — Implementation Plan

A single-page, text-only storytelling app (Narrator / Role-play) written in chapters, talking
directly from the browser to any OpenAI-compatible endpoint. SillyTavern is the functional
reference (`../SillyTavern`), consulted only for targeted checks. Written 2026-09-02, step 2
reworked around chapters and scenes 2026-09-02.

Guiding principles

- Ease of use over configurability. Few menus, each one obviously useful.
- Visual attractiveness. Reading a story should feel like reading a book.
- The page is never taken away. Everything else opens as a modal over it, and only two sheets are
  allowed to insist on an answer before writing can start: the connection, once, on a fresh
  install, and the scene of the chapter being opened.
- Everything is auto-saved. No "save" anxiety.
- The whole prompt is rebuilt from data on every request. No hidden state.

---

## 0. Prerequisites and environment facts

| Item | Finding | Action |
|---|---|---|
| Node | v22.14.0, npm 10.9.2 | Below Angular 22's minimum (`^22.22.3`); fine for Angular 21 (`^22.12.0`). Angular 21 chosen 2026-09-02 rather than upgrading Node. |
| npm registry | `~/.npmrc` points at a corporate AWS CodeArtifact registry (proxying npmjs). Token refreshed 2026-09-02, `npm view` works. | Always install through the configured registry. Never add a project `.npmrc` or `--registry` flag to bypass it. If the token expires again (E401), Gaetan refreshes it. **The committed lockfile pins `registry.npmjs.org` URLs** so a clone works anywhere and the proxy's host is not published (added 2026-09-03, before the repo went public); if an install rewrites them back to the proxy, put them back before committing — the integrity hashes are unaffected either way. |
| Angular | 22.1.x is current on npm, but CLI 22 refuses Node v22.14.0. 21.2.9 (core + CLI + Material) runs on it and has standalone, signals, zoneless and the new control flow. | Use 21.2.9. |
| NanoGPT CORS | `https://nano-gpt.com/api/v1` answers preflight with `Access-Control-Allow-Origin: *` and allows `Authorization`. | Direct browser calls work. No proxy needed. |
| NanoGPT model list | `GET /api/v1/models` returns the standard OpenAI `{object:"list", data:[{id, owned_by, created}]}`. `?detailed=true` adds names and capabilities. Works without a key. | Use `?detailed=true` when the URL is NanoGPT, fall back to plain `/models` for hand-typed URLs. |
| NanoGPT extra sampling | Accepts `top_k`, `min_p`, `repetition_penalty`, `top_a` beyond the OpenAI set (ST `public/scripts/openai.js:2958`). | Expose as "advanced" parameters, sent only when set. |
| API keys | I am not allowed to type API keys into any field. | During every live E2E test, Gaetan pastes the key. |

---

## 1. Architecture

### 1.1 Stack (decisions)

| Concern | Choice | Why |
|---|---|---|
| Framework | Angular 21.2.9, standalone components, signals, zoneless change detection, new control flow, `inject()` | Current best practice; fine-grained updates suit token streaming. 22 needs a newer Node than this machine has (see 0). |
| UI kit | Angular Material 21 (M3) for dialogs, menus, sliders, selects, tooltips, snackbar, plus a custom dark "reading" theme. Chat rendering is fully custom. | Solid a11y primitives for the modals without hand-building them; the part that has to look great (the chat) is ours. |
| State | Plain Angular services holding `signal()`/`computed()` state, one service per document type (see 1.3). No NgRx. | The persistence model is "one store slice = one JSON file"; a hand-rolled signal store maps onto that 1:1 with zero ceremony. |
| Model calls | Native `fetch` with `ReadableStream`, hand-written SSE parser (`data:` lines, `[DONE]`), `AbortController` for Stop. | No SDK dependency, full control over streaming and errors. |
| Rendering | `marked` (markdown) + `DOMPurify` (sanitising) + `highlight.js` (code blocks, `lib/core` with eight languages registered rather than `lib/common`) + a custom dialogue-formatting pass. | Standard, small, well-maintained. A story is not a codebase, so the full language set is not worth 350 kB. |
| Token estimate | Heuristic (chars / 3.6) with a pluggable interface; `gpt-tokenizer` can be dropped in later. | Good enough for budgeting; exact counts are provider-specific anyway. |
| Backend (step 3) | Node 22 + Express 5, ES modules, JSON files on disk, serves the Angular build. | Simplest thing that works; single process to launch. |
| Desktop (optional) | Electron 44 + electron-builder, wrapping the same Express server. | Same code, easier launch. |
| Automated E2E | Playwright against a local fake OpenAI-compatible SSE server. | Deterministic regression tests, no tokens burned. |

### 1.2 Repository layout

```
MagicStories/
  PLAN.md
  package.json              npm workspaces: app, server, e2e (electron later)
  app/                      Angular 21 workspace
    src/app/
      core/                 model client, SSE parser, prompt builder, tokens, formatting
      store/                signal stores (one per document type) + persistence layer
      features/
        chapters/           the reading surface and everything chapter-shaped: page,
                            message list, message item, composer, chapter toolbar,
                            scene sheet, chapters menu, close-chapter flow
        connection/         connection modal (provider, URL, key, model picker)
        generation/         model parameters modal
        story/              story setup modal (mode, narrator, characters, persona)
        world/              world modal (facts, people, places, story so far, lore)
      shared/               top bar, modal shell, editor field with light save button, ui bits
  server/                   Express persistence server (step 3); also the zip writer
  tools/                    dev.mjs (app + server together), package.mjs (the runnable zip)
  e2e/                      Playwright specs + fake OpenAI SSE server
  electron/                 (later)
```

### 1.3 Data model (TypeScript, all persisted as-is)

```ts
// settings.json  — one file, global
interface Settings {
  connection: {
    provider: 'nanogpt' | 'custom';
    baseUrl: string; // e.g. https://nano-gpt.com/api/v1
    apiKey: string; // stored locally in plain JSON (single-user, local machine)
    model: string; // selected model id
    modelsCache: ModelInfo[]; // last fetched list, for instant dropdown
  };
  generation: GenerationParams; // see below
  ui: {
    theme: 'dark' | 'light';
    bookStyleDialogue: boolean;
    fontSize: number;
    showTokenCounts: boolean;
  };
  activeStoryId: string | null;
}

interface GenerationParams {
  maxContextTokens: number; // budget used by the prompt builder
  maxResponseTokens: number;
  temperature: number;
  topP: number;
  frequencyPenalty: number;
  presencePenalty: number;
  stop: string[];
  seed?: number;
  // advanced, sent only when defined (NanoGPT & friends accept them)
  topK?: number;
  minP?: number;
  repetitionPenalty?: number;
  topA?: number;
  reasoningEffort?: 'none' | 'low' | 'medium' | 'high';
}

// stories/<storyId>.json — one file per story
interface Story {
  id: string;
  title: string;
  createdAt: string;
  updatedAt: string;
  mode: 'narrator' | 'roleplay';
  narrator: { useDefault: boolean; prompt: string }; // narrator mode only
  characters: Character[]; // roleplay mode
  persona: { name: string; description: string }; // always injected
  style: {
    // Prompt instructions, not rendering: Settings.ui holds the reading side.
    dialogueOnOwnLine: boolean;
    replyLength: 'short' | 'medium' | 'long';
  };
  world: {
    storySoFar: string; // compulsory, always injected, rewritten by "close chapter"
    summary: { useDefault: boolean; prompt: string }; // how a chapter is folded in
    entries: LoreEntry[]; // optional, keyword-activated
    scan: { depth: number; caseSensitive: boolean; matchWholeWords: boolean }; // defaults
  };
  activeChapterId: string;
  chapterCounter: number;
}
interface Character {
  id: string;
  name: string;
  description: string;
  enabled: boolean;
}
interface LoreEntry {
  id: string;
  title: string;
  category: 'fact' | 'person' | 'place' | 'other';
  keys: string[];
  content: string;
  enabled: boolean;
  alwaysOn: boolean; // bypass keyword scan
  caseSensitive?: boolean;
  matchWholeWords?: boolean;
}

// chapters/<chapterId>.json — one file per chapter. There is no separate
// "chat" document: a chapter *is* the conversation, plus the scene it opens on
// and the summary it closes with.
interface Chapter {
  id: string;
  storyId: string;
  number: number; // 1, 2, 3… never reused, never renumbered
  title: string; // "The Lantern Room"; defaults to the scene's first line
  // The scene, as one piece of prose. Written before the first message and
  // always injected verbatim. Deliberately not a set of fields: a scene
  // heading in a playscript is free text, the model reads prose perfectly
  // well, and any schema we imposed here would be a schema someone has to
  // fight. Required only in the sense that it must not be empty.
  scene: string;
  status: 'writing' | 'closed';
  summary: string; // written by "close chapter", folded into world.storySoFar
  createdAt: string;
  updatedAt: string;
  messages: ChapterMessage[];
}

interface ChapterMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  createdAt: string;
  editedAt?: string;
  meta?: {
    model?: string;
    promptTokens?: number;
    completionTokens?: number;
    finishReason?: string;
    aborted?: boolean;
  };
}
```

Every store exposes `signal`s and mutation methods, and writes each changed slice out as JSON.
Step 1 and 2 wrote to `localStorage`; from step 3 they write to the server, and from the revision
below they write *only* there.

### 1.4 Prompt assembly (rebuilt from scratch on every request)

```
[system]  1. Mode preamble
             narrator : default omniscient-narrator instructions (or the user's override)
             roleplay : "You are playing <Character A>, <Character B>…" + each description
          2. Persona: "The user plays <name>: <description>"
          3. Story so far: world.storySoFar
          4. Active lore: entries with alwaysOn OR whose keys match the scan window
             (scan window = the chapter's scene + user's new message + last N messages, N default
             4; case-insensitive substring by default, whole-word optional — same semantics ST
             uses in world-info.js)
          5. This chapter: "Chapter <n>, <title>. The scene:\n<scene>" — the scene text
             verbatim, nothing parsed out of it. The immediate setting, so it sits last,
             closest to the conversation
          6. Style rules: dialogue in "quotes", actions in plain prose, stay in character, never
             write for the persona in roleplay mode
[history] chapter messages, oldest dropped first until (system + history + reserve for the reply)
          fits maxContextTokens
[user]    the new message
```

Only the current chapter's messages are ever sent. Earlier chapters reach the model through
`world.storySoFar`, which is exactly what "close chapter" is for — that is the whole point of
chapters, and the reason context stays affordable however long the story runs.

The composer shows a live "context: 3.2k / 16k tokens" pill, and a "What the model sees" modal
(read-only dump of the assembled messages) is always one click away. That single view replaces
most of SillyTavern's prompt-manager complexity.

---

## 2. Step 1 — Chat box and model connection (no context, no backend)

Goal: a beautiful streaming chat that talks straight to a model.

### 2.1 Tasks

1. Scaffold: root workspaces, `ng new app` (standalone, zoneless, SCSS, routing off),
   Angular Material with a custom M3 dark theme, `marked`, `dompurify`, `highlight.js`.
2. App shell: top bar (title, story/chapter name placeholder, menu buttons: Connection,
   Parameters, later Story / World / Chapters), full-height chat page, composer docked at the bottom.
3. Settings store with `localStorage` persistence (temporary until step 3).
4. Model client (`core/model-client.ts`):
   - `listModels(baseUrl, apiKey)` → `GET {baseUrl}/models` (NanoGPT: `?detailed=true`).
   - `streamChat(request, onDelta, signal)` → `POST {baseUrl}/chat/completions` with `stream: true`,
     parses SSE, yields `delta.content`; ignores/collects `reasoning_content`; surfaces `usage` and
     `finish_reason` from the final chunk; maps HTTP 401/402/429/5xx to readable errors.
5. Connection modal: provider dropdown (NanoGPT → fills URL; Custom → editable URL), API key
   field (password, show/hide), "Fetch models" button, searchable model dropdown (grouped by
   `owned_by`), "Test" button that sends a one-token request. Saves on close.
6. Parameters modal: sliders + numeric inputs for every `GenerationParams` field, "Advanced"
   expander for top-k / min-p / repetition penalty / top-a / reasoning effort, "Reset to defaults".
   Context and response budgets shown together so the relationship is obvious.
7. Chat store: messages, streaming state, `send`, `stop`, `edit`, `delete`, `regenerate(id)`,
   `replayFrom(id)` (truncates everything after the chosen user message and re-sends it), `clear`.
8. Message rendering:
   - Markdown → sanitised HTML, code highlighted.
   - Dialogue pass: text inside "double quotes" (also curly quotes) is styled as speech; when
     "book style" is on, each spoken line starts its own paragraph. `*asterisk actions*` italic.
   - Streaming render throttled to one repaint per animation frame; auto-scroll that pauses when
     the user scrolls up, with a "jump to latest" chip.
   - Hover toolbar on each message: edit (inline textarea), regenerate / replay from here, delete,
     copy. Assistant messages show model name and token counts in a subtle footer.
9. Composer: auto-growing textarea, Enter to send / Shift+Enter newline, Stop button while
   streaming, disabled state with reason when connection is incomplete.
10. Error and empty states: friendly first-run card ("Connect a model to start"), inline error
    bubbles with retry.

### 2.2 E2E test (live, in the in-app browser)

1. Start `ng serve`, open the app.
2. Connection modal: pick NanoGPT, Gaetan pastes the key, fetch models, pick one, test → green.
3. Set temperature 0.9, response budget 400, close modal.
4. Send "Write two lines of dialogue between a knight and a dragon." Verify streaming, quote
   styling, book-style line breaks.
5. Edit the user message, replay from it → old answer gone, new answer streams.
6. Regenerate the last answer. Stop mid-stream → partial text kept, marked as stopped.
7. Reload the page → connection, parameters and chat survive (localStorage).
8. Break the key on purpose → readable 401 error, no crash.

Also: first Playwright spec against a fake SSE server covering send / stream / edit / replay,
so later steps have a regression net.

---

## 3. Step 2 — Chapters and context (scene, Narrator / Role-play, persona, world)

Goal: SillyTavern's power with one-tenth of the UI, arranged as a book rather than as a chat
client.

### 3.0 The chapter is the unit of the app

There is no "chat" and no "new chat". A story is a sequence of **chapters**, and every chapter
opens the way a scene opens in a playscript: a few lines saying where we are, when, who is on
stage, what is happening as the lights come up. Only then can anyone speak.

The scene is one plain-text field. Whether it reads like a stage direction, a paragraph of
narration or a single word is the writer's business — the model interprets prose, so the app
does not need a schema and the writer does not need to learn one.

That gives three hard rules the rest of step 2 follows:

- **A chapter cannot be written into until its scene is written.** Creating a chapter opens the
  scene sheet, and the composer stays disabled behind it. This is the one compulsory step in the
  app, and it earns that status: it is also the cheapest possible fix for the usual failure mode
  of these tools, a model with no idea where it is. Compulsory is not the same as onerous — any
  non-empty text passes.
- **A closed chapter is kept, always.** Closing summarises it into `world.storySoFar` and marks
  it `closed`; the chapter itself stays in the Chapters list, readable forever. Nothing asks
  whether to keep it and nothing deletes it. Deleting a chapter is a deliberate act from the
  Chapters list, with a confirm.
- **Chapter numbers are permanent.** `Story.chapterCounter` only ever increases. Chapter 3 stays
  Chapter 3 even if Chapter 2 is deleted, because a reader referring to "chapter 3" means a
  particular piece of text.

Migration from step 1: the single step-1 conversation becomes Chapter 1 of a story called
"Untitled story", with an empty scene and `status: 'writing'`. The scene sheet opens once over
it on first load so it can be filled in; the existing messages are left alone.

### 3.1 Tasks

1. **Story store** (`stories/*.json`) and **chapter store** (`chapters/*.json`) keyed by story —
   step 1's `ChatStore` becomes `ChapterStore`, and `features/chat/` becomes
   `features/chapters/`, so the word "chat" leaves the codebase with the concept. Top bar shows
   "Story title · Chapter N — Chapter title" and gains a Stories menu (new, switch, rename,
   duplicate, delete) and a Chapters menu (task 8).
2. **Scene sheet** (`features/chapters/scene-dialog`), the modal that opens a chapter. It is
   one field, not a form:
   - **The scene** — a single large autofocused textarea, set in the reading serif at reading
     size, because what goes in it is prose and should look like prose while it is written. No
     place / time / who fields: the model reads a paragraph as well as it reads a schema, and a
     schema is something the writer would have to fight the first time a scene does not fit it.
   - Placeholder text carries the playscript idea without imposing it: _"A lighthouse gallery.
     Dusk, the first night of autumn. Mara is alone, and the lamp is already lit."_ Guidance,
     not structure — write a word or three pages.
   - **Chapter title** — optional, one line; when blank it defaults to the scene's first line,
     trimmed.
   - Footer: word count and the token cost of the scene block, so the price of three pages is
     visible while it is being written.
   - Confirm is disabled while the scene is empty or only whitespace — that is the whole of the
     validation. Escape and backdrop save a draft but do not open the chapter; an empty scene is
     the one state that blocks the composer, and the composer says so, with a button back to the
     sheet.
   - Opening chapter N+1 pre-fills the sheet with chapter N's scene text, since continuing where
     you were is the common case and editing a paragraph beats retyping one.
3. **Scene in the prompt**: a `scene` block per 1.4 item 5, sitting last among the system blocks,
   injected verbatim — nothing in the app parses the scene, ever. The scene text also joins the
   lore scan window, so an entry named in the scene fires on the first message of the chapter
   rather than only once someone mentions it.
4. **Story modal**, three tabs:
   - **Mode**: big two-way toggle Narrator / Role-play with a one-line explanation of each.
     Narrator tab shows the default narrator prompt (read-only) with an "Override" switch that
     turns it into an editor. Role-play tab shows a character list (name, description, enabled).
   - **Persona**: name + description.
   - **Style** (small): dialogue-on-its-own-line toggle, reply length hint
     (short / medium / long), maps to a sentence in the style rules.
5. **World modal**:
   - **Story so far**: one large editor, marked "always included", word count. Shows which
     chapters have been folded into it, newest first.
   - **Lore**: card list grouped by category (facts, people, places). Each card: title, keys as
     chips, content, enabled, always-on. Add / duplicate / delete. Search box filters by title or
     key.
   - Scan settings in a footer: scan depth, case sensitive, whole words (global defaults).
   - Each entry collapses to one line (title, keys, state) and opens on click; a world holds
     dozens, and all of them open at once is unreadable. Added 2026-09-03 after review.
   - **"What is true" is required** (2026-09-03, after review): an entry is the sentence it
     contributes, so an empty one can never fire. The card says so and is marked unfinished
     rather than the entry being silently dropped from the prompt.
6. **Prompt builder** (`core/prompt-builder.ts`) implementing 1.4: a pure function of
   (settings, story, chapter, draft) → messages + token report + which lore fired and why.
   Unit-tested, and it replaces the history-only `assemble()` that step 1 left in `ChatStore`.
7. **"What the model sees"** modal, reachable from the composer pill, showing each block with its
   token cost, the scene block among them, and which lore entries fired and on which matched key.
8. **Chapters menu** — the table of contents. One row per chapter: number, title, the scene's
   first line as a subtitle, message count, word count, and state (writing / closed). Actions:
   open (the closed ones open read-only with a "Continue this chapter" button that flips it back
   to `writing`), edit scene, rename, delete (confirm), and **New chapter** at the bottom.
9. **Chapter toolbar** (inside the chat area, above the composer, small pill buttons). Note
   (2026-09-03, after review): **"New chapter" is the same act as "Close chapter"** — starting the
   next chapter summarises the one being written, shows the summary for review, and folds it into
   the story so far before the new scene is asked for. Only a chapter with nothing written in it,
   or one already closed, goes straight to the scene sheet. And a chapter that cannot be written
   into shows no composer at all: the dock carries the reason and the way out of it instead of a
   box that refuses what is typed into it.
   - **Close chapter**: builds a summarisation request (the story so far as it stands + this
     chapter's scene and messages + an instruction modelled on ST's memory extension default
     prompt), streams the result into a review modal (editable). On confirm: writes `summary`,
     **replaces** `world.storySoFar` with it, sets `status: 'closed'`, then opens the scene sheet
     for Chapter N+1 pre-filled per task 2. Nothing is discarded and nothing is asked.
     Revised 2026-09-03 after review: the summary **replaces** the story so far rather than being
     appended to it, which is what keeps it one readable page however long the story runs — so
     the request hands the model the existing summary and asks for the whole thing back. The
     instruction itself is a prompt like any other and is editable per story
     (`world.summary: { useDefault, prompt }`), from the World modal and from the review sheet.
   - **Edit scene** (opens the sheet for the current chapter), **What the model sees**.
10. **Save mechanics**: every editor field has a light save icon (appears when dirty, click to
    commit); the modal commits everything on close as well. Escape / backdrop close = save,
    never discard. The scene sheet is the single exception, and only for the "does this chapter
    open yet" decision — the text itself is still saved as a draft.
    Writing surface (fixed 2026-09-03, after review): every multi-line field autosizes through
    the CDK, which needs `cdk.text-field-autosize()` in the global styles (without it the box is
    measured at its current height and grows a line late) and assumes a content box (a border-box
    textarea ends up short by its own padding and scrolls the line being written). Both are set
    globally; a spec types into the composer and fails if the box ever scrolls its own text.
    Text is written into a box only through `[msText]`, which never rewrites a field that is
    being typed into — a plain `[value]` binding moves the caret to the end and throws away the
    browser's undo stack whenever the document changes underneath.
11. **Lore scanning** runs on every send over (scene + draft + last N messages), and again on
    regenerate / replay, since the context is always rebuilt.
12. **The story sheet comes before the first scene** (added 2026-09-03, after the first review of
    step 2). "New story" asks title / mode / persona and only then opens the scene sheet, because
    those three shape every request the chapter will make and are awkward to discover afterwards.
    All three are optional and all three stay editable in Story; backing out creates nothing. A
    first run that has never been written in gets the same sheet over the story the app made for
    itself, where backing out simply keeps the defaults.
13. **The connection comes before the story sheet** (added 2026-09-03, after the review of step
    3). A fresh install opens on Connection and nothing else: there is no point writing a scene
    for a model the app cannot reach, and every other question is downstream of this one. That
    sheet insists — no Escape, no backdrop, and Done stays dark until there is an endpoint and a
    model — but it keeps one "Not now", because a modal with no way out would be worse than the
    block it is enforcing. The block itself is already downstream: the composer stays shut and
    says why. The whole thing is skipped once a connection is stored, which is every run but the
    first. Order on a fresh install: connection → story → scene.

### 3.2 E2E test (live)

1. Create story "The Lighthouse", Narrator mode, persona "Mara, a marine biologist".
2. The scene sheet opens by itself and the composer is disabled. Confirm is greyed out; type a
   space and it stays greyed out. Write the scene as one piece of prose: _"The keeper's cottage,
   late afternoon, low tide. Mara arrives to find the door unlatched and nobody answering."_
   Title left blank. Confirm → the chapter opens, titled from the first line, composer alive.
3. World: story so far "Mara has just arrived on the island."; lore "Old Tomas" (keys: tomas,
   keeper), "The Lantern Room" (keys: lantern, lamp room).
4. Open "What the model sees" before typing anything: the scene block is there word for word,
   and Old Tomas has already fired on "keeper" in the scene — the Lantern Room has not.
5. Send "I walk up to the door." → output is narration in third person, and it picks up the
   cottage, the hour and the unlatched door from the scene rather than inventing its own.
6. Switch to Role-play, add character "Tomas" with a description, send a line → model answers as
   Tomas, in first person, does not speak for Mara.
7. **Close chapter** → summary streams into the review modal, edit one word, confirm. Chapter 1
   goes `closed`, story-so-far gains the summary, and the Chapter 2 scene sheet opens pre-filled
   with chapter 1's scene text. Rewrite it as _"The lantern room, an hour later."_ — a single
   short line, to prove nothing more is ever required — confirm → Chapter 2 opens empty, and
   "What the model sees" now shows the Lantern Room lore firing.
8. Chapters menu shows two rows: "1 — The keeper's cottage… (closed)" and "2 — The lantern
   room… (writing)". Open Chapter 1 → read-only, its messages intact, with "Continue this
   chapter".
9. Reload → story, both chapters, both scenes and the story-so-far all intact.
10. Playwright specs extended: the composer stays disabled until a scene is written, whitespace
    alone does not count, a one-word scene is accepted, the scene reaches the prompt verbatim,
    scene text activates lore, the chapter title falls back to the scene's first line, mode
    switch changes the system prompt, close-chapter keeps the chapter and pre-fills the next
    scene, and chapter numbers survive a deletion — all against the fake server.

---

## 4. Step 3 — Backend persistence (and optional Electron)

Goal: the store is mirrored to disk, as-is, always.

### 4.1 Server (`server/`)

- Express 5, ES modules, `data/` folder with `settings.json`, `stories/`, `chapters/`.
- API, deliberately tiny:
  - `GET  /api/docs/:collection` → list of `{id, updatedAt}` (or full docs for small collections)
  - `GET  /api/docs/:collection/:id` → the JSON as stored
  - `PUT  /api/docs/:collection/:id` → overwrite; body is the document; returns `{ok, seq}`
  - `DELETE /api/docs/:collection/:id`
  - `GET  /api/health`
- Write ordering ("whoever comes first gets written first"): one FIFO promise chain per file
  path; each write goes to `file.tmp` then `rename` (atomic on Windows and POSIX). Requests are
  processed in arrival order; a client-supplied monotonic `seq` header lets the server drop a
  write that is older than the last one it applied for that file (guards against reordering on
  the wire).
- Serves `app/dist` statically so `npm start` in the root runs everything on one port.
- Optional daily zip of `data/` into `backups/` on startup (cheap insurance).

### 4.2 Client persistence layer

- `PersistenceService` replaces the `localStorage` adapter from step 1 behind the same interface.
- For each document: `effect()` on the store slice → debounce 300 ms → serialise → PUT.
  Per-document in-flight guard: if a PUT is running, the latest state is queued and sent once,
  after it completes (coalescing). `beforeunload` flushes with `fetch(..., {keepalive: true})`.
- Bootstrap: `GET settings`, `GET stories`, `GET chapters` for the active story, then render.
  A small status dot in the top bar: saved / saving / offline (with retry).
- `localStorage` stays as a write-through cache so the UI paints instantly on reload.
  **Reversed 2026-09-03 — see 4.6.**

### 4.3 Packaging (`npm run package`)

Added to step 3 on 2026-09-03, ahead of Electron and as the thing Electron will wrap.

- `tools/package.mjs` builds the app, stages `server/src`, the Angular output as `public/`, and
  the server's production dependency closure as `node_modules/`, then writes
  `build/magicstories-<version>.zip` (~1 MB).
- The dependency closure is resolved the way Node resolves it, from the installed tree, rather
  than by asking npm to install again: it works offline and copies the versions that were tested.
- Zipping is done by `server/src/zip.js`, a hundred-line deflate writer, so neither the package
  script nor the daily backup pulls in a dependency for it.
- Unzip anywhere, run `start.bat` (Windows) or `start.sh` (Linux, macOS): one call starts the
  server, opens the browser, and creates `data/` next to the script. Node 20.19+ is the only
  prerequisite; nothing is installed or built at the far end.
- The start scripts pass `--open`; `--port`, `--data`, `MS_OPEN=0` and `MS_BACKUP=0` all work.

### 4.4 Electron (later, not built)

- `electron/main.ts` starts the Express server in-process on a free port and opens a
  `BrowserWindow` at it; `data/` lives in `app.getPath('userData')`.
- electron-builder for a Windows installer / portable exe. Not on the critical path, and
  deliberately left out of the package above. The server already takes its data and public
  folders as options, which is all Electron needs from it.

### 4.6 One source of truth (revision, 2026-09-03)

`localStorage` is gone. The server holds the documents; the app reads them once at startup into a
map that lasts the session, writes go to that map and to the server, and a reload starts again
from disk.

**Why the cache was wrong.** It was there because step 1 had no backend, and it stayed on when
step 3 gave it one — with too little argument. Two copies of the same document is two sources of
truth, and the price showed up as a merge on every startup, a persisted write queue, a rule for
which side wins, and a class of bug where a browser holding an old story met an empty server and
helpfully uploaded it. All of that bought one thing: a reload that painted before the first
network round trip — on a local app whose database is a handful of JSON files on the same machine,
read in a few milliseconds.

**What follows from it.**

- No server, no app. The startup read retries a few times and then shows a screen saying so, with
  a Try again. An app that opened anyway would be an empty one, indistinguishable from a fresh
  install, and the next keystroke would be written over a story that was fine. `App` renders
  either that screen or the workspace, and the stores are only constructed for the second, because
  they read at construction.
- Offline is now a session-only state: writes queue in memory and retry, the app keeps working,
  but a reload while offline loses what has not been sent. The indicator says so, and closing the
  tab with a failing queue prompts.
- The step-1 `chat:` migration is gone with the storage it read from.
- Every Playwright spec now runs against a real server with its own data folder, seeded by writing
  JSON into it, because there is nowhere else for a document to be. The dev server left the suite.
- `npm run smoke` lost the port-rotation trick it had grown to dodge exactly this problem.

### 4.5 Final acceptance test

Two halves. The automated half proves the machinery; the live half proves the thing is worth
using, which no fake model can tell you.

#### The automated half — `npm run e2e`

`e2e/specs/journey.spec.ts` walks one narrator story from nothing: empty data folder, browser that
has never seen the app, production build served by the real persistence server, no seeding
anywhere. Eleven stages, in order, each checked against the JSON on disk rather than the screen —
connection insists → endpoint and model → narrator, title, persona → the scene refuses whitespace
→ the first turn carries narrator + persona + scene in that order → story so far always sent →
lore stays out until the story mentions it → close chapter folds it in and replaces the summary →
chapter 2 opens on the previous scene and carries none of chapter 1's transcript → an empty
browser reads it all back off disk → the data folder holds that and nothing else.

Plus `persistence.spec.ts` for the backend's own behaviour (offline and catch-up, two tabs, delete
takes its files with it), and the rest of the suite for everything else. All of it must be green.

#### The live half — `npm run smoke`, then this script

`npm run smoke` builds the package, unzips the **archive** into an empty folder, and starts it
through `start.bat` / `start.sh` — on a port this machine has never served the app from, which is
the part that makes it genuinely fresh. An empty `data/` folder is not enough on its own: browser
storage is keyed by origin, and a browser holding documents that meets a server holding none
uploads them, which is the deliberate "first run after this app grew a backend" path. Reuse the
URL and the second smoke run silently restores the first one's story and calls it new. Used ports
are remembered in `build/.smoke-ports.json`; delete that file and you are back to guessing.

First thing to check, because nothing automated can: the story behind the connection sheet should
be **Untitled story**. Anything else means the browser brought one with it.

Narrator mode, a real key, a real model.

1. **It runs at all.** One call, browser opens, no console errors, `data/` appears beside the
   script.
2. **Connection.** It opens on the connection sheet and refuses Escape. Paste the key, fetch the
   models, pick one, **Test** answers. `data/settings.json` now holds the key and model.
3. **Story.** Narrator, a title, a persona. Check `data/stories/<id>.json`.
4. **Scene.** Whitespace will not open the chapter; real text will. Check the chapter file.
5. **Six or eight turns.** This is the part that matters and the part only a person can judge:
   does it stay in the scene, keep the persona out of its own mouth, and end on something you can
   answer? Try **Stop** mid-answer, **Edit** a line of your own, **Regenerate** an answer you did
   not like, **Replay from here**.
6. **World.** Write the story so far. Add two lore entries, one with a key the story has already
   used and one it has not. Open **What the model sees** from the composer pill and confirm the
   right one fired, on the right key. Check the token counts against the provider's real usage
   under the last answer.
7. **Close the chapter.** Read the summary it writes: does it keep the names, the promises, the
   injuries? Edit it, confirm, and check that `world.storySoFar` was *replaced* and the chapter
   kept its own copy.
8. **Chapter 2.** The sheet opens pre-filled. Write two turns and confirm from the preview that
   chapter 1's transcript is gone and only the summary carries it.
9. **It survives.** Ctrl+C, start it again, everything is there. Then copy the whole folder
   somewhere else, start it there, and confirm the story came with it.
10. **Money.** Note what the whole session cost against the provider's dashboard. If a chaptered
    story is not materially cheaper per reply than one long chat, the central premise is wrong and
    that is worth knowing.

---

## 5. Cross-cutting decisions and assumptions

- Single user, local machine. The API key is stored in `settings.json` in plain text. Acceptable
  for a local tool; noted in the README.
- No images anywhere. No group-chat mechanics, no swipes/variants, no extensions system, no
  text-completion (non-chat) APIs. Only OpenAI-style chat completions, streaming only.
- Token counting is an estimate. The context slider is a budget, not a guarantee; the app shows
  the provider's real `usage` after each reply so the user can calibrate.
- Persona, characters and world belong to the story (one story = one self-contained file).
  Chapters are separate files because they are appended to forever and read one at a time.
  Reuse is via "Duplicate story". A shared library can be added later if it turns out to matter.
- A chapter's scene is fixed once written, but never locked: "Edit scene" is always available,
  and since the prompt is rebuilt from data every time, an edit takes effect on the next reply
  without touching what has already been written.
- Keyboard: Enter send, Shift+Enter newline, Esc closes modals (and saves), Ctrl+Enter
  regenerate last, Ctrl+K opens the model picker.

## 6. Order of work and checkpoints

| Step | Deliverable | Checkpoint |
|---|---|---|
| 1 | Streaming chat + connection + parameters, localStorage only (the conversation becomes Chapter 1 in step 2) | **Done 2026-09-02.** 22 unit tests + 14 Playwright specs green against the fake endpoint; NanoGPT's live model list confirmed from the browser (612 models, no key, CORS fine). The live-key half of E2E 2.2 still needs Gaetan. |
| 2 | Chapters with compulsory scenes, story / persona / world / lore, prompt builder, close chapter | **Done 2026-09-03.** 37 unit tests + 24 Playwright specs green against the fake endpoint. Live E2E 3.2 still needs Gaetan's key. |
| 3 | Express persistence, bootstrap, status indicator, packaging | **Done 2026-09-03.** 53 app unit tests + 30 server unit tests + 39 Playwright specs green, five of them driving the production build served by the real server and asserting against the files on disk. `npm run package` produces a ~1 MB zip that runs from one call. Electron deliberately left for later. Live E2E still needs Gaetan's key. |

Each step is a separate session. Nothing from a later step is started before the previous
checkpoint passes.
