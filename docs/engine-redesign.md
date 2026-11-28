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

## 5. Fixes to the first pass

The first pass (PR part 1) left the horde reaching the wall far too late. Traced with `tools/plot.js` and
small probes of company state:

- **Station-keeping jammed the column.** Uruk companies slowed for the crossbow and berserker companies
  ahead of them, which were themselves held behind the leading Uruk; the whole force crept at 30–40% pace.
  Now companies that are told to trail never hold up the ones they trail, and a follower matches the speed
  of the company ahead instead of stopping behind it.
- **Waves waited for their rams.** The forming-up line waited until towers and rams could arrive with the
  body; a ram is slow, so waves sat for 90 s. The wait is now capped at 45 s (50 s for stragglers): engines
  come up behind.
- **Ladders and their escort deadlocked.** The ladders waited at the forming-up line for the companies, and
  the companies would not get ahead of the ladders. The escort now applies only once the wave has stepped
  off.
- **Ladder crews were shot to pieces at a crawl.** Each replacement carrier held the ladder up 2.5 s.
  Ladders now rush the last 250 m (no shield-wall pace cap, 1.2 s to take hold), and the escort no longer
  holds companies back for a ladder that is rushing.
- **Companies stood at the wire for minutes.** A company held up for 15 s now breaks ranks and its men
  work through on their own (the old `stuck` failure).
- **Rout cascades.** With about four times as many companies, the shock a breaking company gave every
  neighbor (−8 morale within 140 m) swept whole waves away. It is now scaled by the size of the broken
  company against its neighbor.

## 6. Defenders: platoons (`src/sim/platoon.js`, new)

- **Platoons.** At the start of a battle, formations of direct-fire foot placed within 4 m of each other on
  the same level (and the same court of the Hornburg) are joined, up to 80 men. Mortars stay in their
  batteries; commanders stay alone. A platoon shares morale, and a click on any man selects all of it.
- **Firing lines.** A platoon on open ground or in a court is drawn up (before the battle, so the setup
  view shows it) in a line facing the nearest mass of attackers, or down the valley: up to three ranks,
  1.6 m files, each rank offset a third of a file, so every man has a clear lane past the men in front
  (the existing lines-of-fire rules in `posts.js` then give prone, kneeling and standing). 250 riflemen make
  a line about 130 m long rather than a square in which most cannot fire.
- **Moving.** `orderMove` now forms the same line at the destination facing the way the platoon went, or,
  when the point is on a wall walk, lines the parapet nearest the click (front rank first). Men are matched
  to places in order along the line, so nobody crosses his neighbors. Vehicles still form a block.
- **Auto and manual** (`M`, shown in the selection panel). On auto, a platoon:
  - turns its line to face attackers who have come round its flank;
  - on a wall, with nothing to shoot for 10 s, shifts along the wall (25–110 m) to the stretch with the
    most attackers and ladders at its foot and the fewest defenders;
  - in reserve on the ground and idle, moves to a firing position 50 m short of attackers who have got
    inside the works (a foothold, a breach) within 250 m (alert "Reserve moving to engage");
  - below 15% ammo, walks to within re-arming reach of the nearest cache within 300 m, and returns to its
    post when above 80% (alert "Platoon going back for ammo");
  - keeps fire discipline by itself: holds to 150 m below 60% ammo and to 75 m below 30% (the player's
    own fire mode still applies, and the closer of the two wins);
  - goes back to its post after 30 s with nothing to shoot.
  Auto moves cost a path solve each, so the whole garrison is limited to two a second. On manual, a
  platoon holds the ground it was given.
- **Remnants** of a platoon that has lost three men in four join the nearest platoon on their level
  within 30 m.
- **Reinforcements** landed by helicopter are one mixed platoon that forms a firing line on landing.

## 7. Rebalance

From the baseline lab, then checked with `docs/lab/after1.md` (run part-way through these changes) and
the challenge matrix:

