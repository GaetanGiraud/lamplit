# Changelog

The top section of this file is the release notes: the tag's workflow copies it
onto the draft release, so it is written for the person downloading, not for the
person who wrote the code.

## 0.1.0 — the first release

The first version anyone can install without a terminal.

MagicStories writes a story with you, in chapters, with a language model of your
choosing. It runs on your machine, keeps every story as a plain JSON file you can
copy or back up yourself, and sends your API key straight to your provider and
nowhere else — there is no account, no server of ours, and nothing to sign up for.

**What is in it**

- **Chapters.** A story is written in chapters. Each opens on a scene you write,
  and closing one folds it into the story so far, so a long story stays a
  reasonable size to send.
- **Narrator or role-play.** Tell the story in third person, or play one person
  in it and let the model play the rest.
- **A world that remembers.** A persona, a cast, and lore entries that reach the
  model when the writing mentions them.
- **The whole prompt, visible.** *What the model sees* shows exactly what is
  about to be sent, block by block, before it goes.
- **Twenty-two providers,** from OpenAI, Anthropic and Google to OpenRouter and
  NanoGPT, or anything else that speaks OpenAI's chat completions — including a
  model running on your own machine through Ollama or LM Studio.

**Getting it**

- **Windows** — the installer, or the portable .exe if you would rather it
  installed nothing. Windows will warn you about an unfamiliar app the first
  time; the download page shows the two clicks past it.
- **Linux** — the AppImage runs with no install at all, or take the .deb.
- **macOS** — not built, for want of an Apple developer licence. The download
  page says what to do instead.
- **Any machine with Node.js** — the zip runs from one call and is a megabyte.

Your stories live in your profile (**File → Open data folder** finds it) and are
left alone when you uninstall.
