# Reading and writing

[← Documentation](README.md) · Previous: [Getting started](getting-started.md) · Next: [Chapters](chapters.md)

---

The page is the app. Everything else opens over it and gets out of the way again.

![The reading surface](images/reading.png)

## The page

Your lines sit in a quiet block with a rule down the side. The model's answers are set as prose,
in a serif, at a measure that is comfortable to read rather than as wide as your monitor.

Three things are done to the model's text as it arrives:

- **Markdown** is rendered (and sanitised — nothing from a model can run in your browser).
- **"Quoted speech"** is set apart in its own colour, so a page of dialogue reads as dialogue.
- **`*Actions in asterisks*`** are italicised.

Under each answer, if you want it, is the model that wrote it and what the turn actually cost —
`612 in · 148 out`, taken from the provider's own usage rather than guessed.

## The composer

The box grows as you type, up to a point, and then scrolls. It is not there at all when the
chapter cannot be written into — instead you get the reason and the button that fixes it:

> *This chapter has no scene yet — write it*
> *Chapter 2 is closed — continue it*
> *Pick a model in Connection*

| Key | Does |
|---|---|
| **Enter** | send |
| **Shift+Enter** | new line |
| **Ctrl/Cmd+Enter** | regenerate the last answer |

**Stop** replaces **Send** while an answer streams, and keeps whatever arrived before you pressed
it — a half-written passage is still a passage, and you can edit it or carry on from it.

![An answer arriving, with Stop up](images/streaming.png)

### When a chapter outgrows the budget

If the chapter has grown past what fits in one request, a note appears under the composer — *3
older messages left out* — so the trimming is never silent. What was dropped, and everything else
the request carries, is [What the model sees](the-prompt.md), which lives behind **Developer
mode** — see below.

## What each message can do

Hover a message and its toolbar appears.

![Edit, replay, regenerate, copy, delete](images/message-actions.png)

| | |
|---|---|
| **Edit** | Change the text in place. On a user line this is how you fix a typo without re-rolling; on an answer it is how you keep a good passage with one bad sentence. |
| **Replay from here** *(your lines)* | Drop everything after this line and send it again. |
| **Regenerate** *(answers)* | Drop this answer and everything after it, and ask again. |
| **Copy** | The raw text, as written. |
| **Delete** | Just that message. |

None of these are special paths. Because the prompt is rebuilt from the documents on every
request, an edit or a regenerate goes down exactly the same road as a fresh send — there is no
conversation state to get out of step. See [The prompt](the-prompt.md).

If a request fails, the answer is replaced by the provider's own words and two buttons,
**Try again** and **Dismiss**. A rejected key reads as a rejected key.

## Preferences

**Preferences** in the top bar holds everything that changes how the story looks to you and
nothing about what is sent. It opens on **Reading**, with **Colours** and **Advanced** folded
away underneath.

### Reading

![Preferences, open on Reading](images/preferences.png)

- **Dark theme** — on by default.
- **Dialogue on its own line** — breaks each quoted line onto its own paragraph. This only has
  visible work to do when a model runs narration and dialogue together in one block; models that
  already break their own lines look the same either way.
- **Show token counts** — the line under each answer.
- **Text size** — 14 to 26 pixels.

![The same chapter, light](images/light.png)

> These are reading preferences and live in `settings.json`, not in the story. The *prompt*
> instructions that ask the model to put dialogue on its own line, or to answer at a particular
> length, live in **Story → Style** — see [Story and world](story-and-world.md).

### Colours

![The colours a theme is built from](images/preferences-colours.png)

Every colour the two themes differ on is here, one swatch each, and changing one redraws the page
as you drag. Nothing has been added to the palette that was not already in it: **Page**, **Paper**,
**Raised paper**, **Rules**, **Text**, **Your own lines**, **Action**, **Muted text**, **Accent**,
**Dialogue** and **Errors** are the names the stylesheet itself uses, and each says what moves
when it moves.

- **Each theme keeps its own set.** Editing while the dark theme is on edits the dark colours;
  switch to light in **Reading** and you are editing the light ones. Neither touches the other.
- **Reading font** — the serif it ships with, a sans-serif, or a monospace, all from fonts your
  computer already has. It sets the story itself; the app around it stays as it is.
- **Reset the … colours** puts one theme back to exactly what Lamplit ships, and asks first. It
  clears only what you changed, so a colour you never touched cannot drift.
- **A contrast warning**, not a block. If your text and your paper fall below the 4.5:1 that WCAG
  AA asks of body text, it says so and lets you carry on.

Only what you changed is written down, so a colour a later version of Lamplit improves still
reaches you unless you had overridden that exact one.

### Advanced

![Developer mode, and what it puts back](images/preferences-advanced.png)

Options for people who want to look under the hood. There are two.

**Check for a new version when Lamplit starts** — on by default. Once per start, the server asks
GitHub which versions have been published, and the top bar says so when one of them is newer.
Switched off, it is not asked at all. See [Upgrading](upgrading.md) for what the request carries
and what the pill leads to.

**Developer mode** puts back the parts of the app that are about the app rather than about the
story, and it is off on a fresh install:

- The **context pill** under the composer — `context 805 / 16k`, a live count of what the next
  request will carry against your budget, updating as you type. Clicking it is the way into
  [What the model sees](the-prompt.md).
- The folder your documents are in, under the version in **⋯ → About Lamplit**.

It changes nothing about the request. A story written with it on and a story written with it off
send exactly the same thing; the difference is only whether you can watch.

## Getting around

The top bar always says which story and which chapter you are in, and which model is answering.
Click the story name for the story menu — switch, rename, duplicate, delete, or start a new one.
The **⋯** menu holds **New chapter**, **Edit this scene**, **Clear this chapter**, and
**About Lamplit** — which says exactly which build you are running, the line to quote in a bug
report. See [Upgrading](upgrading.md).

Everything is saved as you write it. There is no Save button anywhere in the app, and Escape out
of any modal keeps what you typed in it.
