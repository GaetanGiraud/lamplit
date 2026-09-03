# MagicStories

A single-page, chat-centred, text-only storytelling app. The browser talks straight to any
OpenAI-compatible endpoint — no backend in the way, no proxy, no SDK.

`PLAN.md` is the plan of record. This README covers running what exists.

## What works today (steps 1 and 2)

- Streaming chat against any OpenAI-compatible `/chat/completions`, parsed as SSE.
- Connection modal: NanoGPT or a hand-typed URL, API key, model list (grouped, filterable),
  and a Test button that does one real round trip.
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
- Everything auto-saves to `localStorage` (a real backend arrives in step 3). A step-1
  conversation is migrated into Chapter 1 of a new story on first load.

Server persistence is step 3. See `PLAN.md` §4.

## Requirements

Node 20.19+, 22.12+ or 24+ (Angular 21). Install through your configured npm registry.

## Running

```bash
npm install
npm start
```

`npm start` serves the app on <http://localhost:4200>. Open it and the scene sheet for Chapter 1
is waiting: say where we are and what is happening, confirm, then click **Connect a model**, paste
your key, fetch the model list, pick one, and write the first line.

## Tests

```bash
npm test
```

Unit tests (vitest) cover the SSE reader, the request builder, error mapping, token estimates,
the story formatter, and the prompt builder (block order, the scene verbatim, lore scanning,
budget trimming, chapter titles, the summary request).

```bash
npm run e2e
```

Playwright drives the real app against `e2e/fake-openai-server.mjs`, a deterministic stand-in for
an OpenAI-compatible endpoint. Both servers start automatically. No tokens are spent and no key is
needed. The fake endpoint takes instructions from the message text: `!slow`, `!long`, `!error`,
`!401`, `!prose`.

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
  store/    signal stores + the storage backend they write through
  features/ chapters (page, scene sheet, chapters list, close chapter, prompt preview),
            connection, generation, story, world
  shared/   top bar, dialog openers, editor field, shared controls
e2e/      Playwright specs + the fake endpoint
```

## A note on the API key

The key is stored in plain text, in this browser's `localStorage` today and in
`data/settings.json` once step 3 lands. That is deliberate: MagicStories is a single-user tool on
your own machine, and a local file you control beats a secret store you have to unlock every time.
Do not run it on a shared machine or serve it to a network you do not trust.
