# Visual overhaul roadmap

The plan for making the game look far better without losing frame rate: detailed, animated units
and vehicles, and a fortress and valley rebuilt to the proportions of the film-style Helm's Deep.
Work happens on `claude/stoic-ride-l8ozy6`; each milestone ends pushed, with screenshots and a
benchmark run on a real machine. Tick the status column as milestones land.

## What decides things

In order: **frame rate** (smooth at every game speed up to 8x), then **the best picture possible**
(units before environment), then download size (assets must cache on the device), with engineering
effort last.

Decisions already made:

- A perspective, tiltable camera: an overview when zoomed out, swinging toward a near-ground angle
  when zoomed in. Zoom stays the camera's state variable so benchmark views stay comparable.
- The target is desktops and laptops with decent graphics at 60 fps, with detail stepping down
  (and back up) automatically. Phones and tablets are not a target.
- Meshy and Tripo are compared on two units (an Uruk soldier and a warg) before committing to one.
- Generator keys live in the cloud environment's network secrets, never in the repository.
- The map is not assumed right as it is. Every component is rescaled to the references, defects are
  fixed, and a full redesign is acceptable.
- The custom WebGL2 renderer stays. The runtime keeps no npm dependencies, no build step, no wasm.

## What the references ask for

The owner's references are a cutaway concept painting, a film still of the night battle and a
painted miniature (not kept in the repository). Against them, today's map differs like this:

| | References | Today |
| --- | --- | --- |
| The Deep | a tight rock gorge behind the wall | an open field 412 m deep and 472 m across, larger than the wall is long |
| The Hornburg | stacked round walls growing out of the cliff: a lower outer ring, a taller inner drum, rock all round | one ring wall round a flat court beside a slope |
| Horn tower | a slender buttressed tower on a rock spur with an open top | a spired tower at the back of the terraces |
| Great hall | an arcade of arches set into the cliff face | free-standing halls on a terrace |
| Causeway | a short crescent ramp sweeping up to the gate | a 242 m road with a gentle S-bend |
| Stairs | flights built against the inner wall face | free-standing blocks with slab fins standing out of their sides |
| Rock and ground | sheer, craggy grey rock; bare stony ground | smooth slopes with a rock pattern; bright grass |
| Mood | night, rain, mist, torch and fire light | flat moonlight, no sky, no depth haze |

Rules of the game the redesign must keep (from the README and `tools/checks.js`):

- Three ways into the Hornburg: the gate, a weak postern reached from the Deep by the rear ramp,
  and one door from the wall walk. Falling back means defending two short fronts.
- A hidden reserve below the wall is part of every challenge.
- The valley runs west to east with the horde entering from the west; about 800 m of field in front
  of the wall; wall sections 8 to 12 m long; mortars need 60 m and howitzers 150 m to their targets.
- Difficulty targets: with no orders every challenge is lost; the stand-in commander wins Easy
  nearly always, Medium most nights, Hard under half.

Defects the map lint found in today's map, to be put right in milestone 5:

- An arc of the Hornburg's wall east of the door (over the postern) cannot be walked to or from:
  the wall walk does not carry over the door arch and there is no stair on that side.
- The first Deeping Wall section's foot is on the Hornburg's 12 m rock shelf, out of reach of ladders.
- The postern section's "outside" point is classed as cliff (the sim works round it with `rear[2]`).

## Tools for each job

| Job | Tool |
| --- | --- |
| Unit and vehicle models | An AI generator (Meshy or Tripo, after the bake-off), fed concept sheets made with an image model in the style of the paintings in `assets/units/` |
| Clean-up, detail levels, animation baking | Blender, run headless from `tools/assets/` |
| Crowd animation | A baked bone-animation texture played on the GPU: one path for every unit |
| Fortress and layout | Code, from one parametric layout (`src/layout.js`) |
| Rock, stone and ground surfaces | CC0 scans (Poly Haven, ambientCG), shipped as WebP |
| Cliffs | Craggy rock meshed offline from the layout's cliff line |
| Mood | The engine: cascaded shadows, a torch-light map, sky, fog, GPU rain |
| Caching | Content-hashed files with immutable headers, then a service worker |

No generator can make a fortress whose walls line up with the rules (ladders, breaches, the gate,
where troops stand), nor a whole valley. Those are code and texture work.

## Milestones

| # | Milestone | Status |
| --- | --- | --- |
| 1 | Sync with main, baseline and guard rails | done, bar the owner's benchmark table |
| 2 | Layout extraction (no visible change) | 2a done; 2b lands with milestone 5 |
| 3 | Perspective camera and engine foundation | |
| 4 | Simulation decoupled from rendering (still on the main thread) | |
| 5 | Map redesign in greybox, owner signs off | |
| 6 | One animated path for every unit | |
| 7 | Simulation in a worker | |
| 8 | Lighting and atmosphere | |
| 9 | Asset pipeline, generator bake-off, unit production | needs the owner's keys |
| 10 | Fortress art pass | |
| 11 | Cliffs, ground, backdrop | |
| 12 | Caching and polish | |

