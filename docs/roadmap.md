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
- Models come from Meshy. (A comparison with Tripo was planned and then dropped by the owner: go forward with Meshy alone.)
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

Defects the map lint found in the map as it was, all put right in milestone 5:

- An arc of the Hornburg's wall east of the door (over the postern) cannot be walked to or from:
  the wall walk does not carry over the door arch and there is no stair on that side.
- The first Deeping Wall section's foot is on the Hornburg's 12 m rock shelf, out of reach of ladders.
- The postern section's "outside" point is classed as cliff (the sim works round it with `rear[2]`).

## Tools for each job

| Job | Tool |
| --- | --- |
| Unit and vehicle models | Meshy (image to 3D, remesh, rigging, its animation library), fed concept sheets made with an image model in the style of the paintings in `assets/units/` |
| Detail levels, gear, animation baking | `tools/assets/` in plain Node (its own triangle reducer), with Pillow for textures: nothing to install |
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
| 2 | Layout extraction (no visible change) | 2a done; 2b (shapes instead of numbers) still to come: the redesign kept the round Hornburg and the north-south wall, so it was not needed yet |
| 3 | Perspective camera and engine foundation | camera, per-unit detail, haze and sky done; HDR, depth pre-pass and the frame governor to come |
| 4 | Simulation decoupled from rendering (still on the main thread) | effects queue done; render records and the order host to come |
| 5 | Map redesign in greybox, owner signs off | redesigned, lint and balance on target; **the owner's sign-off against the references is wanted** before the layout is frozen |
| 6 | One animated path for every unit | the skinned path exists and the Uruk-hai use it; the built-in models still have their own |
| 7 | Simulation in a worker | |
| 8 | Lighting and atmosphere | |
| 9 | Asset pipeline and unit production | pipeline done; Uruk-hai in game; the rest of the roster to come |
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

**3a, done.** `src/render/camera.js` is a perspective camera whose pitch follows the zoom (about 56
degrees with the whole valley in view, about 19 with a platoon filling the screen); `zoom` is still
the state variable, so benchmark and screenshot views carry over. It aims at whatever stands at the
centre of the view (a wall walk, the court) and lifts itself clear of the mountainsides. Middle-drag
or PgUp/PgDn tips it. The renderer picks each unit's level of detail from its own size on screen,
culls against the view, and pulls every level in when a view would pass the unit triangle budget;
far ground fades into a haze that starts beyond the point of interest, under a sky. The overlay's
ground rings are drawn in perspective. `npm run uicheck` proves a point projected to the screen is
picked again within 0.1 m at every zoom, heading and tilt, and that a box drawn in battle selects
the defenders inside it. Still wanted: the owner's `?bench` table for this stage against the baseline.

The draw order now lays down the depth of the ground and fortress first, then draws units, then
shades the ground and fortress only where they still show, so the terrain's costly shader never
runs under a soldier, behind a wall or beyond a ridge. Pictures of this stage are in
`docs/progress/m3-camera/`, beside the starting point in `docs/baseline/shots/`.

**3b, to come.** An HDR scene target with the tonemap moved to the composite (with the lighting
work, where it pays), and a frame governor that scales resolution and detail to hold 60 fps and
recovers upward. Both want the owner's benchmark numbers first: the baseline, and this stage.

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

**Done so far:** the battle reports its effects to `src/sim/fxqueue.js`, a recorder with the twelve
calls the simulation makes; the frame loop plays the queue on the real effects after stepping. The
pictures are identical to calling them directly.

The sim's `fx.*` calls become a recorded event buffer (`src/sim/fxqueue.js`). After each tick
`src/sim/extract.js` writes 48-byte render records per unit, sorted by 16 m cell (position, heading,
type, pose, shield, crew and engine state, clip state), plus a block for the HUD, and keeps a list
of the dying. UI orders go through `src/sim/host.js`. Sim methods stay patchable in Node, because
`tools/checks.js` wraps them. `renderer._fillUnits` becomes cell culling plus a copy.

Done when: golden hashes unchanged, checks pass, no per-frame allocation in the frame loop.

### 5. Map redesign, greybox

**Done, awaiting the owner's eye.** What changed, with the Deeping Wall's length (382 m) as the yardstick:

