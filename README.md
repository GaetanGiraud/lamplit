# MagicStories

A single-page, chat-centred, text-only storytelling app. The browser talks straight to any
OpenAI-compatible endpoint — no backend in the way, no proxy, no SDK.

`PLAN.md` is the plan of record. This README covers running what exists.

## What works today (step 1)

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
- Everything auto-saves to `localStorage` (a real backend arrives in step 3).

Step 2 turns this single conversation into **chapters**: a story is a sequence of them, each one
opening on a compulsory scene (place, time, who is present, opening direction) the way a scene
opens in a playscript, and closing into a summary that carries forward. Story setup, persona and
world/lore arrive with it. Server persistence is step 3. See `PLAN.md` §3.

## Requirements

Node 20.19+, 22.12+ or 24+ (Angular 21). Install through your configured npm registry.

## Running

```bash
npm install
npm start
```

`npm start` serves the app on <http://localhost:4200>. Open it, click **Connect a model**, paste
your key, fetch the model list, pick one, and write the first line.

## Tests

```bash
npm test
```

Unit tests (vitest) cover the SSE reader, the request builder, error mapping, token estimates and
the story formatter.

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
  core/     model client, SSE reader, errors, token estimates, story formatting
  store/    signal stores + the storage backend they write through
  features/ chat, connection, generation
  shared/   top bar, dialog openers, shared controls
e2e/      Playwright specs + the fake endpoint
```

## A note on the API key

The key is stored in plain text, in this browser's `localStorage` today and in
`data/settings.json` once step 3 lands. That is deliberate: MagicStories is a single-user tool on
your own machine, and a local file you control beats a secret store you have to unlock every time.
Do not run it on a shared machine or serve it to a network you do not trust.
