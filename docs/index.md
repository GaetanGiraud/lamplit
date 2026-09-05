<!--
  The landing page. Written for someone who has never heard of a model endpoint.

  Note on links: jekyll-relative-links rewrites `[x](y.md)` for us, but it does
  not touch href attributes in raw HTML — so links inside the blocks below point
  at .html directly. This page only ever exists as the website; every other page
  in docs/ is read on GitHub too, and keeps its .md links.
-->
<style>
  .ms-lede { font-size: 1.12rem; line-height: 1.65; }

  .ms-shot { margin: 1.6rem 0 2.4rem; }
  .ms-shot img { width: 100%; border-radius: 10px; box-shadow: 0 2px 20px rgba(0,0,0,.25); }

  .ms-downloads {
    display: grid;
    gap: 1.1rem;
    grid-template-columns: repeat(auto-fit, minmax(250px, 1fr));
    margin: 1.4rem 0 1rem;
    padding: 0;
    list-style: none;
  }
  .ms-downloads > li {
    border: 1px solid #dfdcd4;
    border-radius: 12px;
    padding: 1.15rem 1.15rem 1.2rem;
    background: #fff;
  }
  .ms-downloads h3 { margin: 0 0 .8rem; font-size: 1.05rem; }
  .ms-downloads p { margin: .8rem 0 0; font-size: .88rem; line-height: 1.55; color: #55514a; }

  .ms-get, .ms-get--off {
    display: block;
    text-align: center;
    padding: .72rem 1rem;
    border-radius: 8px;
    font-weight: 600;
    font-size: .95rem;
  }
  .ms-get { background: #4b3d72; color: #fff !important; text-decoration: none !important; }
  .ms-get:hover { background: #392e58; }
  .ms-get--off { background: #e6e2da; color: #8a8479; cursor: not-allowed; }

  .ms-off { background: #f5f3ef; border-style: dashed !important; }
  .ms-off h3 { color: #8a8479; }

  /* The card for the machine reading the page. Both of these do nothing until
     the script at the foot adds .ms-here, so with JavaScript off the page reads
     exactly as it is written and no card is hidden or reordered. */
  .ms-downloads > li.ms-here { border-color: #4b3d72; box-shadow: 0 0 0 2px #4b3d72; }
  .ms-here-note { display: none; }
  .ms-downloads > li.ms-here .ms-here-note {
    display: block;
    margin: -.4rem 0 .8rem !important;
    font-size: .74rem !important;
    font-weight: 700;
    letter-spacing: .06em;
    text-transform: uppercase;
    color: #4b3d72 !important;
  }

  .ms-note { font-size: .88rem; color: #55514a; line-height: 1.55; }

  .ms-advanced {
    border: 1px solid #dfdcd4;
    border-radius: 12px;
    padding: .9rem 1.15rem;
    background: #fff;
    margin: 1.4rem 0;
  }
  .ms-advanced > summary { cursor: pointer; font-weight: 600; }
  .ms-advanced[open] > summary { margin-bottom: .6rem; }
  .ms-advanced p { font-size: .9rem; line-height: 1.6; color: #55514a; }
  .ms-advanced .ms-get { max-width: 20rem; margin: 1rem 0 .2rem; }
  .ms-advanced code { font-size: .85em; }

  .ms-steps {
    display: grid;
    gap: 1.6rem;
    grid-template-columns: repeat(auto-fit, minmax(210px, 1fr));
    margin: 1.2rem 0 0;
    padding: 0;
    list-style: none;
  }
  .ms-steps img { width: 100%; border-radius: 8px; border: 1px solid #dfdcd4; }
  .ms-steps h3 { margin: 0 0 .7rem; font-size: 1rem; }
  .ms-steps p { font-size: .9rem; line-height: 1.55; color: #55514a; }
</style>

# Write a story with a machine that can write

<p class="ms-lede">
Lamplit is a writing app for stories told a chapter at a time, with a language model of your
choosing doing the writing beside you. It runs <b>on your own machine</b>. Your stories are files
you can read, copy and back up. Your key goes to your provider and nowhere else — there is no
account, no server of ours, and nothing to sign up for.
</p>

<p class="ms-lede">
It is <b>not</b> a chatbot in a costume, and not somewhere your writing is kept for you. No
images, no marketplace, no feed. Somewhere to write a long story, and keep it.
</p>

<p class="ms-shot">
<img src="images/reading.png" alt="A chapter of a story, set like the page of a book">
</p>

## Download it

<ul class="ms-downloads">
  <li id="ms-windows">
    <h3>Windows</h3>
    <p class="ms-here-note">For this computer</p>
    <a class="ms-get" href="https://github.com/lamplit-app/lamplit/releases/latest/download/Lamplit-Setup.exe">Download the installer</a>
    <p>
      The first time you run it, Windows says <b>“Windows protected your PC”</b>. That warning is
      about who paid for a signing certificate, not about what is in the file. Click
      <b>More info</b>, then <b>Run anyway</b>.
    </p>
    <p>
      Or the <a href="https://github.com/lamplit-app/lamplit/releases/latest/download/Lamplit-portable.exe">portable version</a>,
      which installs nothing and keeps your stories beside it — a USB stick can carry both.
    </p>
  </li>
  <li id="ms-linux">
    <h3>Linux</h3>
    <p class="ms-here-note">For this computer</p>
    <a class="ms-get" href="https://github.com/lamplit-app/lamplit/releases/latest/download/Lamplit.AppImage">Download the AppImage</a>
    <p>
      An AppImage installs nothing. Once it has downloaded, make it runnable —
      <b>Properties → Permissions → Allow executing</b>, or
      <code>chmod +x Lamplit.AppImage</code> — and open it like anything else.
    </p>
    <p>
      Or the <a href="https://github.com/lamplit-app/lamplit/releases/latest/download/Lamplit.deb">.deb package</a>,
      for Debian, Ubuntu and their relatives.
    </p>
  </li>
  <li class="ms-off" id="ms-macos">
    <h3>macOS</h3>
    <p class="ms-here-note">For this computer</p>
    <span class="ms-get--off">No installer</span>
    <p>
      A macOS build that opens without a fight needs Apple’s developer licence, which this project
      does not hold. Rather than hand you something your Mac refuses to open, there is no installer
      here.
    </p>
    <p>
      <b>If you have that licence and would like to contribute the builds,</b>
      <a href="https://github.com/lamplit-app/lamplit/issues">open an issue</a> — that is the
      one way to reach this project, and it would be very welcome.
    </p>
    <p>
      Meanwhile Lamplit does run on a Mac, as a one-megabyte zip you start by double-clicking —
      <b><a href="#own-node">Advanced: run it with your own Node.js</a></b>, just below.
    </p>
  </li>
</ul>

<p class="ms-note">
Each download is about 110 MB, nearly all of it the browser engine the window is made of.
<a href="desktop.html">The desktop app</a> says where your stories are kept, how to move them, and
why uninstalling leaves them alone.
</p>

<details class="ms-advanced" id="own-node">
  <summary>Advanced: run it with your own Node.js</summary>
  <p>
    The same app without the browser engine: one megabyte instead of a hundred, and
    <b>Node.js 20.19 or newer</b> on the machine instead. This is the way in on a Mac, and the way
    in on a server or anything else with no desktop to speak of.
  </p>
  <a class="ms-get" href="https://github.com/lamplit-app/lamplit/releases/latest/download/Lamplit.zip">Download the zip</a>
  <p>
    Unzip it anywhere and run <code>start.bat</code> (Windows), <code>start.command</code> (macOS)
    or <code>start.sh</code> (Linux). It starts the server and opens the app in your browser; your
    stories are written to a <code>data</code> folder beside it. If Node.js is missing or too old,
    the script says so and offers the one command that installs it here — and installs nothing
    unless you say yes.
  </p>
  <p>
    On a Mac, the first run of a file you downloaded may be refused; right-click
    <code>start.command</code> and choose <b>Open</b> instead, which asks once and never again.
  </p>
  <p>
    <a href="running-anywhere.html">Running it anywhere</a> has the rest: the options, moving the
    folder, and how to build the zip yourself.
  </p>
</details>

## The first run, in three questions

It asks three things, and then gets out of the way. It never asks again.

<ul class="ms-steps">
  <li>
    <h3>1. Where to send the story</h3>
    <img src="images/first-run-connection.png" alt="The connection sheet a fresh install opens on">
    <p>
      Pick a provider, paste the key it gave you, choose a model. <b>Test</b> makes one real
      request, so you find out the whole path works before you start writing rather than
      mid-sentence.
    </p>
  </li>
  <li>
    <h3>2. Who tells the story</h3>
    <img src="images/first-run-story.png" alt="Choosing narrator or role-play, and who you play">
    <p>
      <b>Narrator</b> tells the whole story in one voice. <b>Role-play</b> gives the other
      characters their own words. Then a line or two about who you play.
    </p>
  </li>
  <li>
    <h3>3. The opening scene</h3>
    <img src="images/scene.png" alt="The scene sheet, the one compulsory step in the app">
    <p>
      Where we are, when, who is on stage, and what is happening as the lights come up. Plain
      text, nothing parsed out of it. Then you write.
    </p>
  </li>
</ul>

## Where do I get a key?

Lamplit sells nothing and takes no cut. You bring a key from whoever you want to write with,
and the app talks to them straight from your machine.

If you have never done this before, an **aggregator** is the easiest start: one key, and every
model behind it.

| | |
|---|---|
| [OpenRouter](https://openrouter.ai/keys) | One key, most models that exist, pay as you go |
| [NanoGPT](https://nano-gpt.com/api) | The same idea, a large list, no subscription |
| [Pollinations](https://auth.pollinations.ai) | Has a free tier that works with no key at all |

Or go straight to the people who made the model — [OpenAI](https://platform.openai.com/api-keys)
for GPT, [Anthropic](https://console.anthropic.com/settings/keys) for Claude,
[Google](https://aistudio.google.com/apikey) for Gemini, and a dozen more in the app's own list.

Or pay nobody at all, and run the model on your own computer with
[Ollama](https://ollama.com) or [LM Studio](https://lmstudio.ai). Every provider the app knows,
and what each one needs, is in [Models and parameters](models-and-parameters.md).

## Then read the guide

**[The guide](README.md)** covers the whole app:
[chapters, and how a long story stays affordable](chapters.md),
[the world your story remembers](story-and-world.md),
[exactly what is sent to the model](the-prompt.md), and
[where your files are](your-data.md).

---

<p class="ms-note">
Every link above is the newest version. What changed in each one is on the
<a href="releases.html">release notes</a> page, and Lamplit itself says so when a newer one is
out — once, quietly, in the top bar. See <a href="upgrading.html">Upgrading</a> for what that
check sends and how to switch it off.
</p>

<p class="ms-note">
Free and open source, MIT licensed, on
<a href="https://github.com/lamplit-app/lamplit">GitHub</a> — which is also where to
<a href="https://github.com/lamplit-app/lamplit/issues">report anything wrong</a>. To run it
from the source, or build it yourself, start at <a href="development.html">Development</a>.
</p>

<script>
  // Two small courtesies, both additive: the page is written to read correctly
  // with this file blocked, missing or broken, and nothing here hides a card,
  // reorders one, or redirects anyone.
  //
  //   1. Mark the card for the machine this page is being read on.
  //   2. Open the Advanced section when a link points into it, since a browser
  //      is not obliged to open a <details> to reach its own id.
  (function () {
    var agent = navigator.userAgent || '';
    // A phone or tablet says Linux or Mac and runs none of these, so it gets no
    // card marked rather than the wrong one.
    var phone = /Android|iPhone|iPad|iPod/.test(agent);
    var card =
      phone ? null
      : /Windows|Win64|Win32/.test(agent) ? 'ms-windows'
      : /Macintosh|Mac OS X/.test(agent) ? 'ms-macos'
      : /Linux|X11|CrOS/.test(agent) ? 'ms-linux'
      : null;
    var here = card && document.getElementById(card);
    if (here) here.className += ' ms-here';

    var advanced = document.getElementById('own-node');
    if (!advanced) return;
    var links = document.querySelectorAll('a[href="#own-node"]');
    for (var i = 0; i < links.length; i++) {
      links[i].addEventListener('click', function () {
        advanced.open = true;
      });
    }
    if (location.hash === '#own-node') advanced.open = true;
  })();
</script>