| | Before | Now |
| --- | --- | --- |
| The Deep | 13.1 ha, 412 m deep, up to 472 m across: a field wider than the wall is long | 8.3 ha, 348 m deep: a funnel that closes from the wall's width to 140 m across by 200 m back, then a ravine of about 90 m |
| Causeway | 242 m with a gentle S-bend | a 180 m crescent sweeping out from the gate and round to the north |
| Inner keep | halls on two terraces | a round drum 27 m above the court on the upper terrace, with the wall's own battlements |
| Horn tower | a 12 m-radius spired tower behind the terraces | a slender buttressed tower (7.5 m radius, 90 m) on the middle ward toward the Deep |
| Great hall | free-standing | an arcade of arches against the cliff on the middle ward |
| Stairs | free-standing blocks with slab fins | flights flush against the inner wall face, one sloping parapet on the open side |
| Wall over the postern | could not be walked to | a third court stair reaches it |
| Wall foot on the rock shelf | counted as a place for ladders | not a usable section |
| Wall half sunk in the cliff | could be stood on, not reached | every ring section is wall from end to end or rock from end to end |
| Ground | bright pasture | thin grey-green turf with bare stone showing through |

`npm run maplint` passes 8 of 8 with nothing known and open; measurements are in
`docs/progress/m5-map/maplint.txt` beside the pictures, the balance matrix and the checks. Over five
seeds the stand-in commander wins Easy 4/5, Medium 4/5 and Hard 2/5, and no orders loses all fifteen
(the targets: nearly always, most nights, under half). The golden hashes were re-recorded for this layout.

Kept as they were, deliberately: the Hornburg's footprint (a 72 m ring) and the Deeping Wall's line,
so every rule of the game still holds; the guns' places 230 to 280 m behind the wall, which is what
stops the Deep being cut shorter. Not yet done, and left for the art passes (milestones 10 and 11):
the Hornburg growing out of sheer crags rather than standing on a smooth shelf, coursed stone,
craggy cliff meshes.

**Wanted from the owner:** a look at `docs/progress/m5-map/` (`whole-map`, `hornburg-from-the-valley`,
`hornburg-from-above-the-deep`, `the-deep-from-the-wall`) against the references. Proportions are
cheap to change now (they are numbers in `src/layout.js`) and dear once the art is built on them.

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

### 9. Asset pipeline and unit production

**The pipeline, done.** How a unit gets from an idea into the game:

1. A concept sheet: `tools/assets/concepts/<unit>.prompt.txt` given to an image model together with the
   unit's portrait from `assets/units/`, asking for the whole figure in a neutral pose on a plain
   ground, with empty hands (gear is added in step 5). The sheets are kept beside their prompts.
2. Meshy, through its CLI: image to 3D (30 credits), remesh to 10,000 triangles (5), rigging (5,
   humanoids only; it comes with walk and run), and clips from its library (3 each).
3. `node tools/assets/import.js <unit>` takes the downloads (about 16 MB a clip, kept out of the
   repository in `assets-src/`) into `tools/assets/src/<unit>/`: mesh, colours and bone motion, a few MB.
4. `tools/assets/units/<unit>.json` is the recipe: height, levels of detail, gear, and where it came from
   (Meshy task ids).
5. `node tools/assets/build.js <unit>` writes `assets/game/<unit>.<hash>.bin` (four levels of detail,
   every clip baked to bone matrices at 30 fps) and a 512 px WebP, and lists them in
   `assets/game/manifest.json`. Gear (a blade, a shield, a crossbow, a club) is plain boxes bound to one
   bone each. `node tools/assets/generate.js <unit>` runs steps 1 to 5 in one go, keeping every paid
   task's id so that a second run never pays twice.
6. The game loads the manifest after start-up (`src/render/assets.js`); a unit with a pack is drawn by
   the skinned path, one without keeps its built-in model. `?assets=0` turns the packs off.

In the renderer each soldier picks a clip from what he is doing (idle, walk, run, behind shields,
carrying a ladder, pushing an engine, climbing, striking) and keeps his own place in his stride; the
dead play a fall and lie where they end it, the oldest 2,500 as models and the rest as the ground
marks there always were. Cost on the garrison battle's views, unit triangles with the built-in models
against with the Uruk pack: 575k against 1,080k at zoom 5, 620k against 869k at zoom 16, 375k
against 1,013k at zoom 60, all inside the 2.5 M budget.

**Still to do for the Uruk:** a second and third body, the texture's normal map, blending between
clips, frames interpolated at the closest level.

**In the game so far:** Uruk-hai, crossbow Uruk, berserker, captain, sapper and troll, each from its
own concept sheet (`tools/assets/concepts/`), generated end to end by `node tools/assets/generate.js
<unit>` (about 50 Meshy credits a unit; the six cost 350 in all, with the first unit's trials).

**The rest of the roster,** in this order: the warg (modelled already, `tools/assets/concepts/warg-side.jpg`, but
Meshy rigs only humanoids: it needs bones assigned by region in the build, and its rider); defender infantry;
vehicles and siege engines (rigid parts, a bone each); aircraft.

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
npm run uicheck     # does pointing at the picture still find the right place and the right soldiers? (three minutes)
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
