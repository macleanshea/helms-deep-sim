# Work log: engine redesign

The full write-up of what was built and measured is `docs/engine-redesign.md`; the lab results are in
`docs/lab/`. This log is the running record, newest entry last. A new session reads this first and starts
from **Next**.

## Next

1. **Checks after part 4**: `npm run checks` (full), then `npm run matrix` (about 25 minutes). Golden was moved by
   the station-keeping tie-break (`src/sim/company.js`); re-record with `node tools/golden.js --write` only once the
   checks and the matrix are sound, and log why. The keep check should now report no FREE row.
2. **A browser look** at the lashed ladders (`npm start`, the Siege Train or the Hornburg Garrison, order everyone
   into the Hornburg): the ladder drawn from the valley floor to the parapet, climbers on its rails, and the alerts
   "Lashed ladders up · Hornburg", "Ladder crews approaching · Hornburg" not wrapping.
3. **A search for the Flood**: `node tools/lab.js --search flood --n 30 --seeds 2 --tag search3 --md docs/lab/search3.md`
   (about 25 minutes on four cores), then set its suggested garrison and size as was done for the other two.
4. **Re-run the unit lab** on the final code (`node tools/lab.js --tag after2 --md docs/lab/after2.md`, about
   12 minutes) and compare with `docs/lab/after1.md`.
5. Crossbows: time their volleys to the ladders going up (they halt at volley range, and those at a lashed ladder
   already shoot at the men at its head: `_headTarget` in `src/sim/lashed.js`).

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

### Part 4 (commits 12592d2 to the head of the branch)

- Asked by the owner: let the attackers lash two ladders together to scale the Hornburg's ring wall, so that an
  immediate fall-back is not a free win. Built the jump links in the flow solver, ring ladder feet (19 sections),
  pairing, raising (14 s, 5 hands), climbing (10 s, one man every 2 s, 3% slip), the lashing giving way under four
  or more, throw-down that breaks the ladder, dead ground at the feet, the renderer's lashed ladder.
- Measured: the ladders work where the horde is large (5-14 raised a night on the Hornburg Garrison), but alone they
  did not stop the fall-back being free on the Siege Train (86-88% left against 0-38% holding the wall). A critique
  run found why: the waves kept their wall-assault timetable and crossed the valley one at a time, each ground down
  200-450 m out. The fix: once the wall is seen given up, the warlord calls up a waiting wave every 30 s (90 s left
  the Siege Train free; 45 s was bimodal). Also: the wall judged empty from what the horde has seen, the
  station-keeping tie-break, catapults dropping their stand-off in the final effort.
- Result (seeds 1-3, fall back against hold): no challenge is free; the fall-back loses on the Hornburg Garrison
  (0/3), the Three Hundred (0/3), the Flood (1/3) and the Siege Train (1/3); First Night is still better in the
  Hornburg (95-98% against 60-85%), under the check's 25-point margin. Table in section 9 of
  `docs/engine-redesign.md`.
- Golden moved (7 of 13 battles): the tie-break touches every battle. Not yet re-recorded: waiting on the checks.
- Wire against the Siege Train explained (a generator artifact; section 8).
