# Helm's Deep — Modern Defense Simulator

An RTS-style battle simulator for the browser: the Battle of the Hornburg, except the
garrison is a modern combined-arms force. Garrison the fortress within your budget, press
**Begin Battle**, and hold the Deep until dawn against a horde that comes on in waves — with
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

The battlefield is shown in an isometric 3D view modelled on the film's set: the Hornburg on
its rock against the southern cliff (on your right as you look up the valley), its inner ward
climbing in terraces to the great tower, the causeway up to the gate, and the Deeping Wall with
its culvert.

### Challenge and sandbox

The welcome screen offers two ways to play; the **Sandbox / Challenge** switch in the top bar
changes between them at any time.

A **challenge** plays a scenario as designed (the Hornburg Garrison is loaded first):

- The enemy and the battle options are fixed. The garrison is issued at its full
  **requisition**; open **Advanced** under Order of Battle on the right to see the requisition
  points (and each unit's cost in the left panel) and rework it. **Begin Battle** is greyed out
  while the garrison costs more than the budget. The order of attack, wave by wave, sits above.
- Support is paid for from one pool of **Command Points** that refills slowly through the
  night. Killing captains, trolls and siege engines pays a bounty.
- The result is **scored** — the win, soldiers brought through, an intact gate and wall,
  requisition points left unspent — and the best score and medal per scenario are kept in the
  browser.

The **sandbox** lifts every limit. It starts from a blank map; pick a scenario in the top bar to
autofill both armies, then change anything. Every option can be edited, and support has a
fixed number of calls per kind instead of Command Points. There are no waves and no relief at
dawn by default: the whole horde is on the field from the start, and the defenders win when the
horde gives up with only a remnant left, or lose if the garrison is wiped out. Both win
conditions (relief at dawn, and when the horde gives up) can be changed. **Raise a horde**
(Attackers tab) draws up a whole host of any size with its ladders, engines and captains;
formations you place yourself take an "advance after" delay. Sandbox battles are not scored.

### The night

In a challenge the horde attacks in waves: a vanguard that starts on the field, then escalades, the siege
train and a final assault, which wait beyond the valley mouth and march on in turn. Releases
are paced so the last and heaviest wave lands shortly before dawn; cutting a wave down quickly
earns a lull (the next may step off up to a minute early). The top bar counts down to each
wave, says what it brings, and names the stretch of wall it is aimed at — the middle waves go
for whichever sector looks weakest. `N` fast-forwards through a quiet spell.

Win by holding until the relief column arrives at dawn, or by breaking the horde (the white
mark on its bar).

**Camera.** Scroll to zoom (from the whole valley down to a single squad), right-drag or `WASD`
to pan, middle-drag or `Q`/`E` to rotate, `Home` to reset the view. `G` jumps to the latest
alert; clicking an alert in the feed or a point on the minimap looks there too.

**Setup.** Pick a mode and a scenario from the top bar. Choose a unit on the left, set how many per
placement, then click the map to drop a block or drag to draw a line; the dashed ring shows the
weapon's reach from that spot. Dragging along a wall top mans the battlements. Under **Field
works** the defenders can lay barbed wire, anti-vehicle obstacles, mines and claymores;
solid obstacles give cover to whoever is behind them. Click a formation to select it: drag to
move, `[`/`]` to rotate, `Del` to remove. The right panel shows the enemy's order of attack wave by
wave, the order of battle (requisition points spent and totals per unit type), the battle
options, support, and the win conditions. In the sandbox the
attackers can be edited too, and hand-placed attacker formations take an "advance after" delay.

**Battle.**

| Input | Action |
| --- | --- |
| `Space`, `-`, `+`, `N` | Pause / resume, slower, faster (1× to 8×), fast-forward to the next contact |
| **Strike** | |
| `1` Air Strike (5 CP) | Click a target, or drag to set the run-in heading |
| `2` Gunships (6 CP) | Two helicopters orbit the target for 40 s |
| `3` Artillery (3 CP) | Off-map battery covers a 45 m circle |
| `T` Fire Mission | Opens the artillery panel and arms a targeting cursor for your own mortars and howitzers; click to put every section that can reach on the point. Each section can also be targeted, held or released on its own |
| `F` Focus Fire | Drag a circle; every weapon in range concentrates on it, and marksmen pick out any captain inside |
| **Resupply & reinforce** | |
| `4` Resupply Drop (4 CP) | Parachuted crates; troops within 60 m re-arm |
| `5` Air Assault (8 CP) | A helicopter inserts a fresh platoon |
| `R` / `Shift+R` | Selected troops fall back to the keep / general retreat |
| **Overlays** | |
| `Z` Fire Zones | Where each mortar and howitzer section can land rounds (between minimum and maximum range) |
| `V` Ranges | How far the rest of the garrison reaches, by weapon (just the selection, if troops are selected) |
| **Command** | |
| `H` Fire discipline | Selected troops: fire at will, hold to 150 m, hold to 75 m, hold fire |
| `G` | Jump to the latest alert (again for earlier ones) |
| `L` Losses | Shows where units of each side have been knocked out |
| Drag, double-click | Box-select defenders; double-click selects every unit of that kind in view |
| Right-click, `X` | Move the selection; halt it |
| `Shift+6`…`0`, `6`…`0` | Assign a control group; recall it (tap twice to look at it) |

Orders can be given while paused. The battle waits while a dialog is open.

**Rules worth knowing.**

- Units walk up and down stairs and climb ladders and siege towers; nobody floats over the wall.
- The culvert, water, rubble, wire and obstacles all slow movement. Heavy engines can't
  cross anti-vehicle obstacles.
- Troops pressed against the foot of the wall are hard to hit from the battlements above.
- Ammunition is the garrison's real limit. Shots at close range hit far more often than at long
  range, so holding fire (`H`) stretches it; an amber pip marks a soldier who is out.
- Machine guns and shellfire **suppress**: a pinned company (▼) slows to a crawl, its archers
  stop shooting and its morale wears away. Berserkers cannot be pinned.
- Both sides have command units (★). Lose one and nearby companies are briefly disorganised
  and lose morale. Uruk captains march at the rear of their wave and are not shot on sight —
  mark one with focus fire. Any company that takes heavy losses in a short time may break and
  run, and can rally later.
- Siege towers carry 50 attackers each and unload them onto the wall walk when they dock.
  Catapults batter the wall and counter-battery mortars that keep firing from one place.
- Alerts warn before the damage is done — a ram on the causeway, sappers running for the
  culvert, ladder crews closing, the gate at half strength, a sector out of ammunition.
- A forced gate and a fallen stretch of wall are marked on the map, and both sides can move
  through the gap. Aircraft climb over the mountains and the keep rather than through them.

Rendering quality steps down automatically (high, then medium, then low) on machines that cannot
hold 30 fps; add `?q=low`, `?q=medium` or `?q=high` to the URL to force it. **Settings** (the
gear next to Help) sets how far out units are drawn in more detail: Close up, Medium, Far (the
default) or Very far. Each step moves the whole ladder of detail levels further out (see
Performance below); further out costs frame rate in big battles. The choice is kept in the
browser.

### Performance

Press `F2` (or add `?perf` to the URL) for an overlay showing frame time, CPU time in the
simulation and the renderer, GPU time per stage, triangles and draw calls. `?bench` fast-forwards
the largest scenario to its final assault, when the field is fullest, then steps through a fixed
set of views and lists the same figures for each: the quickest way to see how much headroom a
machine has. GPU timings need a browser that exposes
`EXT_disjoint_timer_query_webgl2` (desktop Chrome and Edge do).

Units are drawn at one of four levels of detail chosen from the zoom: dots, then boxes, then
blocky stand-ins of about seventy triangles, and the full models (about a thousand triangles for
a soldier, several thousand for a vehicle). The **Detailed models** setting places the ladder:
full models take over at a zoom proportional to it, dots give way at its square root (so the
whole valley stays cheap), and boxes give way to stand-ins midway between the two on a log
scale. On high quality, in screen pixels per metre:

| Setting | Dots below | Boxes below | Stand-ins below (full models from) |
| --- | --- | --- | --- |
| Close up | 1.4 | 2.8 | 5.5 |
| Medium | 1.2 | 2.2 | 4.1 |
| Far (default) | 1.1 | 1.9 | 3.3 |
| Very far | 0.9 | 1.5 | 2.5 |

Balanced and performance quality bring the full models (and so the boxes' upper limit) in
closer.

## How it works

- `src/sim/` — the simulation, with no DOM dependencies (`morale.js` holds morale and
  suppression, `support.js` the support calls and Command Points, `director.js` the pacing of
  the horde's waves). Units live in typed arrays, find each
  other through uniform grids, and the horde navigates with a congestion-aware flow field that
  is re-solved as walls are laddered or breached. It advances in fixed 0.1 s steps and the
  renderer interpolates between them.
- `src/render/` — a WebGL2 renderer: an orthographic isometric camera, a height-field terrain
  mesh, a static shadow map, 3D particles and short-lived lights, a persistent ground decal
  layer, and bloom post-processing. Everything is generated in code; there are no image or
  model files.
  - `materials.js` generates the surface textures on the GPU at start-up: sixteen tiling
    materials (dressed stone, flagstones, rock, grass, mud, timber, slate, iron, painted steel,
    cloth, camouflage, hide and so on), each with colour detail, a normal map, roughness and
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
node tools/headless.js --preset recon --policy auto   # with a stand-in commander
node tools/headless.js --preset garrison --seed 3 --opt cpRate=0.05 --json --verify
npm run matrix                                        # every preset x policy x seed, as a table
```

Presets are `garrison`, `three-hundred`, `combined`, `recon` and `empty`. `--policy auto` plays
a careful commander (resupplies dry sectors, strikes siege engines before they reach the wall,
shells the thickest of the press) within the Command Point budget; `none` gives no orders.
`--opt key=value` overrides any battle option (`sandbox=true` switches to per-kind support uses),
`--json` prints one summary line including the score, and `--verify` runs twice and checks the
state hashes match. `tools/matrix.js` runs the lot in parallel and summarises wins, end time
and survivors per scenario — the tuning target is that giving no orders loses, and the
stand-in commander wins without it being a walkover.
