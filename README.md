# Helm's Deep — Modern Defense Simulator

An RTS-style battle simulator for the browser: the Battle of the Hornburg, except the
garrison is a modern combined-arms force. Lay out both armies, press **Begin Battle**, and
either watch it play out or take command with air strikes, artillery, resupply drops and
direct orders.

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

**Camera.** Scroll to zoom, right-drag or `WASD` to pan, middle-drag or `Q`/`E` to rotate,
`Home` to reset the view.

**Setup.** Pick a scenario from the top bar or build your own. Choose a unit on the left, set
how many per placement, then click the map to drop a block or drag to draw a line. Dragging
along a wall top mans the battlements. Under **Field works** the defenders can lay barbed wire,
anti-vehicle obstacles, moats, mines and claymores; solid obstacles give cover to whoever is
behind them. Click a formation to select it: drag to move, `[`/`]` to rotate, `Del` to remove,
and for attackers set a delay so they arrive as a later wave. The right panel edits totals per
unit type and the battle options (ammunition, morale, support calls, relief timing, when the
horde gives up).

**Battle.**

| Input | Action |
| --- | --- |
| `Space`, `-`, `+` | Pause / resume, slower, faster (1× to 8×) |
| **Strike** | |
| `1` Air Strike | Click a target, or drag to set the run-in heading |
| `2` Gunships | Two helicopters orbit the target for 40 s |
| `3` Artillery | Off-map battery covers a 45 m circle |
| `T` Fire Mission | Opens the artillery panel and arms a targeting cursor for your own mortars and howitzers; click to put every section that can reach on the point. Each section can also be targeted, held or released on its own |
| `F` Focus Fire | Drag a circle; every weapon in range concentrates on it |
| **Resupply & reinforce** | |
| `4` Resupply Drop | Parachuted crates; troops within 60 m re-arm |
| `5` Air Assault | A helicopter inserts a fresh platoon |
| `R` Fall Back | All infantry outside the Hornburg withdraw to the keep |
| **Overlays** | |
| `Z` Fire Zones | Where each mortar and howitzer section can land rounds (between minimum and maximum range) |
| `V` Ranges | How far the rest of the garrison reaches, by weapon (just the selection, if troops are selected) |
| `L` Losses | Shows where units of each side have been knocked out |
| Drag, then right-click | Box-select defenders and order them to move (`X` halts) |

Orders can be given while paused.

**Rules worth knowing.**

- Units walk up and down stairs and climb ladders and siege towers; nobody floats over the wall.
- The culvert, water, rubble, wire, moats and obstacles all slow movement. Heavy engines can't
  cross anti-vehicle obstacles or moats.
- Troops pressed against the foot of the wall are hard to hit from the battlements above.
- Both sides have command units (★). Lose one and nearby companies are briefly disorganised
  and lose morale. Any company that takes heavy losses in a short time may break and run,
  and can rally later.
- Siege towers carry 50 attackers each and unload them onto the wall walk when they dock.
- A forced gate and a fallen stretch of wall are marked on the map, and both sides can move
  through the gap. Aircraft climb over the mountains and the keep rather than through them.
- Win by breaking the horde or by holding until the relief column arrives at dawn.

Rendering quality steps down automatically on slower machines; add `?q=low` or `?q=high` to
the URL to force it.

## How it works

- `src/sim/` — the simulation, with no DOM dependencies (`morale.js` and `support.js` hold the
  morale system and player support calls). Units live in typed arrays, find each
  other through uniform grids, and the horde navigates with a congestion-aware flow field that
  is re-solved as walls are laddered or breached. It advances in fixed 0.1 s steps and the
  renderer interpolates between them.
- `src/render/` — a WebGL2 renderer: an orthographic isometric camera, a height-field terrain
  mesh, the fortress as one procedurally built mesh (rebuilt when a section is breached), a
  static shadow map, instanced low-poly unit meshes animated in the vertex shader with
  distance-based detail levels, 3D particles and short-lived lights, a persistent ground
  decal layer, and bloom post-processing.
- `src/ui/`, `src/main.js` — panels, HUD, input, camera and the 2D overlay.
- `src/config.js`, `src/scenarios.js`, `src/map.js` — unit and weapon tables, the preset
  orders of battle and the battlefield geometry. Tuning the game is mostly a matter of editing
  the tables in `config.js`.

### Headless runs

The simulation can be run without a browser, which is handy for balance and performance work:

```bash
node tools/headless.js garrison 1500        # preset, max seconds
node tools/headless.js combined 1500 auto   # with a crude support autopilot
```

Presets are `garrison`, `three-hundred`, `combined`, `recon` and `empty`.