Budgets are starting targets at 1440p on the owner's machine, to be rebased on the baseline.

### 1. Sync, baseline and guard rails

`tools/shots.js` (fixed-camera screenshots), `tools/maplint.js` (is the map still playable),
`tools/golden.js` (hashes proving a refactor changed nothing), a copyable `?bench` report with
long-frame counts, and the baselines in `docs/baseline/`: behaviour checks (24 of 25 pass, the
known-open one being the free win by falling back at once on Easy), the balance matrix over five
seeds (stand-in commander wins Easy 5/5, Medium 3/5, Hard 2/5; no orders loses all fifteen), the
map's measurements, and the hashes. Still wanted: a `?bench` table from the owner's machine.

### 2. Layout extraction

Done in two steps, so that the first can be proved to change nothing.

**2a, done: every number about this map in one file.** `src/layout.js` now holds the valley rims,
the Hornburg and its ring sections, the Deeping Wall, the causeway and rear ramp, the stairs, the
stream and road, the labels, the horde's lines and lanes (`approach`: where waves appear, where the
reserve waits and a beaten force rallies, the lane split into sectors, the line that counts as "in
front of the wall") and the garrison's places (`posts`: court, guns, reserve, vehicles).
`src/map.js` is built from it, and the presets, the simulation (`sim.js`, `warlord.js`,
`director.js`), the tools and the renderer's shadow box read from it. `npm run golden` is identical
across the map, the fortress mesh and seven whole battles.

**2b, with the redesign (milestone 5): shapes instead of numbers.** What still assumes the present
shape, and must become a question asked of the map rather than arithmetic on the layout:

- the Hornburg as a circle: `KEEP.r` tests for "inside the keep" (`sim.js` `sectorAt`, retreat and
  `_toKeep`; `morale.js`; `warlord.js` `_wlSurvey`; `tools/checks.js`), steering round the ring
  about its centre (`sim.js` `_def`), `alongRing` in `scenarios.js`, the fall-back slots and keep
  sectors binned by bearing, `ringSection` and the terraces in `structures.js`;
- the wall running north-south with the horde to the west: every `approach` line is an x and every
  lane a y; `sectorAt` splits the wall by y; the warlord's "outside" is `x < wallJoin.x + 12`;
  held and beaten forces move along -x; aircraft enter from the east edge (`support.js`);
- ladders climb to the Deeping Wall's height (`segTop[0]`), and the ladder and tower models are
  built for a 12 m wall;
- the postern's approach is `map.rear[2]`, and the door is the only `T.DOOR` cell group.

### 3. Camera and engine foundation

Perspective camera with zoom-linked pitch, ray picking and a boom that cannot pass through rock;
selection, ground rings, health pips, labels and the minimap footprint reworked. In the renderer: an
HDR scene target with the tonemap moved to the composite, a depth texture, a depth pre-pass so the
heavy terrain shader never runs under units, per-instance detail levels by on-screen height,
clip-space culling, a sky, distance and height fog, particles rewritten for perspective. A frame
governor (render scale, detail bias, shadow level) that recovers upward replaces the step-down-only
quality check.

Done when: the benchmark is at or below baseline frame time, draw calls ≤ 220, unit triangles
≤ 2.5 M, no pick error over 0.5 m at any pitch.

### 4. Simulation decoupling

The sim's `fx.*` calls become a recorded event buffer (`src/sim/fxqueue.js`). After each tick
`src/sim/extract.js` writes 48-byte render records per unit, sorted by 16 m cell (position, heading,
type, pose, shield, crew and engine state, clip state), plus a block for the HUD, and keeps a list
of the dying. UI orders go through `src/sim/host.js`. Sim methods stay patchable in Node, because
`tools/checks.js` wraps them. `renderer._fillUnits` becomes cell culling plus a copy.

Done when: golden hashes unchanged, checks pass, no per-frame allocation in the frame loop.

### 5. Map redesign, greybox

New proportions with the Deeping Wall's length as the master dimension. Starting values to settle
with the owner: Hornburg span 0.30 to 0.35 of the wall's length, the inner drum about 2.2 times the
outer wall's height, the horn tower about 3.5 times, a short crescent causeway. The Deep becomes a
narrow gorge: its width shrinks most, its depth as far as re-placed guns and the hidden reserve
allow. The Hornburg's outer wall becomes a curve of sections like the Deeping Wall, so it can take
any shape; the wall walk carries over the door. Stairs become flights against the inner wall face.

Done when: lint and checks pass with no known-and-open map defects, the matrix meets the difficulty
targets, and the owner signs off a top-down view and three perspective views. The layout is then frozen.

