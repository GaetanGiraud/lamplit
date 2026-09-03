# Changelog

The top section of this file is the release notes: the tag's workflow copies it
onto the draft release, so it is written for the person downloading, not for the
person who wrote the code. A section is written as the work happens, under
`## Unreleased`, and renamed to the version when the tag goes out.

## Unreleased

**Developer mode, for the half of the app that is about the app.** The context
pill under the composer and **What the model sees** behind it are now off
unless you ask for them: **Preferences → Advanced → Developer mode**. A fresh
install is the writing app and nothing else.

- **One door instead of two.** The **What the model sees** button in the chapter
  toolbar is gone; the pill was always the better way in, because it says what
  the room is about and counts your draft as you type.
- **About** gains the folder your documents are in, under the version, while
  developer mode is on. The build line stays where it was for everyone — it is
  what makes a bug report answerable.
- It changes nothing about the request. A story written with it on and one
  written with it off send exactly the same thing.
- **Show token counts** is unaffected: the line under each answer is about
  reading, and stays in **Preferences → Reading**.

**Preferences, and the colours the story is read in.** The **Reading** menu in
the top bar is now **Preferences**, a sheet with room in it. **Reading** is the
same four settings it always was — theme, dialogue on its own line, token
counts, text size — and it is open when the sheet opens.

- **Colours.** Every colour the two themes are built from is a swatch you can
  change, and the page redraws as you drag: the page, the paper, the text, your
  own lines, the accent, the dialogue, the rest. Each theme keeps its own set,
  so the dark palette and the light one are yours separately. **Reset** puts one
  theme back to exactly what Lamplit ships.
- **A reading font** — the serif it ships with, a sans-serif, or a monospace,
  from the fonts your computer already has. It sets the story; the app around it
  stays as it is.
- **It warns rather than blocks.** Text on paper below the 4.5:1 that WCAG AA
  asks of body text says so, and lets you carry on.
- Only what you changed is written down, so a `settings.json` from 0.1.0 opens
  with the theme exactly as it shipped, and a colour a later version improves
  still reaches you unless you had overridden that one.
- **Advanced** is there and empty. It is where the options that come with a
  warning will live.

**The zip is on the release now.** Every release carries `Lamplit.zip` beside the
installers: the whole app in about a megabyte, for any machine that already has
Node.js 20.19 or newer. 0.1.0's notes promised it and the release did not have
it — this is that, and
[the link](https://github.com/GaetanGiraud/lamplit/releases/latest/download/Lamplit.zip)
always points at the newest one. It is also the way in on a Mac, which has no
installer of its own.

- **The start scripts look for Node.js before they start anything.** If it is
  missing, or older than 20.19, they say so in one line and then offer the one
  command that would install it on this machine — winget on Windows, Homebrew on
  a Mac, apt, dnf or pacman on Linux. It is an offer: the command is on screen,
  and nothing is installed unless you answer yes. Say no and it leaves you the
  exact download from nodejs.org.
- **`start.command`, for a Mac.** Finder opens a double-clicked `.sh` in a text
  editor and runs a `.command`, so the zip now carries both — the same script
  under the name that works.
- **The download page** marks the card for the computer you are reading it on,
  and keeps the zip one click away under *Advanced*.

**Every build says which one it is.** **⋯ → About Lamplit** now shows the
version, the CI run that built it, the commit it was built from and the date:
the line to quote in a bug report, since a version number alone stops being
enough once two builds have carried it. The desktop app's **Help** menu shows
the same line, and `/api/health` returns every field of it.

- **It notices an upgrade.** Start a newer Lamplit over stories written by an
  older one and it says so, once, at the top of the page, with a link to what
  changed. Dismiss it and it never comes back for that version. A fresh install
  has nothing to compare against and stays quiet.
- **[Upgrading](https://gaetangiraud.github.io/lamplit/upgrading.html)** is a
  new page in the guide: how to get the new version on each channel, how to
  carry your stories across when you run the zip, and where every way of
  running it keeps them.

## 0.1.0 — the first release

The first version anyone can install without a terminal.

Lamplit writes a story with you, in chapters, with a language model of your
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
