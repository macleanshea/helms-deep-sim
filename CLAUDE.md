# Helm's Deep — notes for working in this repository

## UI text conventions

These apply to every string a player reads: labels, buttons, tooltips, toasts, alerts, banners, help,
the battle report, and text drawn on the map. New text should match them.

### Principles

- **Concise.** Two lines at most where the text is shown. If an idea needs more, split it or
  reformat it rather than letting it run on.
- **Consistent.** One voice, one tense per kind of text, one name per thing (see the vocabulary).
- **Informative.** Text must earn its place. Nothing that restates what is beside it, no tooltip on
  a control that explains itself, no confirmation of something the screen already shows.

### Rules

- **American English** (armor, center, defense, canceled). This goes for comments and docs too.
- **Sentence case** everywhere. Names of units, commands and scenarios take capitals only where
  they stand as labels (Machine Gunner, Focus Fire, First Night). In running text and alerts they
  are ordinary words ("Uruk captain killed", "costs 4 command points"), except when naming a
  command by its button ("use Focus Fire").
- **Alerts, toasts and banners** are fragments: no end punctuation, no exclamation marks. The form
  is "what happened · where" ("Ladders up · cliff end", "Gate at 50%"). Use a present participle
  for what is under way ("Catapults firing · center") and a past participle for what is done
  ("Wall breached · center"). Color and sound carry urgency, not wording.
- **Sentences** (card descriptions, tooltips, help, the report's subtitle) are full, short, and end
  with a period. Plain words, active voice, imperatives for instructions ("Drag a circle on the
  map."). No "we"; "you" and "your" only where needed.
- **Buttons** start with a specific verb ("Begin battle", "Back to setup", "Edit garrison").
- **Tooltips** only where they add something: a title, the hotkey, and at most two short sentences.
  Never the only place for something the player needs in order to act.
- **Separator:** " · " between the parts of a label or alert. No em dashes in UI strings ("—" is
  only the placeholder for an empty value).
- **Numbers:** numerals, with a space before the unit ("150 m", "40 s", "30 mm"), "pts" for
  requisition, "50%" for shares, mm:ss for clocks, an en dash for ranges ("60–650 m"). Format
  counts with `fmt()`.
- **Hints** (the bar shown while a tool is armed) read "**Name** · what to do · right-click to cancel".
- **What a card shows is not repeated in its description.** Range, blast radius, re-arm range and
  cost appear as indicators on the unit's card; the description says what the numbers do not.

### Vocabulary

| Use | For | Not |
| --- | --- | --- |
| Defenders, Attackers | the two sides, as labels and in stats | |
| garrison, horde | the whole defending force, the whole attacking force | host, the enemy |
| platoon, company | a group of defenders, a group of attackers | |
| formation | a group placed in setup | |
| battery | a group of mortars or howitzers | section |
| wall section | a piece of the Deeping Wall | |
| the Hornburg | the fortress | the keep |
| keep end, center, cliff end, Hornburg | the four sectors named in alerts | |
| ammo | what troops fire; they re-arm at an Ammo Cache or ammo crate | ammunition, rounds |
| rout, routed | troops or the horde giving up | break, flee, run |
| pinned, wavering | the other morale states | suppressed |
| breached | any gate, door, culvert or wall forced open | fallen, broken, blown, down |
| command points, requisition (pts) | the two currencies | |
| support, support call | air strikes, gunships, resupply, reinforcements | strikes |
| fire mode | At will, Hold to 150 m, Hold to 75 m, Hold fire (artillery: Auto, Target, Hold) | fire discipline, stance |
| dawn | the moment the defenders win by holding out | relief |
| Victory, Defeat | the two results | |

"keep end" is the one place "keep" survives: beside the sector "Hornburg", "Hornburg end" was too
easy to misread in the feed.

### Where the text lives

- `src/config.js`: unit names and descriptions, the attackers' tooltip (`note`, `counter`), weapon
  names, support calls.
- `src/scenarios.js`: scenario names and briefs, wave names. `src/score.js`: score lines.
- `src/sim/*.js`: battle alerts (`_alert(...)` and pushed events).
- `src/main.js`: toasts, hints, and labels drawn on the map.
- `src/ui/ui.js`: panels, tooltips, help, settings, the battle report. `index.html`: static labels.

`tools/checks.js` reads alert wording (the surge alert and the sector names): change it with them.
The place names in `src/map.js` are part of the golden hash.

### Checking a change to text

Run `npm run golden` and `npm run checks` (behavior must not move), then look at the text on
screen: wrapping is the usual failure, and it only shows in the browser.

## Working in sessions: keep the work recoverable

A session can fail at any moment and take its uncommitted work with it. Work so that a new session
can pick up exactly where the last one stopped.

- **Open a pull request at the start of a session**, before doing the work (a draft is fine). If the
  session continues earlier work, use that work's pull request instead of opening another.
- **Commit and push to it very often**: after each working step, not at the end of the task. Nothing
  of value should exist only in the container. A commit that leaves a check failing is fine if the
  log says so.
- **Keep a detailed log in the pull request**: `docs/worklog.md` on the branch (newest entry last),
  with the pull request description kept in step with it. Each entry records what was done, what was
  measured, what is broken, and the decisions made and why.
- **Keep a "Next" list at the top of the log**: the exact next steps in order, with the commands to
  run and the files involved, updated before each push. A new session reads `docs/worklog.md` first
  and starts from that list.
