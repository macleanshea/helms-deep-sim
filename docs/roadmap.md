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
| 9 | Asset pipeline and unit production | pipeline done; every soldier, beast and vehicle in the game has a model (seven kinds of the horde, ten of the garrison); siege engines and aircraft to come |
| 10 | Fortress art pass | |
| 11 | Cliffs, ground, backdrop | the mountainsides are cut into ledges, sheer rises and gullies; the ground is stonier; scanned surfaces and distant mountains to come |
| 12 | Caching and polish | models are kept on the device (`sw.js`) and load with no connection; the rest to come |

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

### 5b. The fortress works the way it is drawn

After the owner played the preview: towers could be walked through and not stood on, the inner ward was solid
rock, a drag along a wall dropped men behind and below it, the postern was askew to its ramp, court stairs
stopped short of the terrace, the culvert was barred on one face, and the horde walked over the causeway's
parapets. Every one was the same fault: the picture and the rules were made from different numbers. Now
**whatever stands in the Hornburg is declared once, in `src/layout.js` and `src/map.js`, and the mesh
(`src/render/structures.js`) is built from that**.

- **Three courts.** `t1` is the inner court on its drum (23 m), `t2` the upper court against the cliff (31 m):
  court cells at their own heights (`map.tier`), joined by curved flights that hug the drums (`stairs.tiers`,
  the same entries the mesh draws). A group stays on the tier it was put on; firing positions, move orders and
  shortcuts keep to one tier; a shot passes over a drum only if the line clears it. The fall-back still musters
  in the outer court and on the ring wall. Nothing on wheels or tracks goes up the stairs.
- **Bastions and gatehouse.** The drawn-only turrets are gone. Four bastions swell out of the ring wall and two
  platforms flank the gate, all level with the wall walk and part of it: stood on, walked onto, solid from below.
- **Roadways have sides.** Between a roadway cell (the causeway, the rear ramp) and the ground beside it the
  step limit is `WAY_STEP` (0.9 m) instead of 3.3: they are entered at the foot and at the gate. Side crossings
  in a ten-minute battle fell from about 690 to 3.
- **Openings square to their ramps**: each ramp runs straight out from the wall's face for `lead` metres first.
- Culvert arch and grate on both faces; the houses are gone; a man beside a stair is drawn on the ground, not
  floating at the stair's height; scraps of court nobody could reach are solid.
- **Placing troops** (`src/main.js placement()`, `scenarios.js wallPoint/runPositions`): pointing at a wall walk
  locks onto it; a drag mans it along its curve however far the pointer strays, front rank at the parapet,
  facing out; off the walls a block or line stays on the level it was started on. Alt places freely.
  `tools/uicheck.js` drags along both walls with a 60 to 70 px overshoot and clicks on each court.
- The scenario list no longer prints the best score after the name; it has its own "Best 198" label.

Measured on these rules (`docs/progress/fortress-rules/`): map lint 8 of 8; stand-in commander wins Easy 4/5,
Medium 5/5, Hard 2/5, no orders loses all fifteen (the horde wins as fast as before); behaviour checks 24 of
25 with `keep` open as before. The `deep` check's head-count was loosened, with the reasoning beside it: with
walled roadways the southern companies go round the causeway's foot and fewer are in the Deep at one moment.

### 5c. Fortress art and firelight, first steps

- **Stone.** The ashlar layer is half-metre courses whose blocks each have a length of their own, with ragged
  joints, knocked corners, the odd replaced stone and broad stains across many blocks; paving is worn
  rectangular flags. Battlements are a plain breast wall with broad merlons under weathered copings whose rhythm
  runs on along the wall; a few are broken. (`src/render/materials.js`, `structures.js battlement()`)
- **Watch fires.** `structures.js torchSites()` lists braziers along the wall walks, on the bastions and
  gatehouse, round the inner courts and at the stair feet. `Renderer._bakeTorches()` turns the list into a small
  map (how much firelight reaches each place, and how high the fires burn) which the shared lighting code reads
  by position: stone, ground and soldiers are all lit by it for one texture read. Faint by day, most of the light
  there is at night. Pictures: `docs/progress/fortress-art/`.

