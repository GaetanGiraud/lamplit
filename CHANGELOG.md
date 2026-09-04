# Changelog

The top section of this file is the release notes: the tag's workflow copies it
onto the draft release, so it is written for the person downloading, not for the
person who wrote the code. A section is written as the work happens, under
`## Unreleased`, and renamed to the version when the tag goes out.

## Unreleased

**Role-play can be a room or a conversation.** Under **Story → Mode → Role-play** there are now
two ways to cast it. **Ensemble** is what the app has always done and stays the default: the model
plays everyone in the scene and answers as whoever the moment calls for. **One at a time** gives it
a single character to be — the rest are named as present, and it may describe what they do, but it
never speaks for them.

- **Switching is in the chapter panel.** Click a row in **Cast** and the model plays that character
  from there on; the row being played is marked. The small switch on each row takes somebody in or
  out of the scene, in either casting.
- **The model is told, where it happened.** A switch or a departure becomes a short line in the
  chapter at that point — *"From here you play Tomas. Nell is no longer the character you play"*,
  *"Isa has left the scene."* Nothing already written is rewritten, and the chapter reads exactly as
  it did: the lines are in **What the model sees**, not in the story.
- **Each answer remembers who wrote it**, so closing a chapter summarises it with the right names
  attached rather than as one anonymous voice.
- **An existing story is untouched.** A story that never answered the question is an ensemble, and
  an ensemble sends the same prompt, byte for byte, that it always did.

**The chapter's own fields are beside the page now, not on top of it.** The scene, the narrator's
instructions, your persona and the cast each used to mean leaving the story for a modal and coming
back. They are a panel down the right-hand side: a thin edge until you click it or press
**Ctrl+.**, and it opens the way you left it next time.

- **Everything in it is edited where it is**, and saved the way every other field in the app is
  saved — the mark appears once the text differs from what is stored, and leaving the field commits
  it. A closed chapter shows its scene and will not take a change to it.
- **The narrator default sits in the box**, greyed, instead of behind a switch: write into it and it
  becomes yours, and **Back to the default** hands it back with your own text kept.
- **A cast row is a name and the first line of the description.** The pencil at the end of it opens
  that character in the **Story** sheet, because a character is more than a row can hold.
- **On a wide window it narrows the reading column** and covers nothing. On a narrow one it comes
  over the page, and **Escape** or a click behind it sends it away. The composer stays usable in
  both.
- Nothing about the app is in it. The connection, the sampling parameters and the reading settings
  are not chapter fields and stay where they were.

**Nothing sits on top of the story any more.** A message's actions — edit,
regenerate, replay, copy, delete — used to appear as a pill over the first line
of the message they belonged to, so moving the pointer across the page to read
hid the words under it. They are marks in the **right margin** now, out past
the edge of the text, and they appear on hover or when you tab into a message
exactly as before.

- **Jump to latest** moves with them: a small round **↓** in the same column of
  margin, rather than a filled button over the last lines you were reading.
- **On a narrow window or a touch screen** there is no margin to write in and
  no pointer to hover with, so the same actions sit behind a single **⋯**
  *under* the message, on the line that already carries the model and the token
  count. Neither layout is ever over a word, at any width.
- The keyboard path is unchanged, and so is everything the actions do.

**Lamplit tells you when there is a newer one, and what changed in it.** Once
per start, the server asks GitHub which versions have been published. When one
of them is newer than yours, the top bar says so — a small pill, *0.2.0
available*, and nothing else. No modal, no banner over the page you are writing
on. Click it for **What's new**: every release above yours, newest first, with
the notes as they were written.

- **The notes are in the app now.** **⋯ → About Lamplit → Release notes** shows
  every release, so they can be read with nothing pending. They are also a page
  on the website, generated from this file, so there is still one place they are
  written.
- **The desktop app is unchanged in what it does**: it still downloads the
  update itself and installs it when you quit. The zip and a copy running from
  the repository now hear about one too, which they never did.
- **What leaves your machine**: one request to `api.github.com` for the list of
  releases, carrying what any HTTP request carries and nothing about you, your
  stories or your provider. The server makes it, not the browser, so the only
  host the app itself talks to is still the model endpoint you chose.
- **Switching it off** is **Preferences → Advanced → Check for a new version
  when Lamplit starts**, or `LAMPLIT_UPDATE_CHECK=0` for a zip started by a
  script. Off means the request does not happen, rather than happening and being
  ignored.

**The prompt's blocks can be put in a different order.** In **What the model
sees**, the persona, the story so far, the world and this chapter each have a
handle: drag one and the sheet rebuilds as it moves, so you can see what the
change does before anything is sent. The arrow keys move a block whose handle
has the focus.

- **Two blocks stay where they are.** The mode preamble is always first — it
  says what the model is, and the rest is read as instructions to that — and
  the style rules are always last, because the instruction closest to the
  conversation is the one that sticks. Each says so in the sheet.
- **The order belongs to the story**, not to the app: another story is
  unaffected, and a duplicate carries it along. **Reset the order** appears
  once you have moved something.
- Only a changed order is written down, so a story written by an older Lamplit
  opens in the shipped order — and so does one whose stored order names a block
  this version does not have, rather than the app guessing at what was meant.

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