| Unit | Change | Why |
| --- | --- | --- |
| Anti-Armor Gunner | With no troll or engine in reach, fires a high-explosive rocket (300 damage, 4.5 m) into a cell of 7+ attackers; 10 rockets instead of 8 | Never paid for itself: 0.05–0.41 threat stopped per point, wiped out in two thirds of its duels. After: 1.3–1.6 (measured with the full warhead, since reduced) |
| Rifleman | Hit chance 0.6 close (was 0.55), 0.21 at full range (was 0.18) | The weakest infantry per point (about 1.1). After: 1.04–1.60 |
| Marksman | 35 pts (was 25); reach 300 m (was 360); 35% at full range (was 75%) | The best value of all, and four of them killed 207 ladder carriers in one battle, out to 400 m at night |
| Wire | A man on foot tears at it two ticks in five, and not at all while his company is pinned; 3 pts a section (was 5) | Companies now meet wire on a frontage, many men at once: wire bought nothing; still poor value in the first search |
| Claymore | 10 pts (was 15) | Poor value in the garrison search |
| Main Battle Tank | 340 pts (was 420) | Strong in the open, but behind the wall it cannot fire over it: the worst buy in both searches |
| Commander | 80 pts (was 120) | His death shakes the garrison; at 120 pts the searches said leave him out |
| Anti-Vehicle Obstacle | Attackers among them are 20–30% harder to hit (was 50%) | It handed the horde cover in the garrison's own killing zone |
| Ladder throw-down | A ladder head held by defenders two to one can still be heaved off, more slowly | With companies arriving in mass, none was ever thrown (0 of 99) |
| Ammo Cache | unchanged | It flips the marginal set from loss to win (+48 to +52 stopped): ammo is the garrison's real limit, and the challenges reward bringing it |

The `marginal` set now uses 5,500 threat points (at 3,000 the base garrison always won, so every
addition read +0).

## 8. Challenges

- The three laid-out challenges stay as the way in (First Night is the tutorial). First Night's horde is
  4,200 (was 3,200): with the new movement the old one was won with no orders given. Their budgets are
  still the cost of the garrison as issued, so they follow the new unit costs.
- Three **Build** challenges are new: the garrison starts empty, the requisition budget is fixed, and the
  horde is known in full (the order of attack is listed wave by wave). Each has a suggested garrison
  (**Load suggested garrison**) that its difficulty was measured with.
  - **The Escalade** (Medium): 7,500 with 30 ladders and many berserkers, no engines. 2,700 pts.
  - **The Siege Train** (Hard): 9,000 with 4 towers, 2 rams, 14 trolls, 8 catapults, 8 sappers. 3,800 pts.
  - **The Flood** (Hard): 11,500 in 4 waves, nearly all on foot, 60 ladders. 4,200 pts.
- `tools/headless.js --garrison ref|rifles|empty` plays a Build challenge with its suggested garrison, the
  whole budget in riflemen, or nobody; `tools/matrix.js` runs all six challenges and passes `--garrison` on.

### Challenge matrix (`node tools/matrix.js --seeds 3`, in `docs/lab/matrix-final.txt`)

| Challenge | No orders | Stand-in commander | Riflemen alone, stand-in |
| --- | --- | --- | --- |
| First Night (Easy) | won 1/3, 0% left | won 2/3, 88% left | |
| The Hornburg Garrison (Medium) | lost 3/3 | won 2/3, 41% left | |
| Three Hundred Rifles (Hard) | lost 3/3 | won 3/3, 38% left | |
| The Escalade (Build · Medium) | lost 3/3 | won 3/3, 100% left | won 3/3, 41% left |
| The Siege Train (Build · Hard) | won 1/3, 0% left | won 2/3, 10% left | won 1/3, 0% left |
| The Flood (Build · Hard) | lost 3/3 | won 2/3, 33% left | lost 3/3 |

A Build challenge is played with its suggested garrison, which is close to the best the garrison search
found, so it is the answer key rather than the yardstick of difficulty; the better yardstick is the share of
random garrisons that hold (section below: 19 of 30 for the Escalade, 12 of 30 for the Siege Train).
Riflemen alone, the naive answer, do clearly worse on all three. First contact at the wall is back to
0.30–0.65 of the night (it had slipped to 0.80–0.93 after the first pass).

### Does the mix matter? The garrison search

`node tools/lab.js --search escalade,siege-train --n 30 --seeds 2` draws 30 garrisons at random within each
Build challenge's budget (how the points are shared between the kinds, how far along the wall the line
runs, how many are kept in reserve, what is laid in front) and fights each on two seeds with the stand-in
commander. `docs/lab/search1.md` and `search2.md` rank them and give, for each kind, the correlation of its
share of the budget with the outcome.

**First search** (`search1.md`): 25 of 30 garrisons held the Escalade and 19 of 30 the Siege Train, so both
were too lenient; the hand-written suggested garrisons were worse than most random ones (they spent heavily
on wire, a tank and claymores). Wire (−0.38, −0.51), claymores (−0.33) and the tank (−0.17, −0.27) paid
least; machine guns (+0.38) and mortars (+0.29) most against the Escalade, grenadiers (+0.48) against
the Siege Train. Changes: wire 3 pts a section (was 5), claymore 10 (was 15), tank 340 (was 420); the
Escalade to 7,500 attackers (2,700 pts) and the Siege Train to 9,000 (3,800 pts); suggested garrisons
rewritten along the lines of the strongest found.

