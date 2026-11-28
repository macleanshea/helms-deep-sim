# Helm's Deep — Modern Defense Simulator

An RTS-style battle simulator for the browser: the Battle of the Hornburg, except the
garrison is a modern combined-arms force. Garrison the fortress within your budget, press
**Begin battle**, and hold the Deep until dawn against a horde that comes on in waves — with
air strikes, artillery, resupply drops and direct orders — in a challenge the support is paid
for from a limited pool of Command Points.

It comfortably runs a thousand defenders against tens of thousands of attackers.

## Run it

No build step and no dependencies — it is plain ES modules and WebGL2.

```bash
npm start
```

Then open <http://localhost:5173>. Any static file server works too; the page only has to be
served over HTTP rather than opened from `file://`, because it uses ES modules.

A recent desktop Chrome, Edge, Firefox or Safari with WebGL2 is required.

### Deploying

The repository root is the site, so any static host works. `vercel.json` configures Vercel to
serve it as-is with no build step; importing the repository in Vercel is all that is needed.

## Playing

The battlefield is shown in a 3D view modeled on the film's set: the Hornburg on
its rock against the southern cliff (on your right as you look up the valley), its inner ward
climbing in terraces to the great tower, the causeway up to the gate, and the Deeping Wall with
its culvert.

### Challenge and sandbox

The welcome screen offers two ways to play; the **Sandbox / Challenge** switch in the top bar
changes between them at any time.

A **challenge** plays a scenario as designed (the Hornburg Garrison is loaded first). There are
three, one to a difficulty:

| | Scenario | The night |
| --- | --- | --- |
| Easy | **First Night** | A company on the center of the wall against 3,200 in three waves: ladders, a ram, sappers, one catapult. Ten minutes. |
| Medium | **The Hornburg Garrison** | Five hundred behind wire and mines against 18,000 in four waves, with towers, trolls and catapults. Twenty minutes. |
| Hard | **Three Hundred Rifles** | A rifle company with few heavy weapons against 10,000 in three waves. Fifteen minutes. |

In each the first wave is a real assault, not a probe, so the fight reaches the wall early, and a
platoon is kept below the wall where the enemy cannot count it. Difficulty is measured, not
guessed: see *Headless runs and balance* below.