- **After the owner's second look:** a roofed gallery over the postern and the wall door as well as the gate; every
  stair's landing closed across its far end to the wall; the hall's arches rebuilt as real openings (piers, round
  heads, a room behind lit from the floor up or left a dim hollow) with the hall's body run back into the mountain
  and rock lumps closed round its front; night mist lying low in the valley; stair treads no longer striped.

- **After the third look:** ramps meet their doors and the ground without a gap; the hall stands clear of the rock
  with every upper arch lit; the stream runs down the valley; ammunition caches may stand on the upper courts.
  The horde's torches light the ground and the ranks round them: each frame the torch-bearers in view are
  splatted into a second small map (`Renderer._bakeHordeTorches()`), which the same lighting code reads. Many
  torches together saturate instead of adding without end.

- **Stone round the curve, and shade at the foot.** Round walls (the ring, both inner courts, the horn tower)
  take their stone by arc length about their own centre (`uRound` in the fortress shader), so courses no longer
  stretch and break every eighth of a turn. The watch-fire map's two spare channels now hold how closed in each
  place is by what stands round it and the height of its floor; the shared lighting code dims the sky's light
  (and a little of the moon's) by it, most at the floor and less with each metre above: wall feet, court corners
  and stair wells sit in shade. One more texture read a fragment.

- **A sculpted horn tower, in the game's own stone.** The tower is the generator's shape (35 credits), but only
  its shape: `tools/assets/prop.js` keeps places, normals, triangles and how light or dark the sculptor painted
  each place (windows, joints, hollows), 106 KB in all. `structures.js sculpted()` sets it on the tower's footing
  at the height the layout gives and lays the fortress's stone over it, so it is as sharp as the walls beside it
  at any zoom and its courses run round the shaft. It arrives with the unit models (`manifest.props`); until
  then, and if it fails to load, the built-in tower stands. The rules are unchanged: the footprint was already
  solid. The same path will take the hall front and the gatehouse.

**Still to do toward the references:** painted stone textures, the square gatehouse's hoarding and deep arch and
the two-tier hall front as sculpted pieces by the same path, rock outcrops under the walls, more dressing
(barrels, carts), an HDR pipeline, rain as particles. Lightning already lights by
direction (it raises the moon's light and the sky's, and shadows fall with it). A moon in the sky was tried and
taken out: the game's camera never lifts far enough to show sky.

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

**In the game so far:** on the horde's side Uruk-hai, crossbow Uruk, berserker, captain, sapper and troll;
on the garrison's the rifleman, machine gunner, marksman, grenadier, anti-armour gunner and commander. Each
comes from its own concept sheet (`tools/assets/concepts/`), generated end to end by `node
tools/assets/generate.js <unit>` (40 Meshy credits for a rigged model, 3 a clip; about 700 spent in all,
trials included).

The defenders hold a weapon the build gives them (`gear` kinds `rifle`, `mg`, `sniper`, `launcher`, `tube`:
boxes that lie in the right hand along the line to the left hand in the aiming frame) and stand as their
posts tell them: upright with the weapon up, kneeling at the parapet, prone in the open. Meshy's library
has no held aim, so those stances are cut out of longer actions by the recipe (`derive`: the last
moments of "Kneeling Reload" and "Prone Reload", the first of "Walk Forward While Shooting", played there
and back). Clip ids that were bought, looked over and not used are listed under `tried` in
`tools/assets/units/rifle.json`. Meshy's preview pictures cannot be reached from the cloud session
(`cdn.meshy.ai` is not an allowed host); a clip is judged by buying it for 3 credits and looking at it in
the game.

The mortar gunner is the rifleman's body (`"use": "rifle"`) with a mortar that has a bone to itself: it
stands beside him while he serves it and when he falls, and rides on his back when he moves.

The warg rider is two models in one. Meshy rigs only two-legged figures, so the warg's skeleton (twelve
bones, placed by the recipe as shares of its length and height) and its clips (idle, walk, gallop, lunge,
death: a few sines each) are made by `tools/assets/quadruped.js`; the rider is the Uruk's figure set
astride in one fixed pose by `tools/assets/rider.js` and fastened to the bones of the back, the two
textures side by side in one picture. Trolls and wargs now lie where they fall, as the soldiers do.

