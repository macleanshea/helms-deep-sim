# Work log: engine redesign

The full write-up of what was built and measured is `docs/engine-redesign.md`; the lab results are in
`docs/lab/`. This log is the running record, newest entry last. A new session reads this first and starts
from **Next**.

## Next

0. **In progress: lashed ladders** (`src/sim/lashed.js`, the ladder case in `Sim._orc`, `_throwCheck` in
   `src/sim/engines.js`, field `F_RING` in `src/sim/warlord.js`, jump links in `src/sim/flow.js`). Working: ring
   feet found (19 sections), ladders pair, are lashed, go up, are climbed and thrown down. Not yet enough: with the
   stand-in commander the horde dies 100-200 m out from the ring before it gets there (machine guns and rifles on
   the ring walk, kept in ammo by resupply drops). Not yet drawn by the renderer. Check with
   `node <scratchpad>/keep2.mjs escalade auto 1` (a probe: everyone into the Hornburg at 1 s).
1. **The keep is a free win** (`npm run checks keep` reports it OPEN). Ordering everyone into the Hornburg in
   the first second wins every challenge for the stand-in commander. Make the horde answer it, then rerun the
   check: catapults onto the crowded court (`_catTarget` in `src/sim/sim.js`), sappers sent for the postern
   first (`R.SAPPER` in `_orc`), the gate and both back doors attacked at once (`_keepSecs` in
   `src/sim/warlord.js`). Watch it with the probe pattern in section 5 of `docs/engine-redesign.md` or
   `node tools/plot.js`.
2. **Wire against the Siege Train** reads −0.53 in `docs/lab/search2.md` and is not explained. Run
   `node tools/lab.js --one '{"setting":"wall", ...}' --plot out` with and without a wire belt against a
   towers pack, and look at what the towers and their troll crews do at the belt.
3. **A search for the Flood**: `node tools/lab.js --search flood --n 30 --seeds 2 --tag search3 --md docs/lab/search3.md`
   (about 25 minutes on four cores), then set its suggested garrison and size as was done for the other two.
4. **Re-run the unit lab** on the final code (`node tools/lab.js --tag after2 --md docs/lab/after2.md`, about
   12 minutes) and compare with `docs/lab/after1.md`; `after1` was taken part-way through the rebalance.
5. Crossbows: time their volleys to the ladders going up (they halt at volley range already: `F_STAND` in
   `src/sim/company.js`).

## Entries

### Part 1 (commit 5bd9292, pull request macleanshea/helms-deep-sim#14)

- Assessed the engine; built `tools/lab.js` and `tools/plot.js`; recorded a baseline of 1,320 experiments
  (`docs/lab/baseline.md`).
- Horde companies in formation (`src/sim/company.js`); forming up, delayed orders, posture learned from
  shellfire (`src/sim/warlord.js`).
- Left broken: the horde reached the wall far too late, so every challenge was too easy; three checks failed.

### Part 2 (commit 60a31ac)

- Fixed the late horde: a station-keeping jam, the wait for rams, a ladder and escort deadlock, ladders
  crawling under fire, companies stuck at the wire, rout cascades.
- Defender platoons (`src/sim/platoon.js`): joining, firing lines, line-forming moves, auto and manual (`M`),
  remnants, reinforcements as a platoon. UI: a click selects the platoon; the selection panel shows the mode.
- Rebalance from the lab (anti-armor, rifle, marksman, wire cutting); three Build challenges with a
  suggested garrison; difficulty measured with the matrix.

### Part 3 (commit d117c1f)

- Garrison search (`tools/lab.js --search`): random garrisons within a Build challenge's budget. Showed the
  hand-written suggested garrisons were poor and the challenges lenient; tuned costs (wire, claymore, tank,
  commander), obstacle cover, horde sizes and suggested garrisons from it (`docs/lab/search1.md`,
  `search2.md`).
- Checks: 24 of 25 pass (keep open). Golden hashes re-recorded; they reproduce.
- Decision: a Build challenge's suggested garrison is the answer key, close to the best found; its
  difficulty is the share of random garrisons that hold (Escalade 19 of 30, Siege Train 12 of 30).

### Part 4 (in progress)

- Asked by the owner: let the attackers lash two ladders together to scale the Hornburg's ring wall, so that an
  immediate fall-back is not a free win. Built the jump links in the flow solver (inert until used: golden
  unchanged), ring ladder feet, pairing, raising (14 s, 5 hands), climbing (10 s, one man every 2 s), the lashing
  giving way under four or more, throw-down that breaks the ladder.
- Measured: without support calls the horde takes the Hornburg (Escalade seed 1, garrison wiped out at 500 s;
  two lashed ladders raised and thrown down). With the stand-in commander it does not even reach the walls: most of
  the horde dies 100-200 m out, to machine guns and rifles on the ring walk. A workflow (keep diagnosis, wire, the
  renderer's ladders, a code audit, then a critique of the design) is running.