- The enemy and the battle options are fixed. The garrison is issued at its full
  **requisition**; open **Edit garrison** under Forces on the right to see the requisition
  points (and each unit's cost in the left panel) and rework it. **Begin battle** is grayed out
  while the garrison costs more than the budget. The order of attack, wave by wave, sits below.
- Support is paid for from one pool of **Command Points** that refills slowly through the
  night. Killing captains, trolls and siege engines pays a bounty.
- The result is **scored** — the win, soldiers brought through, an intact gate and wall,
  requisition points left unspent — and the best score and medal per scenario are kept in the
  browser.

The **sandbox** lifts every limit. It opens on the Hornburg Garrison with both armies laid out; change anything,
pick another scenario in the top bar to autofill the map, or choose Blank Map to build from nothing. Every option can be edited, and support has a
fixed number of calls per kind (four of each to start) instead of Command Points; the random
seed for sandbox battles is in **Settings**. There are no waves and no relief at
dawn by default: the whole horde is on the field from the start, and the defenders win when the
horde gives up with only a remnant left, or lose if the garrison is wiped out. Both win
conditions (relief at dawn, and when the attackers flee) can be changed. **Raise a horde**
(Attackers tab) draws up a whole host of any size with its ladders, engines and captains;
formations you place yourself take an "advance after" delay. Sandbox battles are not scored.

### The night

In a challenge the horde attacks in waves: a vanguard that starts on the field, then ladder assaults, siege
assaults and a final assault, which wait beyond the valley mouth and march on in turn. Releases
are paced so the last wave has time to fight at the wall before dawn; cutting a wave down quickly
earns a lull (the next may step off up to a minute early). The top bar counts down to the
next wave, and an alert names the stretch of wall it is aimed at.

**The horde has a plan.** Each wave is split into task forces by lane, each with a captain and an
objective: a third of the Deeping Wall, or the gate. Two forces of three go in against whichever
sector looks weakest *from what the horde has seen* (heads counted on the wall once it is close
enough to look, and how hard each sector has been firing), so troops kept below the wall are a
surprise, and the vanguard is a real probe. A force steps off together, with slow engines given a
head start. Warg riders are held out of range until there is a breach, a fallen gate, or infantry
caught outside the walls. A force that is spent before it has closed pulls back and comes on again
with the next wave. A foothold on the wall, or a sector whose fire dies away, draws in whoever has
not yet committed. Shortly before dawn everything left comes on at once.

Win by holding until the relief column arrives at dawn, or by breaking the horde (the white
mark on its bar).

**Camera.** Scroll to zoom, from the whole valley seen from high above down to a single squad seen
from just over its shoulders: the view swings lower as it closes in. Right-drag or `WASD` to pan,
middle-drag or `Q`/`E` to turn, middle-drag up and down or `PgUp`/`PgDn` to tip the view, `Home` to
reset it. `G` jumps to the latest
alert; clicking an alert in the feed or a point on the minimap looks there too.

**Setup.** Pick a mode and a scenario from the top bar. Choose a unit on the left (each card shows the unit's
range), set how many per placement, then click the map to drop a block or drag to draw a line;
the dashed ring shows the weapon's reach from that spot, and a dotted one how far a commander
or captain steadies the troops around them. Point at a wall top and the men lock onto it: a click mans the parapet there, a drag mans it along the wall's curve however far the pointer strays, and they face outward (hold Alt to place freely instead). The Hornburg's bastions, gatehouse platforms and its inner and upper courts can all be manned; a block or line stays on the level it was started on. Under **Obstacles and
supply** the defenders can lay barbed wire, anti-vehicle obstacles, mines and claymores;
solid obstacles give cover to whoever is behind them. Click a formation to select it: drag to
move, `[`/`]` to rotate, `Del` to remove. The right panel shows the forces
(requisition points spent and totals per unit type), the waves,
the options, support, and the victory conditions. In the sandbox the attackers can be edited
too, and hand-placed attacker formations take an "advance after" delay.

**Battle.**

| Input | Action |
| --- | --- |
| `Space`, `-`, `+` | Pause / resume, slower, faster (1× to 8×) |
| **Fire** | |
| `1` Air Strike (4 CP) | Click a target, or drag to set the run-in heading |
| `2` Gunships (6 CP) | Three helicopters orbit the target for 40 s |
| `T` Target Artillery | Free and unlimited. Opens the artillery panel and arms a targeting cursor for your own mortars and howitzers; click to put every battery that can reach on the point. Each battery can also be targeted, held or released on its own |
| `F` Focus Fire | Drag a circle; every weapon in range concentrates on it, and marksmen pick out any captain inside |
| **Garrison** | |
| `3` Resupply (4 CP) | Parachuted crates; troops within 60 m re-arm |
| `4` Reinforce (4 CP) | A helicopter lands a fresh platoon |
| `R` / `Shift+R` | Selected troops fall back to the Hornburg / everyone falls back |
| **Overlays** | |
| `Z` Artillery Range | Where each mortar and howitzer battery can land rounds (between minimum and maximum range) |
| `V` Weapon Range | How far the rest of the garrison reaches, by weapon (just the selection, if troops are selected) |
| **Command** | |
| `H` Fire mode | Selected troops: fire at will, hold to 150 m, hold to 75 m, hold fire |
| `G` | Jump to the latest alert (again for earlier ones) |
| `L` Losses | Shows where units of each side have been knocked out |
| Drag, double-click | Box-select defenders; double-click selects every unit of that kind in view |
| Right-click, `X` | Move the selection; halt it |
| `Shift+6`…`0`, `6`…`0` | Assign a control group; recall it (tap twice to look at it) |

Orders can be given while paused. The battle waits while a dialog is open.

**Rules worth knowing.**

- Units walk up and down stairs and climb ladders and siege towers; nobody floats over the wall.
- The culvert, water and rubble slow movement. Barbed wire is laid as an unbroken belt and stops
  the horde until a way is cut: the men held up at it tear it down section by section (a troll or
  an engine far faster), and shellfire blows it apart. Anti-vehicle obstacles stop rams,
  catapults and siege towers until their crews, or a troll, drag them aside. Damaged sections
  show what is left of them.
- Troops pressed against the foot of the wall are hard to hit from the battlements above.
- Ammunition is the garrison's real limit. Shots at close range hit far more often than at long
  range, so holding fire (`H`) stretches it; an amber pip marks a soldier who is out.
- Machine guns and shellfire **suppress**: a pinned company (▼) slows to a crawl, its archers
  stop shooting and its morale wears away. Berserkers cannot be pinned, and warg riders keep most
  of their pace under fire.
- Both sides have command units (★). Lose one and nearby companies are briefly disorganized
  and lose morale. An Uruk captain follows behind his own companies. While he stands they almost
  never rout, and a broken company falls back on the nearest captain and rallies there. He is not
  shot on sight, and the troops pressed around him take most shots aimed at him: thin them with
  high explosive, then mark him with focus fire.
- **Bodies take space.** Only so many can stand in one spot, so a ladder, a breach or a gate
  admits a column, not a crowd. Trolls and engines push the small aside.
- **Lines of fire.** Nobody shoots through his own men. On a battlement two ranks can fire, the
  front one kneeling at the parapet and the second standing behind it; on open ground three, lying
  prone, kneeling and standing. A man with no clear line looks for a gap in the ranks or a free
  place at the parapet nearby (never more than 30 m from where he was put), or waits, and steps up
  when a man ahead falls. A man on a wall covers the ground in front of him, 75 degrees either side
  of straight out, not along the wall. Grenade launchers and mortars lob over everyone. Kneeling at
  a parapet or lying prone, a man is about half as easy for a crossbow to hit. So firepower follows
  frontage: a wall manned ten deep fires no harder than one manned two deep. The defenders take up
  room as the attackers do.
- **The Hornburg's back door.** The gate facing the valley is built to take a long battering
  (it takes six sappers' charges); the postern at the rear, at the top of the ramp up from the
  Deep, is a lighter door that a party of Uruk-hai can hack down in under a minute and one charge
  breaks. Give up the Deeping Wall and the horde comes round for it: ladders go up unopposed at
  the keep end of the empty wall, sappers blow the culvert, and the Deep fills while one force
  keeps the gate busy. Falling back means defending two short fronts, not one.
- **The door from the wall.** Where the Deeping Wall meets the Hornburg, its walk runs through an
  arch straight into the court. The garrison passes freely, but the door in it can be battered down
  (a party of Uruk-hai breaks it in a minute or two). Attackers who hold the keep end of the wall
  make for it, and after a fall-back the climbers on the empty wall go for whichever back door is
  nearer. Men on the curtain wall above the junction, and in the court behind the arch, hold it.
- **Siege engines are timber with a crew.** Small arms cannot hurt a ladder, ram, tower or
  catapult, only the Uruk-hai and trolls moving it. It slows as they fall and is set down when too
  few are left; others nearby step in, and a later wave can pick up an abandoned one. Marksmen pick
  out the carriers. Grenades, mortars, rockets and air strikes destroy the engine itself.
- **Ladders can be thrown down.** Defenders at a ladder head, with no attacker yet on the wall
  beside them, heave it off; it lies at the foot until it is raised again.
- **Shield walls.** Inside the reach of the garrison's small arms the Uruk-hai lock shields:
  slower, but most bullets from the front are stopped. Riflemen hold their fire on a distant shield
  wall rather than waste it (machine guns keep it pinned). Mortars, grenades and fire from the
  flank are the answer; wire breaks the formation. Beyond small-arms reach they come on fast in
  open order.
- **Their fire pins you too.** Crossbow volleys and catapult rocks pin the platoons they land on:
  a slower, wilder fire until it lifts. A commander nearby steadies them. Catapults have missions
  (your mortars, the stretch of wall the trolls are battering, the escalade's sector, your
  ammunition points) and keep out of rocket reach once one has been lost to a rocket.
- Siege towers carry 50 attackers each and unload them onto the wall walk when they dock.
- Alerts warn before the damage is done — a ram on the causeway, sappers running for the
  culvert, ladder crews closing, the gate at half strength, a sector out of ammunition.
- A forced gate and a fallen stretch of wall are marked on the map, and both sides can move
  through the gap. Aircraft climb over the mountains and the keep rather than through them.

**Settings** (the gear next to Help) has one **Graphics quality** setting: Auto, Low, Medium, High or
Ultra. Each level sets both how the picture is drawn (its resolution, anti-aliasing, glow and HDR, rain
in the scene) and how far out soldiers are drawn in full detail. **Auto**, the default, starts where it
last settled and moves by the frame rate: one level down when a third of recent frames run under about
50 fps (frames the battle's own arithmetic made long are not counted, and a 30 Hz screen is not taken
for a slow machine), one level back up after twenty clean seconds. A level that fails is not tried
again for a minute, and for twice as long each time it fails again. The choice is kept in the browser.
Add `?q=low`, `?q=medium` or `?q=high` to the URL to hold the rendering quality for a test.

### Performance

Press `F2` (or add `?perf` to the URL) for an overlay showing frame time, CPU time in the
simulation and the renderer, GPU time per stage, triangles and draw calls. `?bench` fast-forwards
the largest scenario to its final assault, when the field is fullest, then steps through a fixed
set of views and lists the same figures for each: the quickest way to see how much headroom a
machine has. Each view also counts the frames that ran over 20 ms and over 33 ms, and a **Copy
results** button puts the table on the clipboard together with the graphics card, browser and
resolution it was measured on. GPU timings need a browser that exposes
`EXT_disjoint_timer_query_webgl2` (desktop Chrome and Edge do).

Each unit is drawn at one of four levels of detail chosen from its size on screen (so the far
ranks of a host cost little while the near ones are drawn in full): dots, then boxes, then
blocky stand-ins of about seventy triangles, and the full models (about a thousand triangles for
a soldier, several thousand for a vehicle). The **Graphics quality** level places the ladder:
full models take over at a zoom proportional to its detail step, dots give way at that step's square
root (so the whole valley stays cheap), and boxes give way to stand-ins midway between the two on a
log scale. In screen pixels per meter:

| Level | Dots below | Boxes below | Stand-ins below (full models from) |
| --- | --- | --- | --- |
| Low | 1.4 | 3.6 | 9.0 |
| Medium | 1.2 | 2.5 | 5.3 |
| High | 1.1 | 1.9 | 3.3 |
| Ultra | 0.9 | 1.5 | 2.5 |

The scale is measured where each unit stands, so in a low view the nearest
ranks are full models while the far end of the same host is boxes and dots; and if a view would
still spend more than 2.5 million triangles on units, every level is pulled in closer until it
does not.

### Unit models from files

The Uruk-hai are drawn from a model made outside the game (a painted concept, turned into a rigged,
animated mesh by Meshy) rather than built in code: `assets/game/` holds its pack (four levels of
detail and its clips baked to bone matrices) and a small texture, loaded after start-up. Everything
else still uses the built-in models, and so does the whole game with `?assets=0` or if a pack fails
to load. `tools/assets/` is the pipeline that makes the packs (`import.js` from the generator's
files, `build.js` to the game's), and `docs/roadmap.md` describes it.

## How it works

- `src/sim/` — the simulation, with no DOM dependencies (`morale.js` holds morale and
  suppression, `support.js` the support calls and Command Points, `director.js` the pacing of
  the horde's waves, `warlord.js` the horde's battle plan, `engines.js` crewed siege engines and
  ladder throw-down). Units live in typed arrays, find each
  other through uniform grids, and the horde navigates with a congestion-aware flow field that
  is re-solved as walls are laddered or breached. It advances in fixed 0.1 s steps and the
  renderer interpolates between them.
- `src/render/` — a WebGL2 renderer: a perspective camera whose pitch follows the zoom, a height-field terrain
  mesh, a static shadow map, 3D particles and short-lived lights, a persistent ground decal
  layer, and bloom post-processing. The terrain, the fortress, the materials and most
  units are generated in code; unit models that come from files are described under Unit models
  from files above (`assets.js` loads them, and the skinned path in `renderer.js` draws them).
  - `materials.js` generates the surface textures on the GPU at start-up: sixteen tiling
    materials (dressed stone, flagstones, rock, grass, mud, timber, slate, iron, painted steel,
    cloth, camouflage, hide and so on), each with color detail, a normal map, roughness and
    specular strength. Every vertex names its material.
  - `mesh.js` is the model-building kit: boxes and beams, chamfered boxes, extruded outlines,
    and smooth lofted shapes (tubes, limbs, spheres, lathed profiles), with a transform stack
    and welded, indexed output.
  - `models/` holds the units: a jointed figure builder (`figure.js`) and the soldiers, the
    horde, vehicles, siege engines, aircraft and props built with it. Limbs and moving parts
    are animated in the vertex shader. `legacy.js` keeps the original blocky models as the
    mid-distance stand-ins.
  - `structures.js` builds the fortress from cached pieces, so a breach rebuilds only the
    section that fell.
  - `shaders.js` lights everything in linear light: sky and ground ambient, sun or moon with a
    soft shadow, specular highlights from the material, flash lights, and rain-wet ground at
    night.
  - `perf.js` is the performance overlay and benchmark.
- `src/ui/`, `src/main.js` — panels, HUD, input, camera and the 2D overlay.
- `src/config.js`, `src/scenarios.js`, `src/map.js`, `src/score.js` — unit, weapon, cost and
  support tables, the preset orders of battle and wave composition, the battlefield geometry,
  and the scoring rules. Tuning the game is mostly a matter of editing the tables in
  `config.js` and the presets in `scenarios.js`, then running `npm run matrix`.

### Headless runs and balance

The simulation runs without a browser, and a given setup, seed and sequence of orders always
plays out the same way:

```bash
node tools/headless.js garrison                       # preset, nobody giving orders
node tools/headless.js --preset first-night --policy auto   # with a stand-in commander
node tools/headless.js --preset garrison --seed 3 --opt cpRate=0.05 --json --verify
npm run matrix                                        # every challenge x policy x seed, as a table
npm run checks                                        # does the siege behave? pass or fail, with numbers
```

Presets are `first-night`, `garrison`, `three-hundred` and `empty`, plus `benchmark` (thirty
thousand against a reinforced garrison, not offered in the game; `?bench` uses it). `--policy auto` plays
a careful commander (resupplies dry sectors, strikes siege engines before they reach the wall,
shells the thickest of the press) within the Command Point budget; `none` gives no orders.
`--opt key=value` overrides any battle option (`sandbox=true` switches to per-kind support uses),
`--json` prints one summary line including the score, and `--verify` runs twice and checks the
state hashes match. Each run also reports how the siege went: ladders raised and thrown down,
engines dropped and picked up again, when the first attacker reached the wall and when the first
foothold was won, how far from the works each kind of attacker fell, and the cost of the dearest
ten steps. `tools/matrix.js` runs the lot in parallel and summarizes wins, end time
and survivors per scenario.

**How difficulty is judged.** The yardstick is the stand-in commander, who calls support sensibly
but never moves a man, marks a target or changes a stance; a player can do all of those. Over ten
seeds:

| | Stand-in commander | Nobody giving orders |
| --- | --- | --- |
| Easy | wins nearly every night with about half the garrison left | usually loses, late in the night |
| Medium | wins most nights with about a third left | always loses |
| Hard | wins fewer than half | always loses, with a third of the night to go |

Hard is meant to need more than the stand-in gives.

**Falling back at once.** Ordering the whole garrison into the Hornburg in the first second is no
longer a free win on Medium or Hard: the horde comes round through the Deep and over the empty wall,
breaks the postern and the door from the wall, and pours into the court from two sides. In the check
battles it loses Medium two nights in three and wins Hard with only a twentieth of the garrison
left. Easy is still won with nearly everyone alive (its horde is too small to force the doors in
time), so `npm run checks` still reports this as OPEN.

**Guarding a change.** Three quicker tools say whether a change did what it meant to and nothing
else: `npm run maplint` stands every preset's armies on the map and solves the paths the battle
needs (a ram to the gate, the horde to the wall, the garrison between court, walls and the Deep),
then prints the map's measurements; `npm run golden` hashes the map, the fortress mesh and whole
battles against `docs/baseline/golden.json`, so a refactor can prove it changed nothing (a change
meant to alter the map or the rules re-records them with `-- --update`); and `npm run shots` takes
fixed-camera screenshots with Playwright on the software rasterizer and can compare them with an
earlier set (`-- --compare docs/baseline/shots`). `docs/roadmap.md` is the plan these guard.

`tools/checks.js` (`npm run checks`) is the other half: it plays instrumented battles and gives a
pass or fail, with the numbers, for each way the siege rules could look wrong. Engines left
crewless, ladders thrown down the instant they go up, riflemen who never fire, platoons pinned for
the whole fight, captains who cannot be killed or who bunch together, warg riders who never
leave the reserve, forces going back and forth, alert floods, surges at a sector that is still
firing, an empty stretch of wall ignored, soldiers stuck for good, troops in front of the wall
walked past, a horde that will not come round through the Deep for the postern (or does while the
wall is manned), a door from the wall that is never battered or is walked through while it holds,
hordes too big to fit, shots fired through friends or along a wall, men left with no line of fire
or fidgeting between places, defenders packed into one spot, and the keep used as a free win.