The tank, the fighting vehicle and the howitzer are machines: one shell from Meshy with no parts, so
`tools/assets/rigid.js` makes the turret out of whatever stands above a height the recipe gives (and, for
the fighting vehicle, within reach of the turret's middle, so the aerials at the back stay put); the
triangles that straddle the two go with the turret as a skirt. The turret's one clip is a full turn in
180 frames, and the game picks the frame from the angle between gun and hull. A machine is sized by its
`length`, and earns each level of detail from as much further off as it is bigger than a man. Their
finest level is the generator's own 10,000 triangles: the reducer scrambles the texture of a hard-edged
model (its texture is cut into thousands of islands), which shows close up and not at the lower levels'
distances. About 810 Meshy credits spent in all so far.

Far off, a soldier's model is washed toward his side's colour (cyan for the garrison, amber when out of
ammunition, red for the horde, pale steel behind locked shields), as the built-in figures were tinted.
Pictures of the new models are in `docs/progress/m9-units/`.

**Rough edges since put right:** a machine's lower levels now give each triangle one colour (that of its first
corner) instead of smearing the texture across its many small islands, and a deck is laid on the hull under the
turret so nothing shows through when it turns. **Still rough:** the warg's rider sits in one fixed pose; the image
model refused the first wording of the howitzer's concept and took a plainer one.

**A picture of its own for every level of detail.** The generator cuts each figure's texture into about a
thousand small islands. Reduce the triangles and most survivors have corners on two or three islands, so the
picture between them is a smear: a troll seen close was covered in shards, and every soldier a little.
`tools/assets/rebake.js` now gives each level a layout of its own (flat patches seen along the axis their
triangles face, packed side by side) and paints the original picture into it from the nearest point of the full
model. One image holds all four levels: the finest in a square on top, the rest in a band beneath, the gear's
swatches in the band's corner. Vertex counts fell too (a place is now split only where two patches meet).
Machines are painted the same way (their turret and hull kept apart where they meet), which replaced the flat
facets their lower levels had: a siege tower seen from across the valley is hides and timber, not confetti.
Before and after: `docs/progress/units-repaint/`.

**The side tint is by zoom alone.** It used to follow each unit's own distance from the camera, which in a
tilted view painted the far half of a block red and left the near half plain. Now one figure for the whole
view: none closer than 5.5 px per metre, full by 2.6.

**Trolls take the stairs.** A size rule barred them from every stair and stair head, so they stood at the foot
of the courts' stairs. Big units now use stairs like anyone (ladders still not); engines and vehicles cannot.

**Siege engines.** The ram, the catapult and the siege tower are generated models now (105 credits; about 910
of 3,100 spent in all). The image model refused the ram's first concept wording and took it described as a
museum reconstruction. `tools/assets/rigid.js` gained a moving part cut out by a box: the catapult's arm whips
up and over about its axle and is wound back (`arm`), the ram's log draws back and lunges (`slide`); both play
as the engine's "attack" clip. The tower is squeezed to three-quarters of the width the generator gave it and
made 18 m tall, so that its boarding bridge lies on the Deeping Wall's parapet where the rules dock it (4.6 m
from the wall's face). Its bridge is always down. Crews are still the soldiers who push them. Pictures:
`docs/progress/engines/`.

**Aircraft.** The strike jet, the cargo aircraft, the gunship and the transport helicopter are generated models
(140 credits), drawn by name from the same packs as the units; a helicopter's rotor is the machine builder's
turning part with no deck under it. The transport was asked for with one rotor so that it could turn.