### 6. One animated path for every unit

`src/render/anim.js` and a new unit vertex shader play clips from a baked bone texture. Walking stays
locked to distance travelled; other clips are timed from sim time. Clips: idle, walk, attack, climb,
die, kneel and prone with getting up, shield-wall advance and hold, carry a ladder, push an engine,
batter a door, rout. Today's models are ported first (their part ids are already single bones) with
clips made in code. That gives death animations and capped 3D corpses at once, and stays as the
fallback and the far detail level. The cues players read today (pale locked shields, kneeling and
prone men, bare engines with separate carriers) must survive.

### 7. Simulation in a worker

`src/sim/worker.js` behind the host interface, with transferable snapshots (no header or CSP
change) and `?worker=0` to fall back. Done when main-thread sim time is zero and, at 8x on the
30,000-unit benchmark, no frame over 20 ms is caused by the sim. Worst single ticks today are
26 to 39 ms, which is where hitches come from.

### 8. Lighting and atmosphere

Three shadow cascades, with units casting only in the nearest (capped at 400k triangles); a
view-fitted ground-effects map for hundreds of torch lights and crowd blob shadows; baked ambient
occlusion on the fortress; a night sky with moon and lightning; GPU rain. The mood follows the
loading art: cold rain, mist, fire glow. Budgets: shadows ≤ 1.5 ms, post ≤ 1.5 ms, total GPU
≤ 11 ms at high quality with 300 torches on screen.

### 9. Asset pipeline, bake-off, unit production

`tools/assets/` with a manifest (prompts, vendor task ids, hashes) → Blender headless (detail
levels of about 4k / 900 / 250 triangles, at most 32 bones, clips at 30 fps) → `assets/game/` with
content-hashed names. `src/render/assets.js` streams them in with a 2 ms per-frame upload budget
and reports through `window.__loading`; textures are WebP. `vercel.json` gets an immutable cache
rule for `/assets/game/` only (the art already in `assets/` is not hashed). The bake-off is scored
on silhouette at 250 triangles, rig quality under the walk clip, seams, the warg's rig, and cost.
Order of production: Uruks (three bodies), crossbow, berserker, warg; defender infantry; trolls and
captains; vehicles; siege engines, bare and crewed; aircraft. Every unit has a manifest switch back
to its procedural model. Raw generator output (large source models) stays out of the game's tree:
where it is kept is settled when the pipeline is built (a cloud session cannot create GitHub
releases, so the choices are a separate source-assets branch or storage the owner provides).

### 10. Fortress art pass

On the frozen layout: the inner drum, the horn tower on its spur, the arcaded hall in the cliff,
wall detail, leaves for the door and postern, arc-length UVs for real coursed stone, richer rubble.
Budget: ≤ 400k fortress triangles in view.

### 11. Cliffs, ground, backdrop

Craggy cliffs meshed offline in chunks, CC0 rock, scree and mud layers in place of bright grass,
distant mountains. Budget: static scene GPU ≤ 3.5 ms.

### 12. Caching and polish

A service worker (cache-first for `/assets/game/`), `navigator.storage.persist()`, README updated.
Runtime assets capped at 100 MB, about 10 MB before first play.

## Guard rails

Run before and after any change that touches the map or the simulation:

```bash
npm run maplint     # is the battlefield still playable? (a second)
npm run golden      # did anything change? map, fortress mesh and whole battles, hashed (under a minute)
npm run checks      # does the siege still behave? (about ten minutes)
npm run matrix      # is it still balanced? (a few minutes)
npm run shots -- --out /tmp/after --compare /tmp/before   # does it still look the same? (software rendering; several minutes a set)
```

`docs/baseline/shots/` holds JPEGs of each milestone's starting point, for the eye. For an exact
comparison shoot a PNG set from the commit before the change and compare the new set with that:
two runs of the same code agree pixel for pixel.

A change that is meant to alter the map or the rules re-records the references
(`npm run golden -- --update`) in the same commit and says so.

Frame rate cannot be measured in a cloud session (no GPU): open the deployed preview with `?bench`,
press **Copy results**, and paste the table into `docs/baseline/` for that milestone.

Kill switches to keep through the work: `?q=`, and as they arrive `?worker=0`, `?assets=0`,
`?shadows=0|1|2`.

## Risks

- Fill rate on high-resolution screens: the render-scale governor, per-stage GPU budgets in the overlay.
- Crowd vertex and shadow cost: triangle caps applied in the same frame from the cell pre-pass.
- Hitches from uploads and shader compiles: a per-frame upload budget, warm-up behind the loading screen.
- Balance drift from the new map: checks, golden hashes, lint, the README's difficulty targets.
- Main changing under a long branch: merge main at every milestone; land the layout extraction
  early so new sim work stops adding fixed coordinates.
- Generated models falling short: the procedural rigs on the same path remain a complete game.
