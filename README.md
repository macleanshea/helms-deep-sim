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

## Playing

**Setup.** Pick a scenario from the top bar or build your own. Choose a unit on the left, set
how many per placement, then click the map to drop a block or drag to draw a line. Dragging
along a wall top mans the battlements. Click a formation to select it: drag to move, `Q`/`E`
to rotate, `Del` to remove, and for attackers set a delay so they arrive as a later wave. The
right panel edits totals per unit type and the battle options (ammunition, support calls, when
relief arrives, when the horde breaks).

**Battle.**

| Input | Action |
| --- | --- |
| Scroll, right-drag, `WASD` | Zoom and pan |
| `Space`, `-`, `+` | Pause, slower, faster (1× to 8×) |
| `1` Air Strike | Click a target, or drag to set the attack heading |
| `2` Gunships | Two attack helicopters orbit the target for 40 s |
| `3` Artillery | Off-map battery saturates a 45 m circle |
| `4` Resupply Drop | Parachutes ammo crates; troops within 60 m re-arm |
| `5` Air Assault | A helicopter inserts a fresh platoon |
| `F` Focus Fire | Drag a circle; every weapon in range concentrates on it |
| `H` Hold Mortars | Mortars and howitzers cease fire until released |
| `R` Fall Back | All infantry outside the Hornburg retreat to the keep |
| Drag, then right-click | Box-select defenders and order them to move (`X` halts) |

Orders can be given while paused. On the zoomed-out map, cyan dots are armed defenders,
amber dots are defenders who are out of ammunition, and red dots are the horde.

The attackers behave the way the story goes: ladder crews open the wall top, sappers run a
blasting charge to the culvert, a ram climbs the causeway to the gate, trolls smash whatever
stands in front of them, and crossbows and catapults suppress the battlements. You win by
breaking the horde or by holding until the relief column arrives at dawn.

## How it works

- `src/sim/` — the simulation, with no DOM dependencies. Units live in typed arrays, find each
  other through uniform grids, and the horde navigates with a congestion-aware flow field that
  is re-solved as walls are laddered or breached. It advances in fixed 0.1 s steps and the
  renderer interpolates between them.
- `src/render/` — a WebGL2 renderer. Terrain is baked once from a procedural height field,
  fortifications are redrawn only when they change, corpses and craters are stamped into a
  persistent decal layer, and every unit and particle is drawn with instancing, so a full
  battle is a handful of draw calls.
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