**Second search** (`search2.md`): 19 of 30 hold the Escalade (Medium) and 12 of 30 the Siege Train (Hard);
in both, the best hold with nearly everyone alive and the worst are wiped out by the middle of the night.
The kinds now counter different threats:

| Kind | The Escalade (no engines) | The Siege Train (engines) |
| --- | --- | --- |
| Machine gunner | **+0.43** | +0.15 |
| Ammo cache | **+0.39** | +0.01 |
| Mortar | +0.19 | **+0.36** |
| Howitzer | −0.41 | **+0.42** |
| Marksman | −0.05 | **+0.42** |
| Anti-armor gunner | −0.23 | +0.17 |
| Commander | −0.07 | −0.41 |
| Anti-vehicle obstacle | −0.32 | −0.21 |
| Wire | +0.02 | −0.53 |

Two kinds still read as traps, and were changed after this search: anti-vehicle obstacles gave the horde
standing among them in the garrison's own killing zone half of the protection of a parapet (now 20–30%);
the commander cost 120 pts and his death shakes everyone near him (now 80 pts). Wire on the Siege Train was
explained later: the garrison generator laid at most one belt and threw the rest of wire's points away (176 pts
unspent on average where wire was bought). In paired battles (the same garrison with and without a belt) the belt
is worth more than its price in riflemen (47% of the garrison left against 18%). The generator now lays extra
belts and spends what is left on riflemen.

### Performance

Like for like on the Medium battle's first 700 s, alone on one core: 2.25 ms a step before, 2.64 ms after
(+17%), with the same worst step (52 ms). Profiled: movement, the path solves and the soldiers' own update
dominate as before; the company layer (`_formStep`, `_walkLine`, `_companyThink`) is about 9%.

### Behavior checks (`npm run checks`)

23 of 25 pass after these fixes to the checks themselves: Build challenges are played with their suggested
garrison (they start empty); the catapult share is judged only where the garrison lost twenty men or more;
waiting on purpose (at the forming-up line, or a company's own step-off delay) is not counted as being stuck.
And to the game: a ladder head held by defenders two to one can still be thrown down (with companies
arriving in mass, a fresh climber always reached the top, and none was ever thrown: 0 of 99); firing lines
claim their ground, so neighboring platoons no longer stand in each other's places (up to 9 men had stood
in one 2 m cell).

Still open:

- **keep** (open before this work, and worse now): ordering everyone into the Hornburg in the first second
  wins every challenge for the stand-in commander, with 30–96% left. Without support calls the horde does
  break in (the Escalade: postern down at 377 s, garrison wiped out at 467 s), but air strikes and gunships
  on the crowd at the postern hold it. The horde needs an answer: catapults on the crowded court, sappers
  for the postern first, an assault on the gate and both back doors at once.

## 9. The Hornburg shut: lashed ladders and three ways in

The problem: ordering the whole garrison into the Hornburg in the first second won every challenge for the
stand-in commander. The owner's proposal: let the horde lash two ladders together to scale the ring wall.

