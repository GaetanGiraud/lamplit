# The live test

One story, one real model, one person. Everything a fake endpoint can prove is proved by
`npm run e2e` (`specs/journey.spec.ts` walks the same road with a stand-in model). What is left is
the part only a reader can judge — does it tell a decent story? — and the part only a real bill
can settle — is a chaptered story materially cheaper per reply than one long chat? That second
question is the app's central premise, so the script measures it rather than asking.

Written 2026-09-03 for step 3 of `PLAN.md` (§4.5). It is the same walk, with the prompts written
out so two runs are comparable, and a place to put the numbers.

- **Time:** about 45 minutes, plus whatever the model takes to type.
- **Cost:** a dozen requests against a sixteen-thousand-token budget. Small change on a mid-priced
  model; note the balance before you start (step 0) so the cost is a number rather than a feeling.
- **You need:** a NanoGPT key with credit (or any OpenAI-compatible endpoint), a text editor that
  opens JSON, and a terminal.

## Conventions

- **Bold** is something you click or a menu you open. `Monospace` is something you type or a path.
- **Prompts are numbered (P1, P2…)** and written out in full in [the prompts](#the-prompts) at the
  bottom. Paste them as given. Nothing in the app needs the punctuation to be exact, but the
  checks below assume the details these prompts plant (a cut hand, a promise, two names).
- **On disk** means the `data/` folder of the fresh install, which lives at

  ```
  build/fresh-install/lamplit-0.1.0/data/
  ```

  relative to the repo root (the version number follows `package.json`). The server prints the
  same path on the line starting `documents` when it starts. Three things are in there:

  | File | Holds |
  |---|---|
  | `settings.json` | connection (key, model), parameters, reading preferences |
  | `stories/<id>.json` | the story: mode, persona, world, lore, `activeChapterId` |
  | `chapters/<id>.json` | one chapter each: `scene`, `status`, `summary`, `messages[]` |

  A fresh install has exactly one story file, so `<id>` is whichever file is there. Chapter files
  carry a `number` field; sort by it. Every file is pretty-printed JSON and can be opened while the
  app runs — the server never holds them open.

- **Result** columns are yours. `✓`, `✗`, or a note. When you are done, the filled-in tables *are*
  the test report; paste them into an issue if anything failed.

## 0 · Before you start

| # | Do | Expected | Result |
|---|---|---|---|
| 0.1 | Log in to your provider and write down the balance. NanoGPT shows it on the dashboard at <https://nano-gpt.com>. | A number, in currency. Write it in the [bill](#the-bill) as *before*. | $9.93 |
| 0.2 | Pick the model you will use and note its price per million tokens, in and out, from the provider's model page. | Two numbers, in the money table. Prefer a mid-priced non-reasoning model for a first run — reasoning models bill their thinking as output and make the cost comparison noisy. | Input: $0.10/1M Output: $0.45/1M Cache: Read $0.05/1M |
| 0.3 | Make sure nothing is running on port 4177 (an `npm start` from earlier, for instance). | If something is, the fresh install takes the next free port and says so. That is fine; just use the URL it prints. | |
| 0.4 | From the repo root: `npm run smoke` | It packages, unzips the archive into `build/fresh-install/`, starts it through `start.bat` / `start.sh`, prints the URL and the `documents` path, and opens the browser. Leave this terminal open; **Ctrl+C** in it stops everything. | |

## 1 · It runs at all

| # | Do | Expected | Result |
|---|---|---|---|
| 1.1 | Look at the page that opened. | The **connection sheet** is open over an otherwise empty page. Nothing else. | Yes |
| 1.2 | Read the story name behind the sheet, in the top bar. | **Untitled story**. Anything else means the browser brought a story with it, and the install was not fresh. Stop and report it. | yes |
| 1.3 | Press **F12**, look at the console. | No red. Warnings about fonts or dev-tools are fine. | Console clean |
| 1.4 | Look on disk. | `data/` exists beside `start.bat`, holding `settings.json` and empty `stories/` and `chapters/` folders (or about to — the first write lands when you touch the connection). | check |

## 2 · Connection

| # | Do | Expected | Result |
|---|---|---|---|
| 2.1 | Press **Escape**. Click the dark backdrop. | The sheet stays. This is one of two sheets in the app that insists. | not tested |
| 2.2 | Leave **Provider** on **NanoGPT**. Paste your key into **API key**. | The eye icon shows and hides it. **Done** is still dark: no model yet. | check |
| 2.3 | **Fetch models**. | The list fills (NanoGPT: several hundred). Under the button, a short note says to prefer a model that does not think before it writes. Type in **Filter models** — `claude`, `gpt`, `70b` — and the list narrows. Pick the model from 0.2. | |
| 2.4 | **Test**. | *Sending one short request…* then *The model answered: “…”* with a word or two from the model. A wrong key says so in the provider's words instead. | check |
| 2.5 | Open `data/settings.json`. | `connection.apiKey` is your key, in plain text; `connection.model` is the id you picked. Written already, before you pressed Done. | check |
| 2.6 | **Done**. | The connection sheet closes and the **story sheet** opens in its place. | check |

## 3 · Story

| # | Do | Expected | Result |
|---|---|---|---|
| 3.1 | **Who tells it**: leave **Narrator** selected. Read the one-line explanation under each choice. | Narrator is the default. Role-play is one click away. | Check |
| 3.2 | Title: paste **P1**. **Who you play**: paste **P2** into the name and **P3** into the description. | Plain text fields. Nothing validates; all three are optional. | Check |
| 3.3 | **Write the first scene**. | The story sheet closes and the **scene sheet** opens. The top bar now says *The Lighthouse*. | Check |
| 3.4 | Open `data/stories/<id>.json`. | `title` is *The Lighthouse*, `mode` is `narrator`, `persona.name` and `persona.description` hold P2 and P3. | Check |

## 4 · Scene

| # | Do | Expected | Result |
|---|---|---|---|
| 4.1 | Press **Escape** on the scene sheet. | It closes. The page behind has **no composer**: the dock says the chapter has no scene yet, with a button back to the sheet. Click it. | |
| 4.2 | Type three spaces and a newline into the scene. | **Open the chapter** stays dark. Whitespace is not a scene. | |
| 4.3 | Select all, paste **P4**. Leave **Chapter title** blank. | The button lights up. The footer counts words and shows the token cost of the scene block. | |
| 4.4 | **Open the chapter**. | The sheet closes, the composer appears with the cursor in it, and the top bar reads *Chapter 1 — The keeper's cottage, late afternoon, low tide.* (the scene's first line, since the title was blank). | |
| 4.5 | Open `data/chapters/<id>.json`. | `number: 1`, `status: "writing"`, `scene` is P4 word for word, `title` is empty, `messages` is empty. | |