**After the owner's fourth look** (pictures in `docs/progress/third-look/`): whether soldiers are dots or figures
is now one choice for the whole view, by zoom, like the tint (taken unit by unit it split a block in a tilted
view; the triangle budget's bias still moves the change closer in under load); the siege tower keeps 7,000,
3,500 and 1,200 triangles at its lower levels (its hides fell apart below that); a formation's box and its range
rings fit where its units actually stand; place names fade out between 4 and 6.5 px per metre; the stream is
gathered to the culvert arch's width at the Deeping Wall; banners stand along the Deeping Wall, every sixth
section; and the ground is repainted toward the film's valley: bleached tawny tussock over pale grey river
gravel, cooler slate rock, a cooler daylight.

**Battlements as built, and stances held.** Men posted on the Hornburg's wall stand a pace inside the parapet
that is actually there: where a bastion swells out they line its curve and fill it rank behind rank
(`scenarios.js parapetAt()`, used by the presets and by a group dragged along the wall; the group's outline bulges
with it). A defender standing, kneeling or prone holds one settled frame of the action instead of looping a
few: the standing stance had been the first steps of a walk, so men shuffled on the spot, and the phases ran
along a rank as a wave. `tools/assets` picks the frame by measurement (both feet down and least travel for the
standing aim; low and still for the other two).

**Wire and obstacles (rules).** The horde used to wade through wire at a crawl, and its paths priced a wired
cell at three times open ground, so it queued in files through whatever gaps there were. Now: a belt of wire
or a row of obstacles is one piece in every 4 m cell its drawn line crosses, corners filled, so nothing slips
between two pieces (`scenarios.js obstacleRow()`); standing wire bars every attacker; those held up at it tear
it down (1,000 a section: a man 1 a tick, a troll 14, an engine 40; a shell 450), so the horde masses along
the belt and breaks through section by section, about 25 s for the first gaps under no fire; obstacles have
1,500 and go to an engine's crew (6 a tick) or a troll among them (30). A path through wire costs seven cells
of open ground, through obstacles (for engines) fifteen. Damaged sections show a small bar. Wire is 5 points a
section (was 2 for a 3 m piece that only slowed); obstacles stay at 3. A challenge's budget is still exactly
its garrison's cost. Also: the Advanced button is outlined in the accent colour and filled when open, and
opens itself when a defender is added in a challenge; an air strike is always twelve bombs, laid further
apart on a longer run.

**Weapons and shields as models.** Gear was plain boxes in four flat colours. Each kind is now a generated
model of its own (`tools/assets/src/gear-*/`: sword, shield, club, crossbow, rifle, machine gun, marksman's
rifle, launcher, launch tube, mortar; 350 credits). `build.js fit()` sets each in the hand by the frame the
boxes used (length from grip to tip, breadth, the point that sits in the hand), tells the tip from the shape,
and joins it to the figure before the levels of detail are made, so it is reduced and painted with the body
(each piece painted only from its own surface). Boxes remain only at the coarsest level. The image service
refused concept pictures for the crossbow and every firearm but one, twice; those six were made from a
written description instead (`concepts/<name>.text.txt`, the generator's text-to-3D: `generate.js` takes that
path when the file is there). The mortar the generator made is a stout emplaced piece, not a tube and bipod.
Pictures: `docs/progress/gear/`.

**The rest of the roster,** in this order: the scaling ladder (it must lie against the wall, so the built-in
one stays); aircraft (drawn by the support code, not as units); supply caches and obstacles.

### 10. Fortress art pass

On the frozen layout: the inner drum, the horn tower on its spur, the arcaded hall in the cliff,
wall detail, leaves for the door and postern, arc-length UVs for real coursed stone, richer rubble.
Budget: ≤ 400k fortress triangles in view.

### 11. Cliffs, ground, backdrop

**Done so far:** `Renderer._crags` cuts the mountainsides of the terrain mesh into strata (a ledge, a sheer
rise, then the old slope, in bands that wander) with gullies between buttresses. It changes the picture
only: the battle's ground is the map's, nothing walks up there, and the rock is only ever cut away, so the
camera (which keeps clear of the map's ground) cannot end up inside it. The valley floor, the Hornburg's
shelf and the rock within 70 m of the fortress are left alone. Pictures: `docs/progress/m11-cliffs/`.
The ground's colours were moved from pasture toward thin turf and bare stone with the map redesign.

**To come:** the terrain mesh is a 4 m grid, so crags finer than about 10 m need a denser mesh on the
faces or real cliff meshes in chunks; CC0 rock, scree and mud layers; distant mountains. Budget: static
scene GPU ≤ 3.5 ms.

### 12. Caching and polish

**Done:** `sw.js`, a service worker that touches only `/assets/game/`. A model's files carry a hash of
their contents in their names, so once fetched they are kept and never asked for again; the manifest is
asked of the network each time (and kept as a fallback for when there is none), and files it no longer
names are dropped. The page and the code never pass through it, so a new version of the game is never held
back. The browser is also asked (`navigator.storage.persist()`) not to evict them. `?sw=0` leaves it off.
The models are 12 MB in all today; they load after the game has started, the built-in ones standing in
until each arrives.

**To come:** README updated; a cap on runtime assets (100 MB, about 10 MB before first play).

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
