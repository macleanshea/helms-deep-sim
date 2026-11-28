# Engine redesign: notes on the work so far

This is a work in progress. It records the assessment of the battle engine, what has been built, what was
measured, what is known to be broken, and what is planned next. The research report that guided it
(*RTS and Large-Battle AI: A Design Reference*) was used as background, not as a spec.

## 1. Assessment of the engine as it stood

Read top to bottom: `src/sim/sim.js` (unit loop, movement, firing), `warlord.js` (the horde's plan),
`director.js` (wave pacing), `morale.js`, `posts.js` (defender lines of fire), `engines.js` (crewed siege
engines), `support.js`, `flow.js`, `src/scenarios.js`, `src/config.js`, the headless tools and the checks.
Plotted the stock battles top-down over time to see how the two sides actually move.

What is strong already:

- A deterministic, fixed-step, structure-of-arrays simulation with uniform grids, a bucketed-Dijkstra flow
  solver, and good headless tooling (golden hashes, behavior checks, a balance matrix).
- A real command layer for the horde: task forces by lane, objectives by sector, a commander that reads
  what it has *seen* (head counts on the wall, where fire comes from), shield walls, crewed engines,
  captains as morale anchors, and a reserve held for a breach.
- Defenders who respect lines of fire (ranks, kneeling/prone, the parapet, arcs on a wall).

What was wrong, in order of how much it hurt realism and play:

1. **The horde moved as single files, not as a host.** Every attacker followed the one cheapest path of a
   shared flow field. Within 100–150 m of stepping off, a 400-strong formation collapsed into a few
   strings of men a body wide (plainly visible in the plots: long one-dot-wide lines down the valley). That
   is not how a company crosses a field; it also made the horde an unnaturally efficient target for
   machine guns and an unnaturally poor one for shellfire.
2. **Omniscient routing.** The flow field knew every cut in the wire and every gap the instant it opened,
   and sent everyone through it at once. This is exactly the "funnel the whole army through one gap"
   behavior the brief warns about.
3. **Orders took effect instantly** across the whole field (surges, swings to a foothold, the late wheel).
   No captain had to carry them; a leaderless force reacted as fast as a led one.
4. **Waves arrived in driblets.** Step-off times were staggered per formation from a travel-time
   estimate, so in practice companies reached the killing zone one at a time.
5. **The defenders have no notion of a unit.** Each placement is a group; there is no platoon that
   deploys, keeps formation, or acts on its own initiative. Reinforcements from the helicopter land as a
   loose ring of individuals. (Not yet addressed: see section 6.)
6. **Balance was not measurable at the unit level.** The matrix measures whole scenarios only; nothing
   said what a machine gunner or an anti-armor gunner is worth against what, or where.

## 2. The lab: `tools/lab.js`

A test bed for many small battles, run in parallel on worker threads, each on the real map with nobody
giving orders.

- **Settings**: `open` (a line in the open valley, the horde 420 m off), `wire` (the same behind a belt of
  wire), `ramp` (at the head of the causeway, the horde climbing it), `wall` (the center of the Deeping
  Wall, guns in the Deep, the horde with ladders).
- **Sets**:
  - `duel`: 1,200 pts of one defender type against one kind of attack, light and heavy (1x and 2.5x),
    in every setting (1,080 experiments at 3 seeds).
  - `marginal`: a balanced 1,470 pt garrison on the wall, plus 400 pts of one thing.
  - `scale`: 1 to 250 of one type, as a block or a line, against 1.5 times their worth.
  - `threat`: the balanced garrison against equal "threat points" of each kind of attack.
- **Threat points** (`TP` in the file) give each attacker a rough worth so unlike hordes can be compared;
  a defender's worth is its requisition cost. "Stopped" is the share of threat points killed or routed.
- Output: a JSON file of every row in `lab-out/` (ignored by git) and a Markdown summary.

```bash
node tools/lab.js                                   # every set, 3 seeds (1,320 experiments, about 8 minutes on 4 cores)
node tools/lab.js --sets duel --filter wall --md docs/lab/duel.md
node tools/lab.js --one '{"setting":"open","def":[["rifle",120]],"orc":[["uruk",400]]}' --plot out/dir --by company
```

A new option `aimSector` (in `src/sim/director.js`) pins the horde's main effort so a wall experiment
always lands where the garrison stands.

### Baseline results (before any engine change): `docs/lab/baseline.md`

1,320 experiments, 0 failures. Headlines:

| Finding | Evidence |
| --- | --- |
| **The Anti-Armor Gunner never pays.** Worst unit in every setting; wiped out in two thirds of its duels. | Threat stopped per point: 0.27 open, 0.05 wire, 0.41 ramp, 0.34 wall. Its rockets fire only at trolls and engines, so it is helpless against foot. |
| **Rifleman is the weakest infantry per point.** The "cheap, reliable" unit stops about its own worth. | 1.08 open, 1.16 ramp, 1.19 wall vs. 1.4–1.75 for machine gunners, marksmen, grenadiers. |
| **Marksmen are the best value of all**, which is not realistic for a unit of a few rifles. | 1.64 open, 1.75 wire, 1.47 wall; not lost in 94% of duels. |
| **Machine gunners, grenadiers and tanks dominate** anything on foot. | MG 1.58/1.75/1.47/1.37; grenadier 1.55/1.72; tank 1.62. |
| **Mortars and howitzers cannot hold ground alone** (expected: they need a screen), but also stop little per point. | Mortar 1.03 open, wiped out in 58% of duels. |
| **Towers and a heavy foot assault are the real threats** to a balanced garrison on the wall. | Balanced garrison held 1/3 against 2,000 TP of towers and 0/3 against 4,000; 0/3 against 4,000 TP of Uruk-hai. |
| **The `marginal` set as sized gives no information**: the base garrison already wins 100%. | Every addition +0. Needs a heavier attack (planned). |
| **Formation shape barely mattered** to riflemen in the open. | Block vs. line within a few points except at 100+ (line worse, 80% vs 100% stopped). |

## 3. Horde movement: companies in formation (`src/sim/company.js`)

New module, mixed into `Sim.prototype`.

- Large horde formations of Uruk-hai, crossbows, berserkers and warg riders are split into **companies**
  of about 110 (45 for the heavier kinds), side by side and in depth (`_companySplit`).
- A company has an **anchor** (the middle of its front rank), a heading, a frontage and a depth. Each
  soldier keeps a fixed **place** in the box (`fu`, `fv`: across and back, normalized). The anchor walks;
  the men keep station on it (`_formDir`, `_formStep`).
- The box **wheels** no faster than its outer flank can run, **narrows into a column** where the ground is
  narrow and sidles toward the middle of the gap (`_companyWidth`), **closes up** behind locked shields,
  **opens out** under shellfire, and **shrinks** as men fall.
- It **waits for its men**: a roll-call each tick measures how far behind their places they are; a
  company whose front rank is held up (at wire, in a defile) slows and stops rather than leaving them.
- Companies **keep station**: one does not tread on the heels of a company marching ahead of it, and
  the leading companies of a force **dress** on each other so they arrive abreast.
- **Frontage is shared out**: the companies bound for a sector are each given their own stretch of its
  wall, ordered by where they stand across the field so no two cross on the way in (`_assignAims`).
- **Troops seen standing in the open** within 420 m are made for first.
- **Wire is found, not known**: a man in ranks held up at wire looks along it for a gap within a few
  meters (`_gapSeek`) instead of the whole host being routed through the nearest cut.
- Modes: marching, **loose** (every man for himself: within 55 m of the aim, an enemy at hand, inside
  the works, or too few to keep ranks), **standing** (crossbows halted at volley range, 84 m; nobody
  stops to shoot on the march). A loose company re-forms once clear of the fight.
- `canEnter` gained a `raw` flag (the lie of the ground alone, wire ignored) for these geometric tests.

## 4. Horde command (`src/sim/warlord.js`, `director.js`)

- **Forming up.** A wave halts at a forming-up line 470 m short of the works (beyond machine-gun reach,
  and that far from any troops seen out in front), closes up, waits for its towers and rams to be far
  enough ahead to arrive with it, and **steps off together** (`_wlForm`, alert "Horde advancing ·
  sector"). This replaces the per-formation staggered step-off times (`_wlStagger`, removed). Ladder
  crews, trolls and sappers wait at the line with them; engines roll on.
- **Orders take time to arrive** (`_wlSend`): a swing to a foothold, a surge at a silent sector, the late
  wheel, the turn on the Hornburg when the wall is given up all reach a force 6–14 s later through its
  captains, and 45–75 s later if it has no captain left.
- **The horde learns from its losses** (`_wlPosture`): kills beyond rifle range are attributed to bullets
  or blast. Where shellfire did most of it, the next wave comes on in open order and locks shields only
  at 310 m or 200 m instead of 430 m (alert "Horde spreading out under shellfire").
- **Wire the horde has seen** counts against a sector when the main effort is chosen.
- Shield walls also form against troops the company can see in the open, not only near the walls.

## 5. Measurements of the current code

### Behavior checks (`npm run checks`), run with the formation layer before the command changes

21 of 25 pass. Failing:

- **catapults**: share of defender losses to catapult rocks 58% and 52% in two Medium/Hard battles (limit
  50%). Slower contact means the catapults have longer to work before the foot arrives.
- **stuck**: 126 foot soldiers stood still a minute or more with a clear way (limit 150, passes), but the
  longest was 200 s (limit 120). All in the Medium battles: companies waiting on men caught at the wire.
- **deep**: after an immediate fall-back to the keep, 3 of 9 battles never sent a force round for the
  postern. The forces now take the order late.
- **keep** (already open before this work): falling back at once is now an easy win on all three levels.

### Challenge matrix on the current code (`node tools/matrix.js --seeds 2`)

| | No orders | Stand-in commander |
| --- | --- | --- |
| Easy | **won 2/2** (was 0/5), 81% left | won 2/2, 100% left |
| Medium | lost 2/2 | **won 2/2** (was 3/5), 79% left |
| Hard | lost 2/2 | **won 2/2** (was 2/5), 57% left |

First contact at the wall moved from about 0.28 to 0.80 of the night on Easy, and from 0.55 to 0.93 on
Medium with the stand-in. **The challenges are now too easy**: the waves spend too long forming up and
the wall is reached too late. This is the first thing to fix (section 6). Golden hashes are expected to
differ: the rules changed on purpose and have not been re-recorded.

### Tools added

- `tools/plot.js`: top-down PNGs of a headless battle at chosen times, colored by unit type, company or
  morale state, with wire, ladders and breaches. No browser, no dependencies (writes PNG itself).
- `tools/lab.js`: section 2.

## 6. Planned next, and open problems

Horde:

- Shorten the forming-up halt (a time limit tied to the director's schedule, so the last wave still
  lands before dawn) and re-tune wave release so first contact returns to roughly a quarter of the night.
- Wire: companies held at a belt should cut on a frontage (several men abreast) rather than a few, and
  give up their places to the cutters; fixes the 200 s stuck case.
- Crossbows should give real covering fire on the wall while the ladders go up, timed to the assault.
- Feints and a visible reserve; sallies answered.

Defenders (not started):

- **Platoons**: adjacent placements of the same kind merge into a platoon; a platoon deploys into a
  firing line where every man has a line of fire (on the flat, a two- or three-rank line along the
  threat axis; on a wall, the parapet first), and keeps it when moved.
- **Auto and manual modes**: in auto, a platoon chooses its own targets and shifts along a wall or a
  line to cover a threat, plugs a gap, re-arms at the nearest cache, and falls back under a set rule; in
  manual, it holds its ground and fires on what is in its arc.
- Reinforcements land as a **mixed platoon** that forms a line on landing.

Balance (from the lab): make the anti-armor gunner a general-purpose rocket team (high explosive at
foot when no armor is in range) or fold it into the grenadier; raise the rifleman's value (cheaper, or
more accurate at mid range); bring the marksman down; re-size the `marginal` set so it discriminates;
then run the lab again (1,000+ experiments) and record `docs/lab/after.md`.

Challenges: let the player design the garrison against a known horde with a budget (the stock layout
kept as a tutorial and as a reference deployment), measured with the lab's reference deployments.

UI: platoon selection and the auto/manual toggle; README and checks updated; golden hashes re-recorded.