**What was found first.** The fall-back is a free win only where it beats holding the Deeping Wall. On the
Escalade it does not (the same garrison and commander win holding the wall with everyone alive). On the
Siege Train it did, by far (about 90% alive against 10%), and on Medium a little. Probes (everyone ordered in at
1 s, with and without the stand-in's support calls) showed why:

- the horde spent most of the night on the empty Deeping Wall: siege towers docked against it, trolls and
  catapults battered it, and the postern was reached only in the last quarter of the night;
- the Hornburg is a superb firing platform: its walk is 21 m up on the rock, its men see over everything,
  every man of the garrison has a parapet, and resupply drops into the court re-arm all of them at once. With
  the stand-in's support calls, about 2,800 of the Escalade's dead fell 100-200 m out, to machine guns and rifles
  on the ring walk; without them the garrison ran dry and the horde broke in;
- the ring wall could not be climbed at all: only the gate, the postern and the door from the wall led in.

**What was built.**

- *Lashed ladders* (`src/sim/lashed.js`, new). The ring stands on the rock: a band of steep rock 7-14 m wide
  lies between its foot and the valley floor, so a ladder must stand 13.5-18 m out and reach 21 m up: 24-26 m,
  two ladders' length. 19 of the ring's sections can be laddered from the valley floor (12 on the valley side;
  7 in the Deep, reached only once the Deeping Wall is breached, since a ladder cannot be carried over it).
  A ladder crew sent for the ring takes a section near its force's objective and calls a second ladder crew to
  the same foot; the two are lashed (the second ladder's timber goes into the first, its carriers back to the
  fight) and heaved up: 14 s and five hands, against 4 s for a ladder. A pair is formed only from ladders that have
  hands to carry them (two or more), within 90 m of each other, of the same force first; the two are carried in
  together, each by the path to its own foot. A ladder left with fewer than two hands for 20 s gives up its pairing
  and its stretch; a mate that is not closing is given up after 45 s. Men climb it one at a time, a man every 2 s,
  10 s up (4 s on a ladder), and 3% of them lose their footing on the way. With four or more on it, each man who
  steps on risks the lashing giving way (5% for each man past three). Defenders lever it off its hooks at half the
  speed of a ladder, and it breaks apart: it is not raised again. Only a near hit breaks its timber.
- *Dead ground at the foot of the rock*: men on the ring walk shooting down at the feet of the ladders hit half as
  often. Crossbows halted near a foot shoot first at the defenders standing at the head of their own ladders.
- *Path links between cells that are not neighbors* (`src/sim/flow.js` `jump`): the foot of a lashed ladder,
  on the valley floor, leads to the wall walk it leans on, across the rock. Only the horde's climbing path
  fields carry them. A man at the foot whom the rock stops starts up the ladder.
- *Three ways in at once* (`_keepSecs` in `src/sim/warlord.js`): when the Deeping Wall is given up, the
  northern force goes over the empty wall and through the Deep for the postern and the door from the wall, the
  middle force goes up the valley side of the ring with lashed ladders (a new objective; its companies make for
  the feet their own ladders are bound for, and its crossbows halt 80 m short to cover them), the southern force
  goes for the gate with the ram. Lashed ladders standing against the ring are a way in for every force bound for
  the back doors.
- *No more battering an empty wall*: with the Deeping Wall given up, trolls go with their forces for the
  Hornburg's doors, and the catapults' battering mission is the postern, then the gate. In the final effort the
  catapults give up their stand-off from the rockets.
- *The wall judged empty from what the horde has seen* (`_wlSurvey`): two or more sectors looked at in the last
  30 s and next to nobody on any of them, for 10 s. (It used to count the whole garrison, wherever it stood.) Once
  given up, the wall is taken back only when a quarter of the garrison's infantry has stood on it for 30 s.
- *The reserves called up* (`_director` in `src/sim/director.js`): once the wall is seen given up, a waiting wave is
  called up every 30 s, so the waves reach the Hornburg close together instead of one at a time on the
  wall-assault timetable. This was the largest single effect (found by a critique run in a workflow): the waves
  had been crossing the valley alone, each ground down 200-450 m out before the next arrived.
- *Station-keeping tie-break* (`_companyThink` in `src/sim/company.js`): two companies converging, each seeing the
  other ahead of it, both crawled at the floor pace; now the one further ahead leads. This touches every battle
  (golden re-recorded).
- *The keep check asks the right question* (`tools/checks.js keep`): falling back is a free win where, on the
  same seeds, it wins every night, at least as often as holding the wall, and with a quarter or more of the
  garrison more left.

In the browser (`docs/lab/lashed-near.jpg`, `lashed-mid.jpg`): the lashed ladder stands from the valley floor to
the ring's parapet, the lashing at the joint, the men climbing on its rails.

**Measured** (stand-in commander, seeds 1-3, the garrison ordered into the Hornburg at 1 s, against the same
garrison holding the wall; `scratchpad` runner equivalent to `npm run checks keep`):

| Challenge | Fall back: won, left | Hold the wall: won, left |
| --- | --- | --- |
| First Night | 3/3, 95-98% | 3/3, 60-85% |
| Escalade | 3/3, 60-78% | 3/3, 88-92% |
| Siege Train | 1/3, 0-65% | 1/3, 0-38% |
| The Hornburg Garrison | 0/3 | 2/3, 29-48% |
| The Three Hundred | 0/3 | 2/3, 9-29% |
| The Flood | 1/3, 0-20% | 2/3, 14-39% |

Before these changes the Siege Train fall-back won 3/3 with 86-88% left. Falling back at once is now a gamble
that loses against the large hordes (where lashed ladders go up: 5-14 a night on the Hornburg Garrison, with 14-76
men up them) and is no longer free anywhere; First Night (a short night against a small horde) is still better in
the Hornburg, by less than the check's margin. Against the stand-in's support calls the ladder crews of the smaller
hordes are still cut down in the open: there the Hornburg falls through the postern and the door from the wall.

## 10. Still open

- Crossbows halt at volley range but do not yet time their volleys to the ladders going up.
- Feints and a visible reserve for the horde; answering a sally.
- The `rifles` yardstick and the behavior checks are reported in the pull request.
