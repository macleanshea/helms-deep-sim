# Work log: engine redesign

The full write-up of what was built and measured is `docs/engine-redesign.md`; the lab results are in
`docs/lab/`. This log is the running record, newest entry last. A new session reads this first and starts
from **Next**.

## Next

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
