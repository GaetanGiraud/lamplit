# The desktop app

[← Documentation](README.md) · Previous: [Your data](your-data.md) · Next: [Running it anywhere](running-anywhere.md)

---

One file to download, one icon to click. Nothing to install first — Node.js travels inside, which
is the only reason this exists alongside [the zip](running-anywhere.md).

**[Downloads are on the front page](index.md).** Windows and Linux; macOS is not built, and that
page says why.

Everything else in this guide applies unchanged. It is the same app, the same server and the same
files as every other way of running Lamplit; the window is a browser with the address bar
taken off.

## Where your stories are

The one difference worth knowing. Instead of a `data` folder beside a script, the desktop app
keeps your documents in your own profile:

| | |
|---|---|
| **Windows** | `%APPDATA%\Lamplit\data` — that is `C:\Users\<you>\AppData\Roaming\Lamplit\data` |
| **Linux** | `~/.config/Lamplit/data` |

**File → Open data folder** opens it, which is easier than typing any of that.

Inside is exactly the layout [Your data](your-data.md) describes — `settings.json`,
`stories/<id>.json`, `chapters/<id>.json` — and the daily zip in `backups` beside it. Copy the
folder and you have copied everything; drop it into the same place on another machine and the
stories are there.

**Uninstalling does not touch it.** The uninstaller removes the program and leaves the profile
where it is, so reinstalling later finds every story where you left it. If you really want the
stories gone, delete that folder yourself.

**Upgrading is the same act:** run the new installer over the old one, or replace the portable
`.exe`. Nothing has to be uninstalled first and no story moves. [Upgrading](upgrading.md) covers
every channel, and what the app shows the first time a newer version starts.

### The portable build

The Windows **portable** download is one `.exe` that installs nothing. It keeps `data` and
`backups` beside itself rather than in your profile, so a USB stick can hold the app and the
stories together and both travel.

## The window

- **File** — Open data folder, Quit.
- **Edit** — the usual undo, cut, copy, paste, select all.
- **View** — reload, zoom in and out, full screen, developer tools.
- **Help** — the website, where to report a problem, and the exact build you are running
  (the same line as **⋯ → About Lamplit**; see [Upgrading](upgrading.md)).

Links that lead somewhere else — a provider's "get a key" page, for instance — open in your normal
browser rather than taking the app's window away from you.

Opening Lamplit a second time brings the window you already have to the front. One app, one
set of files, no chance of two of them writing over each other.

## Updates

It checks the project's releases once when it starts, and downloads a new version quietly in the
background if there is one. You are told when it is ready; it is installed the next time you quit.
Nothing is sent anywhere in the process except the request that asks what the latest version is.

## The window remembers itself

Its size and position are kept in `window.json` next to your data folder. Delete that file and the
next launch opens at the default size.

## What it does not change

- **Your key still goes straight to your provider.** The window is Chromium, so the app talks to
  the model exactly as it does in a browser tab: no proxy, nothing in between. See
  [Models and parameters](models-and-parameters.md).
- **The server is the same one.** It runs inside the app, on the loopback address and on a port it
  picks for itself, so it never collides with anything and nothing on your network can reach it.
- **The files are the same files.** A story written in the desktop app opens in the zip, and the
  other way round.

## If it will not start

The first launch on Windows shows **"Windows protected your PC"**, because the build is not signed
with a paid certificate. **More info → Run anyway** is the way past it, and the
[front page](index.md) says the same thing with a picture. Every other symptom is the same as
anywhere else: [Your data](your-data.md) covers the server not answering.