## 5 · The chapter — first half

Turn on **Reading → Show token counts** before the first line so every answer carries its real
cost. For each answer, copy the `in` and `out` numbers from the footer into the
[cost table](#cost-per-reply) as you go; it is much harder to reconstruct afterwards.

Between turns, read what came back and score it against the [prose rubric](#prose-rubric). Do not
correct the model's course to make it pass; the point is to see what it does on its own.

| # | Do | Expected | Result |
|---|---|---|---|
| 5.1 | Click the **context** pill under the composer. | **What the model sees** opens: four blocks, in order — the narrator instruction, *The user plays Mara…*, *Chapter 1, The keeper's cottage…* with P4 verbatim, then the style rules. No story-so-far block and no lore block yet: empty blocks are left out rather than shown empty. **Escape** to close. | |
| 5.2 | Paste **P5**, press **Enter**. | Your line appears in a quiet block on the left. The answer streams in, **Send** has become **Stop**, and the context pill updates as the answer grows. | |
| 5.3 | Read the answer. | Third person, past tense. It is *in the cottage*, at low tide, with the door already unlatched — it uses the scene rather than inventing a place. It does not decide anything for Mara. It ends on something you can answer. Under it: the model name and `N in · N out`. | |
| 5.4 | Paste **P6**, **Enter**. Then, while the answer is still streaming, press **Stop**. | The stream halts. What arrived is kept. The footer gains the word *stopped*. The composer is live again. | |
| 5.5 | Paste **P7**, **Enter**. | The model carries on from the stopped answer without comment — it treats the partial passage as what happened. Mara's hand is now cut and wrapped in her scarf; the answer acknowledges it. | |
| 5.6 | Paste **P8**, **Enter**. Read it. Then hover the answer and press **Regenerate** (or **Ctrl+Enter**). | The first answer is replaced by a new stream. The new answer is different. Only one answer to P8 remains. | |
| 5.7 | Hover your P8 line, press **Edit**, change it to **P8b**, **Save**. Then hover it again and press **Replay from here**. | Your line now reads P8b. Everything after it is gone. A new answer streams and mentions the oars, which only P8b asked about. | |
| 5.8 | Open `data/chapters/<id>.json`. | `messages` holds exactly eight entries: four `user`, four `assistant`, alternating. The P6 answer has `meta.aborted: true`. The P8 line reads P8b and has an `editedAt`. Every assistant entry has `meta.model`, `meta.promptTokens`, `meta.completionTokens`. | |

## 6 · World

The world goes in mid-chapter on purpose: the last four turns and the summary then run with it in
place, and *Old Tomas* fires on a word the chapter has already used while *The Lantern Room* has
to wait for a chapter that mentions it.

| # | Do | Expected | Result |
|---|---|---|---|
| 6.1 | **World → Story so far**. Paste **P9**. | A light save icon appears while the field is dirty; click it or just move on — either commits. The field is marked *Always included in every request*. **Folded in so far** is empty — nothing has been closed yet. | |
| 6.2 | **World → Lore → Add an entry**, choose *Person*. Title **P10a**, Keys **P10b**, What is true **P10c**. Leave **Enabled** on, **Always on** off. | The entry collapses to one line: title, keys as chips, *on*. | |
| 6.3 | **Add an entry**, choose *Place*. Title **P11a**, Keys **P11b**, What is true **P11c**. | Second entry, under *Places*. Leave **Scan depth** at 4. **Escape** to close World. | |
| 6.4 | Click the **context** pill. | Block 3 is now *The story so far* with P9. Block 4, *What is true in this world*, holds **Old Tomas only**, annotated *fired on "keeper" in the scene* (or on *tomas* in a message — either is right; note which). **The Lantern Room is not there.** | |
| 6.5 | Still in the preview, read the totals at the top. | Total, budget (16k), and the reserve for the reply (800). The total is within a few percent of the `in` count the *next* answer will report — check it after 7.1. | |
| 6.6 | Open `data/stories/<id>.json`. | `world.storySoFar` is P9. `world.entries` has two objects with the keys you typed, split on commas and trimmed. | |

## 7 · The chapter — second half

| # | Do | Expected | Result |
|---|---|---|---|
| 7.1 | Paste **P12**, **Enter**. | The answer knows who Tomas is to Mara (from the story so far and the lore), without being told in the line. Compare its `in` count to the preview total from 6.5. | |
| 7.2 | Paste **P13**, **Enter**. | Mara's promise is now in the record. The narrator does not have Mara take it back or qualify it — that is her line, not the model's. | |
| 7.3 | Paste **P14**, **Enter**. | Night falls in the cottage. The answer sets up a next morning without writing it. | |
| 7.4 | Paste **P15**. Then, on a new line in the same box, type `[AUTHOR] ` and paste **P15a**. | As you type the tag it disappears, P15a moves into the **author** field under the box, and the **Author** button lights up. The box still holds P15 and nothing else. | |
| 7.5 | **Enter**. | Your line appears with the direction under it as a note — italic, indented, labelled *author* — and not as part of the prose. The answer does what P15a asked without ever mentioning being asked: the door is unlocked and Mara can tell, and nothing in the reply reads as an acknowledgement. The lore entry fires on this line for the *next* request, not this one. | |
| 7.6 | Click the **context** pill. | A seventh block, **Author**, sits after the style rules — *"Some of the user's messages carry a direction…"* — with a reason where a drag handle would be. In **This chapter**, your last message goes out as P15, a blank line, then `[Author: …]`. | |
| 7.7 | Open the chapter file. | The last user message has `content` (P15) and `direction` (P15a) as **two separate fields**. The direction is nowhere inside `content`. | |
| 7.8 | Score the chapter as a whole against the [prose rubric](#prose-rubric). | Eight answers, one voice. | |

## 8 · Close the chapter

| # | Do | Expected | Result |
|---|---|---|---|
| 8.1 | Press **Close chapter** in the toolbar above the composer. | A sheet opens and a summary streams into an editable box. Below it: **Write it again**, **What was asked for**, **Cancel**, **Close the chapter**. | |
| 8.2 | Read the summary. Check it against the [summary rubric](#summary-rubric). | Names (Mara, Tomas), the cut hand, the promise not to leave, the missing keeper, the logbook, the cottage — all present. Past tense, continuous prose, not a bullet list, under 300 words. It *rewrites* P9 to include the chapter rather than pasting the chapter after P9. **P15a is not in it**, in any words: a direction shaped the chapter, it is not part of it. | |
| 8.3 | **What was asked for**. | The fold-in instruction, read-only, with the default shown and **Write my own**. Close it without changing anything. | |
| 8.4 | Edit one word in the summary — change *scarf* to *sleeve*, say. **Close the chapter**. | The sheet closes. The **scene sheet for Chapter 2** opens immediately, **pre-filled with P4**. The top bar reads *Chapter 2*. | |
| 8.5 | Open `data/stories/<id>.json`. | `world.storySoFar` is the edited summary and **only** the summary — P9 is gone as a separate text, folded in. | |
| 8.6 | Open the chapter 1 file. | `status: "closed"`, `summary` holds the same edited text, `messages` still holds all sixteen. Nothing was removed. | |

## 9 · Chapter 2

| # | Do | Expected | Result |
|---|---|---|---|
| 9.1 | Select all in the scene sheet, paste **P16**. **Open the chapter**. | One short line is accepted. Chapter 2 opens empty. | |
| 9.2 | Click the **context** pill. | Block 3: the story so far is the summary from 8.4. Block 4: **The Lantern Room** now fires, *on "lantern" in the scene*. Old Tomas fires too if *keeper* or *tomas* is in the summary — it usually is. Block 5 is Chapter 2 with P16. **The history is empty**: not one message from chapter 1. | |
| 9.3 | Paste **P17**, **Enter**. | The answer knows Mara has a cut hand, that Tomas is missing, and what she promised — it can only know that from the summary. Write down its `in` count; it is the number the whole test is for. | |
| 9.4 | Paste **P18**, **Enter**. | The answer stays in the lantern room, an hour after dawn, and treats the lore entry's facts about the room as true. | |
| 9.5 | **Chapters** in the top bar. | Two rows: *1 — The keeper's cottage… · closed* and *2 — The lantern room… · writing*, each with message and word counts. | |
| 9.6 | Open chapter 1 from the list. | Read-only: all sixteen messages, and where the composer was, *Chapter 1 is closed — continue it*. Do **not** continue it. Go back to chapter 2 through **Chapters**. | |

## 10 · It survives

| # | Do | Expected | Result |
|---|---|---|---|
| 10.1 | **Ctrl+C** in the smoke terminal. Reload the browser tab. | The app does not start. A screen says the server cannot be reached, with **Try again**. Nothing else renders. | |
| 10.2 | Start it again by hand: `build/fresh-install/lamplit-0.1.0/start.bat` (or `./start.sh`). Press **Try again** in the tab. | Everything is back: The Lighthouse, chapter 2 open, two chapters in the list, the summary in World, the two lore entries, the key and model in Connection. | |
| 10.3 | Stop it again. Copy the whole `lamplit-0.1.0` folder somewhere else — another drive, a USB stick — and run `start.bat` from the copy. | The copy opens with the story in it. The original was not touched. Delete the copy afterwards. | |
| 10.4 | Look in `backups/` beside `data/`. | One `data-<today>.zip`, made on the first start today. | |

## 11 · Money

Fill the three tables below. They are the test's real output.

### Cost per reply

Copy the footer of each answer. `in` is what the request carried, and the number that chapters
are supposed to keep flat.

| Turn | Prompt | `in` | `out` | Notes |
|---|---|---|---|---|
| C1·1 | P5 | | | |
| C1·2 | P6 | | | stopped |
| C1·3 | P7 | | | |
| C1·4 | P8 → regenerated → P8b replayed | | | record the final one |
| C1·5 | P12 | | | first turn with the world in place |
| C1·6 | P13 | | | |
| C1·7 | P14 | | | |
| C1·8 | P15 | | | the last turn of chapter 1 |
| Close | the summary request | | | not shown in the app; take it from the provider's usage page, or estimate as C1·8 `in` + C1·8 `out` + about 100 for the instruction |
| C2·1 | P17 | | | **the number the test is for** |
| C2·2 | P18 | | | |

### The comparison

The control does not need to be run: a single long chat would have sent, at C2·1, everything a
chaptered story sent at C1·8 plus the answer to C1·8 plus the new line. So:

| Quantity | Value | How |
|---|---|---|
| One long chat, C2·1 `in` | | C1·8 `in` + C1·8 `out` + 30 |
| Chaptered, C2·1 `in` | | from the table above |
| **Saving per reply, at chapter 2** | | long chat − chaptered |
| Cost of the close | | the *Close* row, `in` + `out` |
| **Replies to repay the close** | | close ÷ saving |

Two more things to note in words, because they decide the verdict:

- The saving grows every turn. A long chat adds each turn's `in` + `out` to the next request; a
  chaptered story adds only the turn. By chapter 2's tenth reply the gap is roughly ten times what
  it was at C2·1, and it never stops widening.
- The close is paid once per chapter, and it is smaller than one long-chat reply would be a
  chapter later.

**Verdict.** If *replies to repay the close* is under about eight, the premise holds: an ordinary
chapter pays for its own summary. If it is over twenty, the summary request is too expensive
relative to what it saves, and the premise needs another look before Electron and outreach make
the app easier to reach.

### The bill

| | Amount |
|---|---|
| Balance before (0.1) | |
| Balance after | |
| **Spent** | |
| Model, price in / price out per million (0.2) | |
| Tokens in / out, summed from the table above | |
| Spent, computed from tokens × price | |
| Difference between the two *Spent* lines | should be near zero; if not, the footer numbers are not what the provider bills, and that is worth an issue |

## Rubrics

### Prose rubric

Score each answer ✓ or ✗ on each line; a chapter is decent if nothing has more than one ✗ across
the eight answers.

| | Test |
|---|---|
| **Place** | It is where the scene says: the cottage, then the shore, then the cottage again. It does not move Mara somewhere she did not go. |
| **Time** | Late afternoon, low tide, then dusk, then night. It does not skip to morning until you do. |
| **Voice** | Third person, past tense, literary rather than chatty. No "Great question", no options offered, no frame-breaking. |
| **Hands off Mara** | Mara does what you said and nothing else. It may describe what she sees and feels; it does not decide, speak or act *for* her beyond your line. |
| **Memory** | The cut hand (from P7) is still cut in P12–P15. Tomas is still missing. The logbook is still with her. |
| **A hook** | Each answer ends on something you can answer — a sound, a find, a question the scene poses — not a full stop on a closed moment. |
| **Length** | Two or three paragraphs, as the default style asks. Not a page, not a line. |

### Summary rubric

| | Test |
|---|---|
| **Names** | Mara, Tomas. |
| **Facts** | Nine years away; her mother's friend; letters every winter until this one; the unlatched door; the empty cottage; the logbook. |
| **Injury** | The cut hand, wrapped. |
| **Promise** | She will not leave until she finds him. |
| **Shape** | Continuous past-tense prose, one page at most, and *one* story: P9 rewritten to include the chapter, not P9 followed by a second paragraph about the chapter. |
| **Nothing invented** | No events that did not happen in the eight turns. |

## The prompts

Copy exactly. Curly quotes and dashes are fine either way.

| ID | Where it goes | Text |
|---|---|---|
| **P1** | Story sheet → Title | `The Lighthouse` |
| **P2** | Story sheet → Who you play → Name | `Mara` |
| **P3** | Story sheet → Who you play → Description | `A marine biologist, thirty-one, back on the island after nine years. Practical, not sentimental, and not at all sure she wanted to come.` |
| **P4** | Scene sheet, chapter 1 | `The keeper's cottage, late afternoon, low tide.`<br>`Mara arrives with one bag to find the door unlatched and nobody answering. The stove is cold. Tomas's boots are not by the door.` |
| **P5** | Composer, C1·1 | `I push the door open the rest of the way and call his name.` |
| **P6** | Composer, C1·2 (press **Stop** mid-answer) | `I go through to the kitchen and read the logbook on the table from the first page, slowly.` |
| **P7** | Composer, C1·3 | `I cut my hand on the latch on the way out, wrap it in my scarf, and go down to look at the tide.` |
| **P8** | Composer, C1·4 (then **Regenerate**) | `I check whether the boat is still in the boathouse.` |
| **P8b** | The same line, edited (then **Replay from here**) | `I check whether the boat is still in the boathouse, and whether the oars are in it.` |
| **P9** | World → Story so far | `Mara grew up on the island and left nine years ago, after her mother's funeral. Tomas, the keeper, was her mother's oldest friend and has written to her every winter since. This winter no letter came, and the harbourmaster's note said only that the light had not been lit for three nights.` |
| **P10a** | World → Lore → Add an entry → Person → Title | `Old Tomas` |
| **P10b** | … → Keys | `tomas, keeper` |
| **P10c** | … → What is true | `Tomas is the lighthouse keeper, seventy-two, taciturn, and has never once left the island. He kept a logbook in pencil for forty years and taught Mara to read the tide tables when she was seven.` |
| **P11a** | World → Lore → Add an entry → Place → Title | `The Lantern Room` |
| **P11b** | … → Keys | `lantern, lamp room` |
| **P11c** | … → What is true | `The lantern room at the top of the tower holds the great lamp and a brass telescope on a tripod. Tomas kept a second logbook up there, hidden under the loose tread of the top stair, that nobody but Mara knows about.` |
| **P12** | Composer, C1·5 | `I walk along the shore towards the tower, looking for footprints in the wet sand.` |
| **P13** | Composer, C1·6 | `I stop at the water's edge and say out loud, to nobody, that I am not leaving this island until I have found him.` |
| **P14** | Composer, C1·7 | `I go back to the cottage, light the stove, and sit up with the logbook until it is too dark to read.` |
| **P15** | Composer, C1·8 | `Before I sleep I look up at the tower and try to remember whether the lantern room door locks from the inside.` |
| **P15a** | Composer, the author field on C1·8 | `The door is unlocked, and it has not been unlocked since Tomas left.` |
| **P16** | Scene sheet, chapter 2 (replace the pre-filled text) | `The lantern room, an hour after dawn.` |
| **P17** | Composer, C2·1 | `I climb the last of the stairs, favouring my good hand, and push the door open.` |
| **P18** | Composer, C2·2 | `I look for anything Tomas might have left for me.` |

## When something fails

- **A step in sections 1–4 or 8–10** is a bug: the machinery is what `npm run e2e` is supposed to
  guarantee. Note the step number, what happened instead, and attach the relevant JSON file.
- **A ✗ in the prose rubric** is a note about the model or the default instruction, not the app.
  Try the same prompt on a second model before calling it either. If two models fail the same
  line, the default narrator instruction in `app/src/app/core/defaults.ts` is the thing to look at.
- **A summary that fails the rubric** is worth trying with **Write it again** once, and then worth
  a look at the default fold-in instruction in the same file.
- **A verdict against the premise** in section 11 is the most important result this test can
  produce, and the plan wants to know it before step 4.
