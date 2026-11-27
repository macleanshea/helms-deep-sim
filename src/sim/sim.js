// Battle simulation. Pure logic (no DOM) so it can run headless for balance tests.
// Units live in structure-of-arrays typed buffers; visual effects are reported
// through the `fx` interface and UI notifications through `events`.

import { WORLD_W, WORLD_H, CELL, GW, GH, DT, DEF, ORC, T, OB, WIRE_HP, AV_HP, STEP, WAY_STEP, UNITS, U, WEAPONS, ARMOR_MULT, A, K, R, C, TR, SUPPORT, BOUNTY, BOUNTY_SHARE, DEFAULT_OPTIONS } from '../config.js';
import { FlowSolver, DXN, DYN } from './flow.js';
import { groupPositions } from '../scenarios.js';
import { mulberry } from '../rng.js';
import { KEEP, N_WALL } from '../map.js';
import { supportMethods } from './support.js';
import { moraleMethods } from './morale.js';
import { directorMethods } from './director.js';
import { warlordMethods } from './warlord.js';
import { engineMethods } from './engines.js';
import { postMethods } from './posts.js';
import { LAYOUT } from '../layout.js';

const AP = LAYOUT.approach, PO = LAYOUT.posts; // the horde's lines and the garrison's places on this map
export const MAX_UNITS = 1 << 16;
const FINE = 2, FW = WORLD_W / FINE, FH = WORLD_H / FINE; // separation / blast grid
const OCS = 16, OW = WORLD_W / OCS, OH = WORLD_H / OCS;   // coarse grid of attackers
const DCS = 8, DW = WORLD_W / DCS, DH = WORLD_H / DCS;    // coarse grid of defenders
const BCS = 8, BW = WORLD_W / BCS, BH = WORLD_H / BCS;    // grid of big bodies (trolls, engines)
const CAP = 4;            // most foot soldiers that fit in one fine cell (about one a square metre)
const GATE_HP = 7800, POSTERN_HP = 1300, DOOR_HP = 1300, DOOR_COST = 310; // the Hornburg's doors and the crossing price of the door in a path (map.js holds the stone defaults)
export const FINE_CELL = FINE, FINE_W = FW, FINE_H = FH;
export const LOSS_CELL = OCS, LOSS_W = OW, LOSS_H = OH;

export const S_IDLE = 0, S_MOVE = 1, S_ACT = 2, S_DONE = 3, S_FLEE = 4, S_WAIT = 5, S_CLIMB = 6;
export const LADDER_TIME = 4, TOWER_TIME = 5;
export const WIRE_COST = 70; // what a section of standing wire adds to the cost of a path through its cell (open ground is 10)
// direction index for a (dy+1)*3+(dx+1) neighbour offset
const KDIR = [5, 6, 7, 4, -1, 0, 3, 2, 1];

const NOFX = new Proxy({}, { get: () => () => {} });
let sharedSolver = null;
const W = WEAPONS;

export class Sim {
  constructor(map, setup, fx) {
    this.map = map;
    this.fx = fx || NOFX;
    const o = setup.options || {};
    this.opt = { ...DEFAULT_OPTIONS, ...o, support: { ...DEFAULT_OPTIONS.support, ...(o.support || {}) } };
    this.rand = mulberry(this.opt.seed || 1);
    this.rand2 = mulberry((this.opt.seed || 1) ^ 0x9e3779b9); // the horde's own dice: the director's choices
    this.mtype = map.type; this.mseg = map.seg; this.cz = map.cz; this.portal = map.portal;
    // built roadways (the causeway, the rear ramp): their sides are walled, so they are entered and left at their ends
    this.tier = map.tier; // which of the Hornburg's courts a cell is (see map.js)
    this.way = map.way || (map.way = Uint8Array.from(map.type, (t) => (t === T.ROAD ? 1 : 0)));

    const N = MAX_UNITS;
    this.alive = new Uint8Array(N); this.team = new Uint8Array(N); this.type = new Uint8Array(N);
    this.state = new Uint8Array(N); this.el = new Uint8Array(N); this.ord = new Int8Array(N).fill(-1); this.grp = new Uint16Array(N);
    this.x = new Float32Array(N); this.y = new Float32Array(N); this.px = new Float32Array(N); this.py = new Float32Array(N);
    this.vx = new Float32Array(N); this.vy = new Float32Array(N); this.rot = new Float32Array(N); this.trot = new Float32Array(N);
    this.sepx = new Float32Array(N); this.sepy = new Float32Array(N); this.bx = new Float32Array(N); this.by = new Float32Array(N);
    this.hp = new Float32Array(N); this.rad = new Float32Array(N);
    this.cd = new Float32Array(N); this.cd2 = new Float32Array(N);
    this.ammo = new Float32Array(N); this.ammo2 = new Float32Array(N);
    this.target = new Int32Array(N).fill(-1); this.target2 = new Int32Array(N).fill(-1);
    this.tx = new Float32Array(N); this.ty = new Float32Array(N);
    this.aux = new Float32Array(N); this.aux2 = new Int32Array(N).fill(-1);
    this.hitT = new Float32Array(N).fill(-10); this.fireT = new Float32Array(N).fill(-10);
    this.next = new Int32Array(N); this.cnext = new Int32Array(N);
    this.gen = new Uint16Array(N);      // bumped each time a slot is reused, so a stored unit reference can be checked
    this.holdR = new Float32Array(N);   // fire discipline: 0 fire at will, >0 hold until the enemy is this close (m), <0 hold fire
    this.n = 0; this.free = [];
    // crewed engines: which engine a soldier is carrying or pushing (with the engine's generation), and his place on it
    this.crewOf = new Int32Array(N).fill(-1); this.crewGen = new Uint16Array(N); this.slot = new Uint8Array(N);
    this.crewAcc = new Float32Array(N); this.crewPts = new Float32Array(N);     // crew strength in place (this tick / last tick)
    this.haveAcc = new Float32Array(N); this.crewHave = new Float32Array(N);    // crew strength assigned, in place or running up
    this.slotAcc = new Uint32Array(N); this.slotMask = new Uint32Array(N);
    this.eHalt = new Float32Array(N); this.eIdle = new Float32Array(N); this.eEver = new Uint8Array(N); this.eNoDraft = new Float32Array(N);
    this.stuck = new Uint8Array(N);
    // lines of fire: a standing defender's rank (3: no line of fire) and posture (1 kneeling, 2 prone), the post he keeps near, when he may next look for a place
    this.rank = new Uint8Array(N); this.pose = new Uint8Array(N); this.ax = new Float32Array(N); this.ay = new Float32Array(N); this.seekT = new Float32Array(N); this.snagT = new Float32Array(N);
    this.resT = new Float32Array(FW * FH); this._arcOn = false; this._anx = 0; this._any = 0;
    this.engines = [];
    this.occ = new Uint8Array(FW * FH * 2); this.blk = new Int32Array(FW * FH); this.blkList = [];
    this.bigHead = new Int32Array(BW * BH).fill(-1); this.bnext = new Int32Array(N);

    this.head = new Int32Array(FW * FH);
    this.ocHead = new Int32Array(OW * OH); this.ocCount = new Uint16Array(OW * OH);
    this.dcHead = new Int32Array(DW * DH); this.dcCount = new Uint16Array(DW * DH);
    this.danger = new Uint8Array(OW * OH);
    this.navCnt = new Uint8Array(GW * GH);
    this.loss = [new Uint16Array(OW * OH), new Uint16Array(OW * OH)];
    this.hot = new Float32Array(OW * OH); this.hotList = []; // where the garrison's mortars and guns have been firing from

    // fortification state
    const NC = GW * GH;
    this.segs = map.segments.map((s) => ({ ...s, hp: s.maxHp, breached: false, ladders: 0, claimed: 0 }));
    // a gate built to face the valley, and a lighter door at the back that opens on the Deep
    { const gs = this.segs[map.GATE], ps = this.segs[map.POSTERN]; gs.maxHp = gs.hp = GATE_HP; ps.maxHp = ps.hp = POSTERN_HP; }
    // the arch from the Deeping Wall walk into the court has leaves: the garrison passes, the horde has to break them
    { const ds = this.segs[map.DOOR]; ds.maxHp = ds.hp = DOOR_HP; ds.leaves = true; }
    this.segTop = new Float32Array(this.segs.map((s) => s.top));
    this.elev = new Uint8Array(NC);   // wall group + 1 where a wall (or a shut gate) still stands
    this.elevD = this.elev;           // the garrison keeps its gates barred, so both sides see the same walls
    this.virt = new Uint16Array(NC);
    this.deadG = new Uint8Array(NC);  // ground hugging the foot of a wall: hard to hit from on top of it
    this.orcBlock = new Uint8Array(NC);
    this.ladderAt = new Int32Array(NC).fill(-1); this.lad = new Uint8Array(NC);
    for (let c = 0; c < NC; c++) if (this.mtype[c] === T.DOOR) this.orcBlock[c] = 1;
    // field works
    this.ob = new Uint8Array(NC); this.wireHp = new Int16Array(NC); this.avHp = new Int16Array(NC); this.mines = new Uint8Array(NC);
    this.cover = new Uint8Array(NC); this.dyn = new Uint8Array(NC);
    this.propAt = new Int32Array(NC).fill(-1);
    this.props = []; this.clays = []; this.propVersion = 0;
    this._syncWalls();
    this.structVersion = 1;

    // navigation
    this.solver = sharedSolver || (sharedSolver = new FlowSolver(GW, GH)); // large scratch buffers: one per page
    this.orcCost = new Uint16Array(NC); this.orcDir = new Uint8Array(NC).fill(255);
    this.gateDir = new Uint8Array(NC).fill(255);
    this.srcBuf = new Int32Array(8192); this.srcMark = new Uint8Array(NC);
    this.navOrc = { cz: this.cz, elev: this.elev, portal: this.portal, step: STEP, ladder: this.lad, virt: this.virt, way: this.way };
    this.navHeavy = { cz: this.cz, elev: this.elev, portal: this.portal, step: 1.6, way: this.way };
    this.navDef = { cz: this.cz, elev: this.elevD, portal: this.portal, step: STEP, way: this.way };
    this.navVeh = { cz: this.cz, elev: this.elevD, portal: this.portal, step: 1.6, way: this.way };
    this.navDirty = true; this.lastNav = -100; this.gateDirty = true;
    this.orders = []; this.orderSeq = 0;

    this.time = 0; this.tick = 0;
    this.projectiles = []; this.aircraft = []; this.timed = []; this.drops = [];
    this.events = [];
    this.focus = null; this.retreated = false;
    this.artyOrd = []; this.arty = []; // per-group orders for mortars and howitzers: { mode: 'free' | 'target' | 'hold', x, y, r }
    this.hvt = []; this.caches = []; this.heavy = []; this.cmds = [[], []];
    this.count = [0, 0]; this.initial = [0, 0]; this.defCombat = 0;
    this.result = null; this.routing = false; this.routT = 0;
    this.stats = { kills: {}, lostDef: {}, lostOrc: {}, defLostBy: {}, shots: 0, startDef: {}, startOrc: {}, breaches: 0, fled: 0, routs: 0,
      laddersUp: 0, towersUp: 0, thrown: 0, dropped: 0, recovered: 0, footholdT: -1, blocked: 0, pinnedDef: 0, rallied: 0, reposts: 0 };
    this.support = {};
    const sb = !!this.opt.sandbox;
    for (const k in SUPPORT) this.support[k] = { left: this.opt.support[k] ?? SUPPORT[k].def, max: this.opt.support[k] ?? SUPPORT[k].def, ready: 0, cd: sb ? SUPPORT[k].cd : SUPPORT[k].cpCd, cost: SUPPORT[k].cost };
    this.cp = sb ? 0 : this.opt.cpStart;
    this.cpStats = { earned: this.cp, bounty: 0, spent: 0, calls: 0 };
    this.bountyUnit = 0;
    this._cand = new Int32Array(24);
    this.defBox = [0, 0, 0, 0]; this.orcMaxX = 0;
    this.linkT = new Float32Array(N);
    this._bx = NaN; this._by = 0; this._bp = 0;
    this._initMorale();
    this.miscGroup = [this.newGroup(DEF, true), this.newGroup(ORC, true)];
    // the defence is reported on by sector: three stretches of the Deeping Wall and the Hornburg
    // named by landmark rather than compass point, so the names hold whichever way the map is drawn
    this.sectors = [['the wall by the keep', 'keep end'], ['the centre of the wall', 'centre'], ['the cliff end of the wall', 'cliff end'], ['the Hornburg', 'Hornburg']].map(([name, short], k) => {
      if (k === 3) return { name, short, x: PO.hornburgFront[0], y: PO.hornburgFront[1] };
      const sg = this.segs[Math.floor(((k + 0.5) * N_WALL) / 3)];
      return { name, short, x: sg.x, y: sg.y };
    });
    this._alertT = new Map();
    this._initWarlord();

    // later waves of the horde wait beyond the valley mouth until the director brings them on
    const reserve = [];
    for (const g of setup.groups) { if (g.team === ORC && g.phase > 0) reserve.push(g); else this._spawnGroup(g); }
    for (let i = 0; i < this.n; i++) { const d = UNITS[this.type[i]]; const b = d.team === DEF ? this.stats.startDef : this.stats.startOrc; b[d.key] = (b[d.key] || 0) + 1; }
    this._initDirector(setup.groups, reserve);
    this._wlStart(setup.groups);
    this.initial[0] = this.defCombat; this.initial[1] = this.count[1];
    this._findArtillery();
    // what one bounty point is worth: the pool divided over every engine, troll and captain the horde has
    if (!sb) {
      let w = 0;
      for (const k in BOUNTY) w += BOUNTY[k] * (this.stats.startOrc[k] || 0);
      this.bountyUnit = w > 0 ? (BOUNTY_SHARE * this.opt.cpRate * (this.opt.dawn > 0 ? this.opt.dawn : 1200)) / w : 0;
    }
    this._startMorale();
  }

  /** Put a formation on the field. `atX` overrides where (late arrivals); returns how many found room. */
  _spawnGroup(g, atX, marching) {
    const pos = groupPositions(this.map, atX === undefined ? g : { ...g, x: atX }, true);
    const ti = U[g.type], d = UNITS[ti];
    const n = Math.min(g.count, pos.length / 2);
    if (d.cls === C.OBST) { for (let k = 0; k < n; k++) this._addWork(d.ob, pos[k * 2], pos[k * 2 + 1], g.ang); return n; }
    if (!n) return 0;
    const gid = this.newGroup(d.team, n < 5 || d.sz > 0 || d.cmd || (d.team === DEF && d.cls !== C.INF));
    if (d.fearless) this.gFearless[gid] = 1;
    this.gType[gid] = ti; this.gWave[gid] = g.phase || 0;
    if (d.team === ORC) this._wlAdd(gid, g);
    const face = d.team === DEF ? Math.PI : 0;
    let made = 0;
    for (let k = 0; k < n; k++) {
      // (a man put on a wall walk looks out over its parapet, whichever way that stretch of wall faces)
      const sg = d.team === DEF ? this.mseg[this.map.cellOf(pos[k * 2], pos[k * 2 + 1])] : -1, out = sg >= 0 ? Math.atan2(this.segs[sg].ny, this.segs[sg].nx) : face;
      const i = this.spawn(ti, pos[k * 2], pos[k * 2 + 1], out + (marching ? 0 : (this.rand() - 0.5) * 0.3), gid);
      if (i < 0) break;
      made++;
      if (d.team === ORC) { this.state[i] = !marching && g.delay > 0 ? S_WAIT : S_MOVE; this.aux[i] = marching ? 0 : g.delay || 0; this.linkT[i] = this.time; if (d.crew) { this.cd2[i] = 0; this.eIdle[i] = this.time; } }
    }
    return made;
  }

  // ---------------------------------------------------------------- units
  spawn(ti, x, y, rot = 0, g = -1) {
    let i;
    if (this.free.length) i = this.free.pop(); else if (this.n < MAX_UNITS) i = this.n++; else return -1;
    const d = UNITS[ti];
    this.alive[i] = 1; this.team[i] = d.team; this.type[i] = ti; this.state[i] = S_IDLE; this.ord[i] = -1;
    this.gen[i]++; this.holdR[i] = 0;
    this.x[i] = this.px[i] = x; this.y[i] = this.py[i] = y; this.vx[i] = this.vy[i] = 0; this.sepx[i] = this.sepy[i] = 0;
    this.bx[i] = x; this.by[i] = y;
    this.rot[i] = rot; this.trot[i] = rot;
    this.hp[i] = d.crew && d.crew.hp ? d.crew.hp : d.hp; this.rad[i] = d.rad;
    this.cd[i] = this.rand() * 1.2; this.cd2[i] = this.rand();
    const am = this.opt.ammoMult;
    this.ammo[i] = d.pool ? d.pool : d.carry ? d.carry : d.ammo ? (am > 50 ? 1e9 : Math.ceil(d.ammo * am)) : 0;
    this.ammo2[i] = d.ammo2 ? (am > 50 ? 1e9 : d.ammo2 * am) : 0;
    this.target[i] = this.target2[i] = -1; this.aux[i] = 0; this.aux2[i] = -1; this.hitT[i] = -10; this.fireT[i] = -10; this.linkT[i] = 0; this.snagT[i] = 0;
    this.crewOf[i] = -1; this.crewAcc[i] = this.crewPts[i] = this.haveAcc[i] = this.crewHave[i] = 0; this.slotAcc[i] = this.slotMask[i] = 0;
    this.eHalt[i] = 0; this.eIdle[i] = 0; this.eEver[i] = 0; this.eNoDraft[i] = 0; this.stuck[i] = 0;
    this.rank[i] = 0; this.pose[i] = 0; this.ax[i] = x; this.ay[i] = y; this.seekT[i] = 0;
    const c = this.map.cellOf(x, y);
    this.el[i] = (d.team === DEF ? this.elevD[c] : this.elev[c]) ? 1 : 0;
    if (g < 0) g = this.miscGroup[d.team];
    this.grp[i] = g; this.gAlive[g]++; this.gN0[g]++;
    this.count[d.team] += this._per(d);
    if (d.team === DEF && d.cls !== C.CACHE) this.defCombat++;
    return i;
  }

  /** How many a unit of this kind counts for in its side's strength. A crewed engine is timber, not troops. */
  _per(d) { return (d.crew ? 0 : 1) + (d.carry || 0); }

  maxAmmo(i) { const d = UNITS[this.type[i]]; return d.pool ? d.pool : Math.ceil((d.ammo || 0) * Math.min(this.opt.ammoMult, 50)); }

  /** Which sector a wall segment belongs to. */
  segSector(k) { return k >= N_WALL ? 3 : Math.min(2, Math.floor((k * 3) / N_WALL)); }
  /** Which sector a point on the defenders' side falls in. */
  sectorAt(x, y) {
    const dx = x - KEEP.cx, dy = y - KEEP.cy;
    if (dx * dx + dy * dy < (KEEP.r + 14) * (KEEP.r + 14)) return 3;
    const y0 = this.map.wallJoin.y, y1 = this.map.wallTop.y;
    return Math.max(0, Math.min(2, Math.floor(((y - y0) / (y1 - y0)) * 3)));
  }

  /**
   * Tell the player something, at most once every `gap` seconds per key. Alerts carry a map
   * position so the UI can ping it and jump the camera there.
   */
  _alert(key, gap, text, cls, x, y, banner, big) {
    if (key) { const t = this._alertT.get(key); if (t !== undefined && this.time < t) return false; this._alertT.set(key, this.time + gap); }
    this.events.push({ type: banner ? 'banner' : 'log', text, cls, x, y, big: !!big });
    return true;
  }

  /** Height of a unit's feet above datum. */
  unitZ(i) {
    const x = this.x[i], y = this.y[i];
    if (this.state[i] === S_CLIMB) {
      const L = this.target2[i], u = Math.min(1, (this.time - this.aux[i]) / (L >= 0 && this.type[L] === U.tower ? TOWER_TIME : LADDER_TIME));
      return this.map.groundZ(this.bx[i], this.by[i]) * (1 - u) + this.segTop[0] * u;
    }
    if (this.el[i]) { const s = this.mseg[this.map.cellOf(x, y)]; if (s >= 0) return this.segTop[s]; }
    return this.map.groundZ(x, y);
  }

  damage(i, dmg, w) {
    if (!this.alive[i]) return;
    const d = UNITS[this.type[i]];
    if (w) dmg *= ARMOR_MULT[w.kind][d.crew ? A.ENGINE : d.armor];
    if (dmg <= 0) return;
    this.hitT[i] = this.time;
    if ((this.hp[i] -= dmg) <= 0) this.kill(i, w);
  }

  kill(i, w, silent) {
    if (!this.alive[i]) return;
    this.alive[i] = 0;
    const d = UNITS[this.type[i]], team = d.team, x = this.x[i], y = this.y[i];
    this.count[team] -= d.crew ? 0 : 1;
    if (w && w.key === 'rocket' && d.role === R.CATAPULT) this.catWary = true; // the rest learn to keep their distance
    const g = this.grp[i];
    this.gAlive[g]--;
    const key = w ? w.key : 'other';
    if (!silent) {
      this.gRecent[g] += 1;
      const lc = ((y / OCS) | 0) * OW + ((x / OCS) | 0);
      if (this.loss[team][lc] < 65535) this.loss[team][lc]++;
    }
    if (team === ORC) {
      if (!silent) {
        this.stats.kills[key] = (this.stats.kills[key] || 0) + 1;
        this.stats.lostOrc[d.key] = (this.stats.lostOrc[d.key] || 0) + 1;
        if (this.bountyUnit && BOUNTY[d.key]) {
          const amt = this.bountyUnit * BOUNTY[d.key];
          this.cp = Math.min(this.opt.cpCap, this.cp + amt); this.cpStats.bounty += amt; this.cpStats.earned += amt;
          this.events.push({ type: 'cp', amt, x, y });
        }
      }
      if (d.role === R.LADDER || d.role === R.TOWER) {
        const k = this.aux2[i];
        if (k >= 0) {
          const s = this.segs[k];
          if (this.state[i] === S_DONE) { s.ladders--; this._unlink(i); } else s.claimed--;
        }
        if (d.role === R.TOWER) {
          // whoever was still inside either scrambles out or goes down with it
          const aboard = this.ammo[i] | 0, out = silent ? aboard : Math.floor(aboard * 0.5);
          this.count[ORC] -= aboard;
          if (!silent && aboard - out > 0) { this.stats.kills[key] = (this.stats.kills[key] || 0) + aboard - out; this.stats.lostOrc.uruk = (this.stats.lostOrc.uruk || 0) + aboard - out; }
          const tg = this.target[i] >= 0 ? this.target[i] : this.miscGroup[ORC];
          for (let k2 = 0; k2 < out; k2++) {
            const a = this.rand() * 6.28, rr = 3 + this.rand() * 6;
            let sx = x + Math.cos(a) * rr, sy = y + Math.sin(a) * rr;
            const sc = this.map.cellOf(sx, sy);
            if (this.mtype[sc] === T.CLIFF || this.elev[sc]) { sx = x; sy = y; }
            const j = this.spawn(U.uruk, sx, sy, a, tg); if (j >= 0) this.state[j] = S_MOVE;
          }
        }
      } else if (d.role === R.SAPPER && !silent && this.rand() < 0.4) {
        this.timed.push({ t: this.time + 0.15, f: () => this.explode(x, y, 16, 520, W.blast, ORC, true) });
      }
    } else if (d.cls !== C.CACHE) {
      this.defCombat--;
      this.stats.lostDef[d.key] = (this.stats.lostDef[d.key] || 0) + 1;
      this.stats.defLostBy[key] = (this.stats.defLostBy[key] || 0) + 1;
    }
    if (d.cmd && !silent) this._cmdDown(i, team, x, y);
    if (!silent) this.fx.death(this.type[i], x, y, this.unitZ(i), this.rot[i], this._bx, this._by, this._bp);
    this.free.push(i);
  }

  // ------------------------------------------------------------- terrain
  /** Recompute which cells still carry a standing wall after a breach. */
  _syncWalls() {
    const { elev, virt, deadG, mseg, segs } = this;
    for (let c = 0, n = GW * GH; c < n; c++) {
      const s = mseg[c];
      if (s < 0 || segs[s].breached) { elev[c] = 0; virt[c] = 0; continue; }
      elev[c] = segs[s].group + 1; virt[c] = segs[s].virt;
    }
    deadG.fill(0);
    for (let gy = 1; gy < GH - 1; gy++) for (let gx = 1; gx < GW - 1; gx++) {
      const c = gy * GW + gx;
      if (elev[c] || this.mtype[c] === T.CLIFF) continue;
      const e = elev[c - 1] || elev[c + 1] || elev[c - GW] || elev[c + GW];
      if (e) deadG[c] = e;
    }
  }

  canEnter(cf, ct, sz, orc) {
    const mt = this.mtype[ct];
    if (mt === T.CLIFF) return false;
    let et, ef;
    // (standing wire bars the horde, whatever its size, until a way is cut; the garrison knows the paths through its own)
    if (orc) { if (this.orcBlock[ct] || ((this.ob[ct] & OB.WIRE) && !(this.ob[cf] & OB.WIRE))) return false; et = this.elev[ct]; ef = this.elev[cf]; } else { et = this.elevD[ct]; ef = this.elevD[cf]; }
    if (et === ef) {
      if (et) return true;
      const dz = this.cz[ct] - this.cz[cf];
      if (dz > STEP || dz < -STEP) return false;
      if (this.way[ct] !== this.way[cf] && (dz > WAY_STEP || dz < -WAY_STEP)) return false; // a roadway's walled side
      if (sz === 0) return true;
      if (sz === 2 && (mt === T.STAIR || dz > 1.6 || dz < -1.6 || (this.ob[ct] & OB.AV))) return false;
      return true;
    }
    if (sz === 2) return false; // (a troll takes the stairs like anyone; an engine or a vehicle cannot)
    const k = KDIR[(((ct / GW) | 0) - ((cf / GW) | 0) + 1) * 3 + (ct % GW) - (cf % GW) + 1];
    return k >= 0 && ((this.portal[cf] >> k) & 1) === 1;
  }

  /** Place a defensive work piece. */
  _addWork(kind, x, y, ang) {
    const c = this.map.cellOf(x, y);
    const prop = { kind, x, y, ang, alive: 1 };
    if (kind === 'wire') { if (this.ob[c] & OB.WIRE) return; this.ob[c] |= OB.WIRE; this.wireHp[c] = WIRE_HP; this.propAt[c] = this.props.length; }
    else if (kind === 'av') { if (this.ob[c] & OB.AV) return; this.ob[c] |= OB.AV; this.avHp[c] = AV_HP; this.cover[c] = 1; this.propAt[c] = this.props.length; }
    else if (kind === 'mine') { if (this.mines[c] > 200) return; this.mines[c]++; }
    else if (kind === 'claymore') {
      // face the enemy: the perpendicular to the laid line that points down the valley
      let dx = -Math.sin(ang), dy = Math.cos(ang);
      if (dx > 0.01 || (Math.abs(dx) <= 0.01 && dy > 0)) { dx = -dx; dy = -dy; }
      prop.ang = Math.atan2(dy, dx);
      this.clays.push({ x, y, dx, dy, prop });
    }
    this.props.push(prop);
  }

  _clearOb(c, flag) {
    if (!(this.ob[c] & flag)) return;
    this.ob[c] &= ~flag;
    if (flag === OB.AV) this.cover[c] = 0;
    const p = this.propAt[c];
    if (p >= 0 && this.props[p].alive) { this.props[p].alive = 0; this.propVersion++; this.fx.dust(this.props[p].x, this.props[p].y, this.map.groundZ(this.props[p].x, this.props[p].y), 2.5); }
    this.propAt[c] = -1;
  }

  // mode: 0 attacker, 1 defender;  sz: 0 foot, 1 big, 2 heavy;  free: not held up by the press (routers, crews running to their engine)
  _move(i, dirx, diry, speed, sz, mode, free) {
    const x = this.x[i], y = this.y[i];
    const fx = (x / FINE) | 0, fy = (y / FINE) | 0;
    const ph = this.tick + i;
    if ((ph & 1) === 0 && ((ph & 2) === 0 || this.sepx[i] !== 0 || this.sepy[i] !== 0)) {
      let sx = 0, sy = 0, cnt = 0;
      const ri = this.rad[i], head = this.head, next = this.next, X = this.x, Y = this.y, RAD = this.rad, EL = this.el, ei = EL[i];
      const gap = this.gOpen[this.grp[i]] && !ei ? 1.5 : 0.42; // a company in open order keeps wide intervals
      const y0 = fy > 0 ? fy - 1 : 0, y1 = fy < FH - 1 ? fy + 1 : FH - 1, x0 = fx > 0 ? fx - 1 : 0, x1 = fx < FW - 1 ? fx + 1 : FW - 1;
      for (let cy = y0; cy <= y1 && cnt < 26; cy++) {
        for (let cx = x0; cx <= x1; cx++) {
          for (let j = head[cy * FW + cx]; j >= 0; j = next[j]) {
            if (j === i || EL[j] !== ei) continue;
            if (RAD[j] > 1 || ri > 1) continue; // big bodies are handled below: they shove the small, never the reverse
            cnt++;
            const dx = x - X[j], dy = y - Y[j];
            const rr = ri + RAD[j] + gap;
            const d2 = dx * dx + dy * dy;
            if (d2 < rr * rr) {
              if (d2 > 1e-4) { const d = Math.sqrt(d2), f = (rr - d) / (rr * d); sx += dx * f; sy += dy * f; }
              else { sx += ((i * 7 + j) % 5) - 2; sy += ((i * 3 + j * 5) % 5) - 2; }
            }
          }
        }
      }
      {
        // trolls and engines are found through their own coarse grid, whatever their radius
        const bh = this.bigHead, bn = this.bnext, ST = this.state, mine = this.crewOf[i];
        const bx = (x / BCS) | 0, by = (y / BCS) | 0;
        const by0 = by > 0 ? by - 1 : 0, by1 = by < BH - 1 ? by + 1 : BH - 1, bx0 = bx > 0 ? bx - 1 : 0, bx1 = bx < BW - 1 ? bx + 1 : BW - 1;
        for (let cy = by0; cy <= by1; cy++) for (let cx = bx0; cx <= bx1; cx++) {
          for (let j = bh[cy * BW + cx]; j >= 0; j = bn[j]) {
            if (j === i || EL[j] !== ei || j === mine || ST[j] === S_DONE) continue;
            const dx = x - X[j], dy = y - Y[j];
            const rr = ri + RAD[j] + 0.42;
            const d2 = dx * dx + dy * dy;
            if (d2 < rr * rr && d2 > 1e-4) { const d = Math.sqrt(d2), f = (rr - d) / (rr * d) * (ri > 1 ? 0.6 : 1.6); sx += dx * f; sy += dy * f; }
          }
        }
      }
      this.sepx[i] = sx; this.sepy[i] = sy;
    }
    const c0 = ((y / CELL) | 0) * GW + ((x / CELL) | 0);
    const t0 = this.mtype[c0];
    if (t0 !== T.GROUND) {
      if (t0 === T.WATER) speed *= 0.75;
      else if (t0 === T.STAIR) speed *= 0.6;
      else if (t0 === T.WALL && !this.elev[c0]) speed *= 0.45; // scrambling over rubble
    }
    const o = this.ob[c0];
    if (o) {
      if (o & OB.WIRE) {
        if (mode) speed *= 0.5;
        else {
          speed *= sz ? 0.6 : 0.3; // (caught in it: dropped among them, or still standing in it)
          if ((this.wireHp[c0] -= sz === 2 ? 40 : sz ? 14 : 1) <= 0) this._clearOb(c0, OB.WIRE);
        }
      }
      if (o & OB.AV) { speed *= 0.8; if (!mode && sz === 1 && (this.avHp[c0] -= 30) <= 0) this._clearOb(c0, OB.AV); } // (a troll among the obstacles wrenches them loose)
    }
    const k = 1.7 * (speed > 1 ? speed : 1);
    let vx = this.vx[i], vy = this.vy[i];
    if (!mode && this.sepx[i] * dirx + this.sepy[i] * diry < -0.35) {
      // somebody standing square in his way pushes back exactly as hard as he pushes on: step round
      const sd = i & 1 ? 0.7 : -0.7, ox = dirx;
      dirx -= diry * sd; diry += ox * sd;
    }
    vx += (dirx * speed + this.sepx[i] * k - vx) * 0.42;
    vy += (diry * speed + this.sepy[i] * k - vy) * 0.42;
    const vm = vx * vx + vy * vy, lim = speed * 1.25 + 0.6;
    if (vm > lim * lim) { const f = lim / Math.sqrt(vm); vx *= f; vy *= f; }
    let nx = x + vx * DT, ny = y + vy * DT;
    if (nx < 2) nx = 2; else if (nx > WORLD_W - 2) nx = WORLD_W - 2;
    if (ny < 2) ny = 2; else if (ny > WORLD_H - 2) ny = WORLD_H - 2;
    let blocked = -1;
    const c1 = ((ny / CELL) | 0) * GW + ((nx / CELL) | 0);
    if (c1 !== c0) {
      const orc = !mode;
      // (someone shoved onto the edge of a rock face may always step off it onto open ground)
      if (!this.canEnter(c0, c1, sz, orc) && !(t0 === T.CLIFF && this.mtype[c1] !== T.CLIFF && !this.elev[c1])) {
        blocked = c1;
        if (orc) {
          // held up by wire or an obstacle: those at the front tear at it (it shows in its health, and goes when that is spent)
          const ob1 = this.ob[c1];
          if ((ob1 & OB.WIRE) && (this.wireHp[c1] -= sz === 2 ? 40 : sz ? 14 : 1) <= 0) this._clearOb(c1, OB.WIRE);
          if ((ob1 & OB.AV) && sz === 2 && (this.avHp[c1] -= 6) <= 0) this._clearOb(c1, OB.AV);
        }
        const ca = ((y / CELL) | 0) * GW + ((nx / CELL) | 0);
        if (ca === c0 || this.canEnter(c0, ca, sz, orc)) { ny = y; vy *= 0.3; }
        else {
          const cb = ((ny / CELL) | 0) * GW + ((x / CELL) | 0);
          if (cb === c0 || this.canEnter(c0, cb, sz, orc)) { nx = x; vx *= 0.3; }
          else {
            nx = x; ny = y;
            // boxed in on both sides: if the way lies through the corner of the cell (the foot of a ramp), make for the corner itself
            const gx0 = (x / CELL) | 0, gy0 = (y / CELL) | 0, qx = dirx > 0.2 ? 1 : dirx < -0.2 ? -1 : 0, qy = diry > 0.2 ? 1 : diry < -0.2 ? -1 : 0;
            if (orc && qx && qy && gx0 + qx >= 0 && gx0 + qx < GW && gy0 + qy >= 0 && gy0 + qy < GH && this.canEnter(c0, (gy0 + qy) * GW + gx0 + qx, sz, true)) {
              const ex = (gx0 + (qx > 0 ? 1 : 0)) * CELL + qx * 0.2 - x, ey = (gy0 + (qy > 0 ? 1 : 0)) * CELL + qy * 0.2 - y, el2 = Math.sqrt(ex * ex + ey * ey) || 1, stp = Math.min(el2, speed * DT + 0.05);
              nx = x + (ex / el2) * stp; ny = y + (ey / el2) * stp; blocked = -1;
            } else { vx = 0; vy = 0; }
          }
        }
      } else if (orc && this.mines[c1] && this.rand() < 0.55) {
        this.mines[c1]--;
        const mx = nx, my = ny;
        this.timed.push({ t: this.time, f: () => this.explode(mx, my, W.mine.aoe, W.mine.dmg, W.mine, DEF, false) });
      }
    }
    if (!mode && !sz) {
      // only so many bodies fit in one place: the rest slide along the press or wait their turn
      const f0 = fy * FW + fx, f1 = ((ny / FINE) | 0) * FW + ((nx / FINE) | 0);
      if (f1 !== f0) {
        // (the level he is stepping onto, which is not his own when he comes down off a wall into a breach)
        const lv = this.el[i], lt = this.elev[((ny / CELL) | 0) * GW + ((nx / CELL) | 0)] ? 1 : 0, occ = this.occ, wt = this.rad[i] > 0.7 ? 2 : 1;
        let to = f1;
        if (!free && !this._room(f1, lt, i)) {
          const fa = fy * FW + ((nx / FINE) | 0), fb = ((ny / FINE) | 0) * FW + fx;
          if (fa !== f0 && this._room(fa, lt, i)) { ny = y; vy *= 0.3; to = fa; }
          else if (fb !== f0 && this._room(fb, lt, i)) { nx = x; vx *= 0.3; to = fb; }
          else { nx = x; ny = y; vx *= 0.25; vy *= 0.25; to = f0; if (this.stuck[i] < 250) this.stuck[i]++; }
        }
        if (to !== f0) {
          this.stuck[i] = 0;
          const a = f0 * 2 + lv, b = to * 2 + lt;
          occ[a] = occ[a] > wt ? occ[a] - wt : 0; if (occ[b] < 250) occ[b] += wt;
        }
      }
    }
    this.x[i] = nx; this.y[i] = ny; this.vx[i] = vx; this.vy[i] = vy;
    if ((ph & 1) === 1 && vx * vx + vy * vy > 0.2) {
      let a = Math.atan2(vy, vx) - this.rot[i];
      if (a > Math.PI) a -= 2 * Math.PI; else if (a < -Math.PI) a += 2 * Math.PI;
      this.rot[i] += a * 0.6;
    }
    return blocked;
  }

  /** Is there room for one more in fine cell f on level lv? A soldier stuck for some seconds may squeeze in. */
  _room(f, lv, i) {
    const b = this.blk[f];
    if (b && b - 1 !== this.crewOf[i] && !lv && this.stuck[i] <= 20) return false; // (after a couple of seconds he clambers past timber left lying)
    return this.occ[f * 2 + lv] < CAP + (this.stuck[i] > 30 ? 3 : 0);
  }

  /** Smoothly interpolated flow direction at a point; result in this.fdx / this.fdy. `d` is the field to read (the horde's own by default). */
  _flow(x, y, d = this.orcDir, own = false) {
    const gx = x / CELL - 0.5, gy = y / CELL - 0.5;
    let ix = Math.floor(gx), iy = Math.floor(gy);
    const fx = gx - ix, fy = gy - iy;
    if (ix < 0) ix = 0; else if (ix > GW - 2) ix = GW - 2;
    if (iy < 0) iy = 0; else if (iy > GH - 2) iy = GH - 2;
    const c = iy * GW + ix;
    let sx = 0, sy = 0, k;
    if ((k = d[c]) !== 255) { const w = (1 - fx) * (1 - fy); sx += DXN[k] * w; sy += DYN[k] * w; }
    if ((k = d[c + 1]) !== 255) { const w = fx * (1 - fy); sx += DXN[k] * w; sy += DYN[k] * w; }
    if ((k = d[c + GW]) !== 255) { const w = (1 - fx) * fy; sx += DXN[k] * w; sy += DYN[k] * w; }
    if ((k = d[c + GW + 1]) !== 255) { const w = fx * fy; sx += DXN[k] * w; sy += DYN[k] * w; }
    if ((own || sx * sx + sy * sy < 0.36)) {
      // where the neighbouring cells pull against each other (beside a ramp, round a corner) the blend
      // cancels out and he would dither on the spot, or (`own`) it has just walked him into ground he
      // cannot step onto, off the edge of a causeway: go by the cell he is standing on
      const c0 = ((y / CELL) | 0) * GW + ((x / CELL) | 0);
      if ((k = d[c0]) !== 255) { sx = DXN[k]; sy = DYN[k]; }
    }
    // far from the fight the host marches up the valley in its ranks; close in, it follows the flow
    const far = this.defBox[0] - 200 - x;
    if (far > 0) { const w = far > 120 ? 2.2 : (far / 120) * 2.2; sx += w; }
    const l = Math.sqrt(sx * sx + sy * sy);
    if (l < 0.05) { this.fdx = 0; this.fdy = 0; return false; }
    this.fdx = sx / l; this.fdy = sy / l;
    return true;
  }

  _los(x1, y1, x2, y2) {
    const dx = x2 - x1, dy = y2 - y1, d = Math.sqrt(dx * dx + dy * dy);
    if (d < 20) return true;
    const n = (d / CELL) | 0, ix = dx / n, iy = dy / n;
    let zl, zs;
    for (let k = 2; k < n - 1; k++) {
      const c = (((y1 + iy * k) / CELL) | 0) * GW + (((x1 + ix * k) / CELL) | 0);
      if (this.mtype[c] === T.CLIFF) { if (k > 3 && k < n - 3) return false; continue; }
      if (this.elev[c]) return false;
      // the drums of the Hornburg's inner courts: a shot passes over one only if the line between the two men clears it
      if (this.tier[c]) { if (zl === undefined) { zl = this.cz[this.map.cellOf(x1, y1)] + 1.5; zs = (this.cz[this.map.cellOf(x2, y2)] + 1.5 - zl) / n; } if (this.cz[c] > zl + zs * k + 0.5) return false; }
    }
    return true;
  }

  // ------------------------------------------------------------- grids
  _buildGrids() {
    const { head, ocHead, ocCount, dcHead, dcCount, next, cnext, x, y, alive, team } = this;
    head.fill(-1); ocHead.fill(-1); ocCount.fill(0); dcHead.fill(-1); dcCount.fill(0);
    let bx0 = 1e9, by0 = 1e9, bx1 = -1e9, by1 = -1e9, ox1 = -1e9;
    const lt = U.ladder, tt = U.tower;
    const occ = this.occ, bigHead = this.bigHead, bnext = this.bnext, rad = this.rad, el = this.el;
    occ.fill(0); bigHead.fill(-1);
    for (let i = 0, n = this.n; i < n; i++) {
      if (!alive[i]) continue;
      const xi = x[i], yi = y[i];
      const f = ((yi / FINE) | 0) * FW + ((xi / FINE) | 0);
      next[i] = head[f]; head[f] = i;
      {
        if (rad[i] > 1) { const b = ((yi / BCS) | 0) * BW + ((xi / BCS) | 0); bnext[i] = bigHead[b]; bigHead[b] = i; }
        else { const o = f * 2 + el[i]; if (occ[o] < 250) occ[o] += rad[i] > 0.7 ? 2 : 1; }
      }
      if (team[i] === ORC) {
        const ty = this.type[i];
        if ((ty === lt || ty === tt) && this.state[i] === S_DONE) continue; // raised works are not rifle targets
        if (UNITS[ty].crew) continue;                                // nor is the timber of an engine: its carriers are
        const c = ((yi / OCS) | 0) * OW + ((xi / OCS) | 0);
        cnext[i] = ocHead[c]; ocHead[c] = i; ocCount[c]++;
        if (xi > ox1) ox1 = xi;
      } else {
        const c = ((yi / DCS) | 0) * DW + ((xi / DCS) | 0);
        cnext[i] = dcHead[c]; dcHead[c] = i; dcCount[c]++;
        if (xi < bx0) bx0 = xi; if (xi > bx1) bx1 = xi; if (yi < by0) by0 = yi; if (yi > by1) by1 = yi;
      }
    }
    this.orcMaxX = ox1;
    this.defBox[0] = bx0; this.defBox[1] = by0; this.defBox[2] = bx1; this.defBox[3] = by1;
    // moving siege engines give cover to whoever is behind them
    const dyn = this.dyn; dyn.fill(0);
    for (const i of this.heavy) {
      if (!alive[i]) continue;
      const gx = (x[i] / CELL) | 0, gy = (y[i] / CELL) | 0;
      for (let oy = -1; oy <= 1; oy++) for (let ox = -1; ox <= 1; ox++) { const xx = gx + ox, yy = gy + oy; if (xx >= 0 && yy >= 0 && xx < GW && yy < GH) dyn[yy * GW + xx] = 1; }
    }
    {
      // an engine on the move fills the ground under it
      const blk = this.blk, st = this.blkList;
      for (let k = 0; k < st.length; k++) blk[st[k]] = 0;
      st.length = 0;
      for (const e of this.engines) {
        const cr = UNITS[this.type[e]].crew; // (the list is a few ticks old: a slot may have changed hands)
        if (!alive[e] || !cr || this.state[e] === S_DONE || this.el[e]) continue;
        const bxs = cr.box, c = Math.cos(this.rot[e]), sn = Math.sin(this.rot[e]);
        for (let a = -bxs[0]; a <= bxs[0] + 0.01; a += 1.4) for (let b = -bxs[1]; b <= bxs[1] + 0.01; b += 1.4) {
          const px = x[e] + c * a - sn * b, py = y[e] + sn * a + c * b;
          if (px < 0 || py < 0 || px >= WORLD_W || py >= WORLD_H) continue;
          const bc = ((py / FINE) | 0) * FW + ((px / FINE) | 0);
          blk[bc] = e + 1; st.push(bc);
        }
      }
    }
  }

  _buildAux() {
    const hv = this.hvt, ca = this.caches, he = this.heavy, en = this.engines; hv.length = 0; ca.length = 0; he.length = 0; en.length = 0;
    this.cmds[0].length = 0; this.cmds[1].length = 0;
    const dg = this.danger; dg.fill(0);
    for (let i = 0, n = this.n; i < n; i++) {
      if (!this.alive[i]) continue;
      const d = UNITS[this.type[i]];
      if (d.cmd) this.cmds[d.team].push(i);
      if (d.team === ORC) {
        if (d.hvt && (this.state[i] !== S_DONE || d.role === R.TOWER)) hv.push(i);
        else if (this.crewOf[i] >= 0 && !d.hvt) hv.push(i); // whoever is carrying an engine is a marksman's target
        if (d.sz === 2) he.push(i);
        if (d.crew) en.push(i);
        continue;
      }
      if (d.cls === C.CACHE) ca.push(i);
      const cx = (this.x[i] / OCS) | 0, cy = (this.y[i] / OCS) | 0;
      for (let oy = -2; oy <= 2; oy++) {
        const yy = cy + oy; if (yy < 0 || yy >= OH) continue;
        for (let ox = -2; ox <= 2; ox++) {
          const xx = cx + ox; if (xx < 0 || xx >= OW) continue;
          const v = (ox >= -1 && ox <= 1 && oy >= -1 && oy <= 1) ? 2 : 1;
          if (dg[yy * OW + xx] < v) dg[yy * OW + xx] = v;
        }
      }
    }
  }

  _nav() {
    this.lastNav = this.tick; this.navDirty = false;
    const cost = this.orcCost, mt = this.mtype, cnt = this.navCnt, ob = this.ob, elev = this.elev;
    cnt.fill(0);
    const src = this.srcBuf, mark = this.srcMark; let ns = 0;
    mark.fill(0);
    for (let i = 0, n = this.n; i < n; i++) {
      if (!this.alive[i]) continue;
      const c = ((this.y[i] / CELL) | 0) * GW + ((this.x[i] / CELL) | 0);
      if (this.team[i] === ORC) { if (cnt[c] < 255) cnt[c]++; }
      else if (!mark[c] && ns < src.length) { mark[c] = 1; src[ns++] = c; }
    }
    for (let c = 0, n = GW * GH; c < n; c++) {
      const t = mt[c];
      if (t === T.CLIFF || this.orcBlock[c]) { cost[c] = this.orcBlock[c] && t === T.DOOR ? DOOR_COST : 0; continue; } // (a door to batter down: a way through, at a price)
      let v = t === T.GROUND ? 10 : t === T.WATER ? 13 : t === T.STAIR ? 14 : t === T.WALL ? (elev[c] ? 12 : 22) : 10;
      const o = ob[c];
      if (o) v += (o & OB.WIRE ? WIRE_COST : 0) + (o & OB.AV ? 6 : 0); // (wire is a way through at a price: the time it takes to cut)
      const k = cnt[c];
      cost[c] = v + (k > 20 ? 100 : k * 5);
    }
    if (ns > 0) this.solver.solve(cost, src, ns, this.orcDir, this.navOrc);
    if (this.gateDirty) {
      this.gateDirty = false;
      const g = this.segs[this.map.GATE];
      for (let c = 0, n = GW * GH; c < n; c++) cost[c] = mt[c] === T.CLIFF || mt[c] === T.STAIR || this.orcBlock[c] || elev[c] ? 0 : (ob[c] & OB.AV) ? 150 : (ob[c] & OB.WIRE) ? 40 : 10; // (obstacles: a way for an engine at a price, the time its crew takes to drag them aside)
      src[0] = this.map.cellOf(g.ox, g.oy);
      this.solver.solve(cost, src, 1, this.gateDir, this.navHeavy);
    }
  }

  // --------------------------------------------------------------- step
  step() {
    if (this.result) return;
    this.tick++; this.time += DT;
    if (!this.opt.sandbox && this.cp < this.opt.cpCap) { const inc = Math.min(this.opt.cpCap - this.cp, this.opt.cpRate * DT); this.cp += inc; this.cpStats.earned += inc; }
    if (this.tick % 5 === 1) this._buildAux();
    this._buildGrids();
    // (with ladders going up and coming down all along the wall, the paths are re-solved at most once a second)
    if ((this.navDirty && this.tick - this.lastNav >= 10) || this.tick - this.lastNav >= 20) this._nav();
    const { alive, team, px, py, x, y } = this;
    this._crewTick();
    for (let i = 0, n = this.n; i < n; i++) {
      if (!alive[i]) continue;
      px[i] = x[i]; py[i] = y[i];
      if (team[i] === ORC) this._orc(i); else this._def(i);
    }
    this._projectiles();
    if (this.timed.length) {
      const due = [];
      this.timed = this.timed.filter((e) => (e.t <= this.time ? (due.push(e), false) : true));
      for (const e of due) e.f();
    }
    if (this.aircraft.length) this._aircraft();
    if (this.drops.length) this._drops();
    if (this.tick % 10 === 3) this._supply();
    if (this.tick % 20 === 7) this._ammoWatch();
    if (this.tick % 50 === 9) {
      // firing positions cool off; the ones still hot are what the catapults go looking for
      const hot = this.hot, list = this.hotList; list.length = 0;
      for (let c = 0; c < hot.length; c++) { if (hot[c] <= 0) continue; if ((hot[c] *= 0.8) < 1) hot[c] = 0; else if (hot[c] >= 48 && list.length < 64) list.push(c); }
    }
    if (this.clays.length && this.tick % 3 === 0) this._claymores();
    if (this.tick % 5 === 2) this._morale();
    if (this.dir && this.tick % 5 === 4) this._director();
    if (this.tick % 10 === 6) this._warlord();
    if (this.fieldQ.length && this.tick % 4 === 1 && this.lastNav !== this.tick) this._fieldSolve();
    if (this.focus && this.time > this.focus.until) this.focus = null;
    if (this.tick % 5 === 0) this._checkEnd();
  }

  // ---------------------------------------------------------- attackers
  _nearDef(i, x, y, el) {
    const cx = (x / DCS) | 0, cy = (y / DCS) | 0;
    let best = -1, bd = 1e9, alt = -1, ad = 1e9;
    const y0 = cy > 0 ? cy - 1 : 0, y1 = cy < DH - 1 ? cy + 1 : DH - 1, x0 = cx > 0 ? cx - 1 : 0, x1 = cx < DW - 1 ? cx + 1 : DW - 1;
    for (let yy = y0; yy <= y1; yy++) for (let xx = x0; xx <= x1; xx++) {
      for (let j = this.dcHead[yy * DW + xx]; j >= 0; j = this.cnext[j]) {
        if (!this.alive[j]) continue;
        const dx = this.x[j] - x, dy = this.y[j] - y;
        const d = dx * dx + dy * dy - this.rad[j] * this.rad[j];
        if (this.el[j] === el) { if (d < bd) { bd = d; best = j; } } else if (d < ad) { ad = d; alt = j; }
      }
    }
    return best >= 0 ? best : alt;
  }

  _findDefInRange(x, y, range, el) {
    const cx = (x / DCS) | 0, cy = (y / DCS) | 0, maxR = Math.ceil(range / DCS), r2 = range * range;
    const dc = this.dcHead;
    for (let r = 0; r <= maxR; r++) {
      for (let oy = -r; oy <= r; oy++) {
        const yy = cy + oy; if (yy < 0 || yy >= DH) continue;
        const step = (oy === -r || oy === r || r === 0) ? 1 : 2 * r;
        for (let ox = -r; ox <= r; ox += step) {
          const xx = cx + ox; if (xx < 0 || xx >= DW) continue;
          const j = dc[yy * DW + xx];
          if (j < 0 || !this.alive[j]) continue;
          const dx = this.x[j] - x, dy = this.y[j] - y;
          if (dx * dx + dy * dy > r2) continue;
          if (this.el[j] || el || this._los(x, y, this.x[j], this.y[j])) return j;
        }
      }
    }
    return -1;
  }

  /** Try to start up the ladder or tower that serves wall cell cw. */
  _startClimb(i, cw) {
    const L = this.ladderAt[cw];
    if (L < 0 || !this.alive[L] || this.state[L] !== S_DONE || this.time < this.linkT[L]) return false;
    const tower = this.type[L] === U.tower;
    this.linkT[L] = this.time + (tower ? 0.35 : 0.75);
    this.state[i] = S_CLIMB; this.aux[i] = this.time; this.target2[i] = L;
    this.bx[i] = this.x[L]; this.by[i] = this.y[L]; this.tx[i] = this.tx[L]; this.ty[i] = this.ty[L];
    this.vx[i] = this.vy[i] = 0; this.sepx[i] = this.sepy[i] = 0;
    this.rot[i] = Math.atan2(this.ty[L] - this.y[L], this.tx[L] - this.x[L]);
    return true;
  }

  _climb(i) {
    const L = this.target2[i];
    const ok = L >= 0 && this.alive[L] && this.state[L] === S_DONE && (this.type[L] === U.ladder || this.type[L] === U.tower);
    const u = (this.time - this.aux[i]) / (ok && this.type[L] === U.tower ? TOWER_TIME : LADDER_TIME);
    if (!ok) {
      // the ladder went out from under them
      this.state[i] = S_MOVE; this.target2[i] = -1; this.el[i] = 0;
      this.x[i] = this.bx[i] + (this.rand() - 0.5) * 3; this.y[i] = this.by[i] + (this.rand() - 0.5) * 3;
      this.px[i] = this.x[i]; this.py[i] = this.y[i];
      this.damage(i, 40 + 120 * Math.min(1, u), null);
      return;
    }
    if (u >= 1) {
      this.x[i] = this.tx[i] + (this.rand() - 0.5); this.y[i] = this.ty[i] + (this.rand() - 0.5);
      this.state[i] = S_MOVE; this.target2[i] = -1; this.el[i] = 1; this.target[i] = -1;
      return;
    }
    this.x[i] = this.bx[i] + (this.tx[i] - this.bx[i]) * u; this.y[i] = this.by[i] + (this.ty[i] - this.by[i]) * u;
  }

  _unlink(L) {
    const c = this.map.cellOf(this.tx[L], this.ty[L]);
    if (this.ladderAt[c] === L) { this.ladderAt[c] = -1; this.lad[c] = 0; this.navDirty = true; }
  }

  _orc(i) {
    const d = UNITS[this.type[i]];
    const st = this.state[i];
    const crewed = d.crew; // an engine that needs hands to move it
    if (st === S_WAIT) {
      if (this.time >= this.aux[i]) { this.state[i] = S_MOVE; this.linkT[i] = this.time; }
      else if (crewed) this._engineSpeed(i, d, 0);
      else if (this.crewOf[i] >= 0) this.state[i] = S_MOVE;
      return;
    }
    if (st === S_CLIMB) { this._climb(i); return; }
    if (this.crewOf[i] >= 0 && this._crewStep(i, d)) return;
    const x = this.x[i], y = this.y[i];
    if (this.cd[i] > 0) this.cd[i] -= DT;
    const c = ((y / CELL) | 0) * GW + ((x / CELL) | 0);
    const el = this.elev[c] ? 1 : 0;
    this.el[i] = el;
    const g = this.grp[i], gs = this.gState[g];
    if (st === S_FLEE || (gs >= 2 && !el && x < AP.rout)) {
      // broken: run for the valley mouth
      if (st === S_DONE) return;
      if (crewed) { this.vx[i] *= 0.5; this.vy[i] *= 0.5; return; } // nobody carries timber in a rout
      if (gs === 2 && st !== S_FLEE && this.gRallyX[g] >= 0 && this.gRallyX[g] < x + 40) {
        // a broken company falls back on its captain rather than quitting the field
        const rx = this.gRallyX[g] - x, ry = this.gRallyY[g] - y, rl = Math.sqrt(rx * rx + ry * ry);
        if (rl < 30) { this._move(i, 0, 0, 0, d.sz, 0); return; } // gathered about him: stand, and keep a body's room
        this._move(i, rx / rl, ry / rl, d.speed * 1.15, d.sz, 0, rl > 60);
        return;
      }
      this._move(i, -1, ((i % 9) - 4) * 0.05, d.speed * 1.15, d.sz, 0, 1);
      if (x < AP.exit) { if (st === S_FLEE || gs === 3) { this.stats.fled++; this.kill(i, null, true); } else { this.vx[i] = 0; this.vy[i] = 0; } }
      return;
    }
    let speed = d.speed;
    const pin = this.gPin[g];
    if (pin) speed *= d.cav ? (pin === 2 ? 0.6 : 0.85) : this.gShield[g] ? (pin === 2 ? 0.75 : 0.9) : pin === 2 ? 0.3 : 0.65; // heads down under fire; cavalry, and men behind locked shields, keep more of their pace
    if (this.gConf[g] > this.time) { if (((this.tick + i) & 7) < 5) { this.vx[i] *= 0.6; this.vy[i] *= 0.6; return; } speed *= 0.5; }
    if (crewed) speed = this._engineSpeed(i, d, speed);
    // the warlord's orders to this company: 1 hold in reserve, 2 fall back and regroup
    const ord = this.gOrder[g];
    if (ord && !el && st !== S_DONE && st !== S_ACT && !crewed) {
      const hx = this.gHoldX[g];
      if (x > hx + 3) this._move(i, -1, ((i % 9) - 4) * 0.04, ord === 2 ? d.speed : speed, d.sz, 0, 1);
      else { this.vx[i] *= 0.6; this.vy[i] *= 0.6; }
      return;
    }
    const shut = this.gShield[g] !== 0 || this.time < this.gShieldT[g]; // shields locked, or still coming down
    if (this.gShield[g]) speed *= 0.7;
    else if (x > this.gCapX[g] && speed > 3.3) speed = 3.3; // keeping behind the shield wall
    if (d.cmd && !el && this._captain(i, d, g, x, y, speed)) return;
    // (on a wall walk the fight there leads, except for those coming round to the postern: they go down into the Deep)
    const fld = this.gField[g] && (!el || this._viaDeep(g)) ? this._fieldFor(g, c, d.sz > 0) : this.orcDir;
    switch (d.role) {
      case R.ARCHER: {
        let t = this.target[i];
        const w = d.wdef;
        if (t >= 0) {
          if (this.alive[t] && this.team[t] === DEF) {
            const dx = this.x[t] - x, dy = this.y[t] - y, d2 = dx * dx + dy * dy;
            if (d2 <= w.range * w.range) {
              this.vx[i] *= 0.5; this.vy[i] *= 0.5;
              if (this.cd[i] <= 0 && pin < 2) {
                this.cd[i] = w.reload * (0.8 + 0.4 * this.rand()); this.fireT[i] = this.time;
                this.rot[i] = Math.atan2(dy, dx);
                let acc = w.acc; if (this.el[t] && !el) acc *= 0.22;
                { const pt = this.gPin[this.grp[t]]; if (pt) acc *= pt === 2 ? 0.25 : 0.5; } // men keeping their heads down are hard to hit
                if (this.pose[t]) acc *= this.pose[t] === 2 ? 0.6 : 0.75; // and so is a man kneeling at the parapet or lying prone
                const hit = this.rand() < acc, zt = this.unitZ(t) + 1.2;
                this.fx.tracer(x, y, this.unitZ(i) + 1.3, this.x[t] + (hit ? 0 : (this.rand() - 0.5) * 8), this.y[t] + (hit ? 0 : (this.rand() - 0.5) * 8), zt + (hit ? 0 : this.rand() * 2), TR.ARROW, hit ? 1 : 0);
                this.gSup[this.grp[t]] += 0.5; // bolts rattling off the merlons keep heads down
                if (hit) this.damage(t, w.dmg, w);
              }
              return;
            }
          }
          this.target[i] = t = -1;
        }
        if ((this.tick + i) % 12 === 0) {
          const b = this.defBox, rg = w.range;
          if (x > b[0] - rg && x < b[2] + rg && y > b[1] - rg && y < b[3] + rg) {
            t = this._findDefInRange(x, y, rg * 0.92, el);
            if (t >= 0) { this.target[i] = t; return; }
          }
        }
        let blk = -1;
        if (this._flow(x, y, fld)) blk = this._move(i, this.fdx, this.fdy, speed, 0, 0); else this._move(i, 0, 0, 0, 0, 0);
        if (blk >= 0 && this.lad[blk] && !el) this._startClimb(i, blk);
        return;
      }
      case R.MELEE:
      case R.TROLL: {
        if (((this.tick + i) & 3) === 0) { const b = this.defBox; this.target[i] = x > b[0] - 20 && x < b[2] + 20 && y > b[1] - 20 && y < b[3] + 20 ? this._nearDef(i, x, y, el) : -1; }
        const t = this.target[i];
        let dirx = 0, diry = 0, direct = false;
        if (t >= 0 && this.alive[t] && this.team[t] === DEF) {
          const dx = this.x[t] - x, dy = this.y[t] - y, d2 = dx * dx + dy * dy;
          const tr = this.rad[t], reach = d.reach + tr;
          if (this.el[t] === el) {
            if (d2 < reach * reach) {
              this.vx[i] *= 0.4; this.vy[i] *= 0.4;
              if (this.cd[i] <= 0 && !shut) {
                this.cd[i] = d.mreload * (0.85 + 0.3 * this.rand()); this.fireT[i] = this.time;
                this.rot[i] = Math.atan2(dy, dx);
                const xt = this.x[t], yt = this.y[t], zt = this.unitZ(t);
                if (d.maoe) { this._meleeSweep(xt, yt, d.maoe, d.mdmg, t); this.fx.dust(xt, yt, zt, 3); this.fx.sound('thud', xt, yt, 0.5); }
                else this.fx.melee(xt, yt, zt + 1.2);
                this.damage(t, d.mdmg, d.maoe ? W.smash : W.melee);
              }
              return;
            }
            if (d2 < (7 + tr) * (7 + tr)) { const l = Math.sqrt(d2); dirx = dx / l; diry = dy / l; direct = true; }
          }
        }
        if (!el && !d.sz && ((this.tick + i) & 63) === 0) {
          // a man who has got nowhere in six seconds, with nobody to fight, has lost the way: for a while
          // he makes straight for where his force is bound instead of following the path
          const wx = x - this.bx[i], wy = y - this.by[i];
          if (wx * wx + wy * wy < 4 && t < 0 && this.gPin[g] < 2 && !this.gOrder[g]) this.aux2[i] = this.tick + 90;
          this.bx[i] = x; this.by[i] = y;
        }
        if (!direct && this.aux2[i] > this.tick && this.snagT[i] <= this.time) { // (unless that has just walked him to the edge of a drop)
          const o = this._objOf(g);
          if (o) { const wx = o.x - x, wy = o.y - y, wl = Math.sqrt(wx * wx + wy * wy); if (wl > 6) { dirx = wx / wl; diry = wy / wl; direct = true; } }
        }
        if (!direct && !el && this._viaDeep(g)) {
          // at the head of the ramp from the Deep: straight at the postern door, to batter it
          const ps = this.segs[this.map.POSTERN];
          if (!ps.breached) { const px = ps.x - x, py = ps.y - y, pl = Math.sqrt(px * px + py * py); if (pl < 20 && pl > 0.1) { dirx = px / pl; diry = py / pl; direct = true; } }
        }
        if (!direct && (this._viaDeep(g) || el)) {
          // on the wall walk by the keep: straight at the door from the wall into the court
          const ds = this.segs[this.map.DOOR];
          if (!ds.breached) { const px = ds.x - x, py = ds.y - y, pl = Math.sqrt(px * px + py * py); if (pl < 20 && pl > 0.1) { dirx = px / pl; diry = py / pl; direct = true; } }
        }
        if (!direct && d.role === R.TROLL && !el) {
          // trolls mass on the one stretch of wall the horde means to bring down
          const bs = this._trollSeg(g);
          if (bs >= 0) { const sg = this.segs[bs], bx = sg.x - x, by = sg.y - y, bl = Math.sqrt(bx * bx + by * by); if (bl < 140) { dirx = bx / bl; diry = by / bl; direct = true; } }
        }
        if (!direct) {
          if (this._flow(x, y, fld, this.snagT[i] > this.time)) { dirx = this.fdx; diry = this.fdy; }
          else if (t >= 0 && this.alive[t]) { const dx = this.x[t] - x, dy = this.y[t] - y, l = Math.sqrt(dx * dx + dy * dy) || 1; dirx = dx / l; diry = dy / l; }
          // somewhere his own path does not reach (inside the walls, on ground it was never laid over): make for the garrison
          else if (fld !== this.orcDir && this._flow(x, y, this.orcDir, this.snagT[i] > this.time)) { dirx = this.fdx; diry = this.fdy; }
        }
        const blk = this._move(i, dirx, diry, speed, d.sz, 0);
        if (blk >= 0 && !this.elev[blk] && !this.orcBlock[blk]) this.snagT[i] = this.time + 2; // the ground refused him: see the path note in _flow
        if (blk >= 0 && this.orcBlock[blk] && this.mtype[blk] === T.DOOR && this.cd[i] <= 0 && !shut) {
          // the door from the wall into the court
          this.cd[i] = d.mreload * 1.2; this.fireT[i] = this.time;
          this.fx.melee(x + dirx * 1.5, y + diry * 1.5, this.unitZ(i) + 1.2);
          this.damageSeg(this.map.DOOR, d.sdmg || 8);
        }
        if (blk >= 0 && this.elev[blk]) {
          if (this.lad[blk] && !d.sz && !el && !shut && !d.cav) { this._startClimb(i, blk); return; }
          if (this.cd[i] <= 0) {
            // hack at whatever masonry or timber bars the way
            const k = this.mseg[blk], s = this.segs[k];
            const dmg = d.sdmg ? (s.maxHp > 1e8 ? 0 : d.sdmg) : (s.kind === 'gate' ? 5 : s.kind === 'postern' ? 8 : 0);
            if (dmg) {
              this.cd[i] = d.mreload * 1.2; this.fireT[i] = this.time;
              if (d.sdmg) { this.fx.dust(x + dirx * 3, y + diry * 3, this.unitZ(i) + 2, 4); this.fx.sound('thud', x, y, 0.7); } else this.fx.melee(x + dirx * 1.5, y + diry * 1.5, this.unitZ(i) + 1.2);
              this.damageSeg(k, dmg);
            }
          }
        }
        return;
      }
      case R.LADDER:
      case R.TOWER: {
        if (st === S_DONE) { if (d.role === R.TOWER) this._towerUnload(i); else this._throwCheck(i); return; }
        const tower = d.role === R.TOWER;
        let k = this.aux2[i];
        if (st === S_ACT) {
          if (crewed && !tower && this.crewPts[i] < d.crew.min) { this.aux[i] += DT; return; } // nobody left to heave it up
          if (this.time >= this.aux[i]) {
            const s = this.segs[k];
            if (s.breached) { this.state[i] = S_MOVE; s.claimed--; this.aux2[i] = -1; return; }
            this.state[i] = S_DONE; s.ladders++; s.claimed--; this.cd2[i] = 0;
            if (tower) this.stats.towersUp++; else this.stats.laddersUp++;
            const off = tower ? 4.6 : 2.8;
            this.x[i] = s.x + s.nx * (s.half + off); this.y[i] = s.y + s.ny * (s.half + off);
            this.px[i] = this.x[i]; this.py[i] = this.y[i];
            this.tx[i] = s.x + s.nx * (s.half - 1.6); this.ty[i] = s.y + s.ny * (s.half - 1.6);
            this.rot[i] = Math.atan2(-s.ny, -s.nx);
            const cw = this.map.cellOf(this.tx[i], this.ty[i]);
            this.ladderAt[cw] = i; this.lad[cw] = 1; this.navDirty = true;
            this.fx.dust(this.x[i], this.y[i], this.map.groundZ(this.x[i], this.y[i]), tower ? 6 : 3); this.fx.sound('ladder', this.x[i], this.y[i], tower ? 1 : 0.6);
            const where = this.sectors[this.segSector(k)].short;
            if (tower) this._alert(null, 0, `Siege tower docked — ${where}`, 'bad', this.x[i], this.y[i], true);
            else if (!this._ladderAnnounced) { this._ladderAnnounced = true; this._alert(null, 0, 'Ladders on the Deeping Wall', 'warn', this.x[i], this.y[i], true); }
            else this._alert('ladUp' + this.segSector(k), 25, `Ladders up — ${where}`, 'warn', this.x[i], this.y[i]);
          }
          return;
        }
        if (k < 0 || this.segs[k].breached) {
          if (k >= 0) this.segs[k].claimed--;
          // most crews of a wave make for the stretch of wall it has been aimed at
          const fy = this._forceAimY(g);
          const aim = fy >= 0 ? (i % 5 < 4 ? fy : y) : this.dir && this.dir.aimY >= 0 && i % 5 < 3 ? this.dir.aimY : y;
          k = this._pickLadderSeg(aim); this.aux2[i] = k; if (k >= 0) this.segs[k].claimed++;
        }
        if (k < 0) { if (speed > 0 && this._flow(x, y)) this._move(i, this.fdx, this.fdy, speed, d.sz, 0); return; }
        const s = this.segs[k];
        const ax = s.ox + (tower ? s.nx * 2.2 : 0), ay = s.oy + (tower ? s.ny * 2.2 : 0);
        const dx = ax - x, dy = ay - y, l = Math.sqrt(dx * dx + dy * dy);
        if (l < 130 && !this.ammo2[i]) {
          // seen coming: one warning per engine while there is still time to do something about it
          this.ammo2[i] = 1;
          const where = this.sectors[this.segSector(k)].name;
          if (tower) this._alert(null, 0, `Siege tower closing — ${where}`, 'warn', x, y);
          else this._alert('ladIn' + this.segSector(k), 30, `Ladder crews coming — ${where}`, 'warn', x, y);
        }
        if (l < 2.5) {
          if (crewed && (speed <= 0 || this.gShield[g])) { this.vx[i] = this.vy[i] = 0; return; } // set down at the foot of the wall until there are hands to raise it
          this.state[i] = S_ACT; this.aux[i] = this.time + (tower ? 3 : 4); this.vx[i] = this.vy[i] = 0; this.rot[i] = Math.atan2(-s.ny, -s.nx); return;
        }
        let bc = -1;
        if (crewed && speed <= 0) { this.vx[i] *= 0.4; this.vy[i] *= 0.4; }
        else {
          let mx = dx / l, my = dy / l;
          // far out, follow the path to that stretch of wall; close in, make straight for the chosen spot
          if (!tower && l > 90) { const fl = this._sectorField(this.segSector(k), c); if (fl && this._flow(x, y, fl)) { mx = this.fdx; my = this.fdy; } }
          bc = this._move(i, mx, my, speed, d.sz, 0);
        }
        if (tower) {
          // the crew drag anti-vehicle obstacles aside, slowly
          if (bc >= 0 && (this.ob[bc] & OB.AV) && (this.tick & 15) === 0) this.fx.dust((bc % GW) * CELL + 2, ((bc / GW) | 0) * CELL + 2, this.cz[bc], 3); // (see _move: being held up is what wears the obstacle down)
          // a tower that cannot get forward lets its company out where it stands
          if (Math.abs(this.x[i] - this.bx[i]) + Math.abs(this.y[i] - this.by[i]) > 1.5) { this.bx[i] = this.x[i]; this.by[i] = this.y[i]; this.linkT[i] = this.time; }
          else if (this.time - this.linkT[i] > (crewed ? 40 : 9)) {
            if (crewed && speed <= 0) { if (this.ammo[i] >= 1) { this._alert(null, 0, 'Siege tower abandoned', 'good', x, y); this._towerSpill(i); } this.linkT[i] = this.time; }
            else {
              this._alert(null, 0, 'Siege tower stuck — its company dismounts', 'good', x, y);
              this.fx.death(this.type[i], x, y, this.map.groundZ(x, y), this.rot[i], NaN, 0, 0);
              this.kill(i, null, true);
            }
          }
        }
        return;
      }
      case R.RAM: {
        const gseg = this.segs[this.map.GATE];
        if (this.gateDir[c] !== 255) this.linkT[i] = this.time;
        if (gseg.breached || (!crewed && this.time - this.linkT[i] > 12)) {
          if (!crewed) for (let k = 0; k < 8; k++) { const j = this.spawn(U.uruk, x + (this.rand() - 0.5) * 6, y + (this.rand() - 0.5) * 6, this.rot[i], g); if (j >= 0) this.state[j] = S_MOVE; }
          this.kill(i, null, true);
          return;
        }
        const dx = gseg.ox - x, dy = gseg.oy - y, l = Math.sqrt(dx * dx + dy * dy);
        if (l < 140 && !this.ammo2[i]) { this.ammo2[i] = 1; this._alert('ramIn', 20, 'Ram on the causeway', 'bad', x, y); }
        if (l < 5.5) {
          this.linkT[i] = this.time;
          this.vx[i] = this.vy[i] = 0; this.rot[i] = Math.atan2(-gseg.ny, -gseg.nx);
          if (this.cd[i] <= 0 && !(crewed && this.crewPts[i] < d.crew.min)) {
            this.cd[i] = crewed ? 2.5 * d.crew.need / Math.min(d.crew.need, this.crewPts[i]) : 2.5; this.fireT[i] = this.time;
            this.fx.dust(gseg.ox - gseg.nx * 3, gseg.oy - gseg.ny * 3, this.cz[c] + 2, 4); this.fx.sound('ram', gseg.ox, gseg.oy, 1);
            this.damageSeg(this.map.GATE, d.sdmg);
          }
          return;
        }
        const k = this.gateDir[c];
        if (crewed && speed <= 0) { this.vx[i] *= 0.4; this.vy[i] *= 0.4; return; }
        if (k !== 255 && l > 10) this._move(i, DXN[k], DYN[k], speed, 2, 0); else this._move(i, dx / l, dy / l, speed, 2, 0);
        return;
      }
      case R.SAPPER: {
        let k = this.aux2[i];
        if (st === S_ACT) {
          if ((this.tick & 1) === 0) this.fx.spark(x, y, this.unitZ(i) + 1.5);
          if (this.time >= this.aux[i]) this._detonate(i, k);
          return;
        }
        // with the Deeping Wall given up there is nothing to gain by breaching it: the charge goes to the keep,
        // round through the Deep: the culvert first, then the postern, then the gate
        const cu = this.segs[this.map.CULVERT], G = this.map.GATE, P = this.map.POSTERN;
        let keepK = -1;
        if (this.wl.abandoned) {
          keepK = !cu.breached ? this.map.CULVERT : !this.segs[P].breached ? P : !this.segs[G].breached ? G : -1;
        }
        if (k < 0 || this.segs[k].breached || (keepK >= 0 && k !== keepK)) {
          k = keepK >= 0 ? keepK : !cu.breached ? this.map.CULVERT : this._pickLadderSeg(y, true);
          this.aux2[i] = k;
        }
        if (k < 0) { if (this._flow(x, y)) this._move(i, this.fdx, this.fdy, speed, 0, 0); return; }
        const s = this.segs[k], at = k === P ? this._postFoot() : null; // (the postern is reached up the ramp from the Deep)
        const dx = (at ? at.x : s.ox) - x, dy = (at ? at.y : s.oy) - y, l = Math.sqrt(dx * dx + dy * dy);
        if (l < 160 && !this.ammo2[i]) { this.ammo2[i] = 1; this._alert('sapIn', 25, s.culvert ? 'Sappers at the culvert' : k === this.map.POSTERN ? 'Sappers at the postern' : `Sappers coming — ${this.sectors[this.segSector(k)].short}`, 'bad', x, y); }
        if (l < 3) { this.state[i] = S_ACT; this.aux[i] = this.time + 1.6; this.vx[i] = this.vy[i] = 0; this.fx.sound('fuse', x, y, 0.8); return; }
        if ((this.tick + i) % 6 === 0) this.fx.spark(x, y, this.unitZ(i) + 1.5);
        let mx = dx / l, my = dy / l;
        if (l > 60) { const fl = k === this.map.GATE ? this.gateDir : k === this.map.POSTERN ? this._posternField(c) : s.culvert ? this._culvertField() : this._sectorField(this.segSector(k), c); if (fl && this._flow(x, y, fl)) { mx = this.fdx; my = this.fdy; } }
        // he keeps to the pace of the ranks around him, then breaks from them and sprints
        speed = l > 110 ? Math.min(speed, 4.8) : speed * 1.15;
        this._move(i, mx, my, speed, 0, 0, l <= 110);
        return;
      }
      case R.CATAPULT: {
        const w = d.wdef;
        if (st === S_ACT) {
          if (this.cd[i] > 0) return;
          if (crewed && this.crewPts[i] < d.crew.min) return; // nobody to wind it
          if (!this._catTarget(i, w)) { this.state[i] = S_MOVE; return; }
          this.cd[i] = w.reload * (0.9 + 0.2 * this.rand()) * (crewed ? d.crew.need / Math.min(d.crew.need, this.crewPts[i]) : 1); this.fireT[i] = this.time;
          const tx = this.tx[i] + (this.rand() - 0.5) * 2 * w.scatter, ty = this.ty[i] + (this.rand() - 0.5) * 2 * w.scatter;
          this.rot[i] = Math.atan2(ty - y, tx - x);
          this._launch(x, y, this.cz[c] + 3, tx, ty, this.surfZ(tx, ty), w, ORC, 3, w.flight);
          this.fx.sound('catapult', x, y, 0.7);
          // the alert points at the engine, not at where its rocks land: that is the thing to strike
          const sec = this.sectorAt(tx, ty);
          this._alert('catFire' + sec, 240, `Catapults bombarding — ${this.sectors[sec].short}`, 'warn', x, y);
          return;
        }
        if ((this.tick + i) % 10 === 0 && this._catTarget(i, w)) { this.state[i] = S_ACT; this.vx[i] = this.vy[i] = 0; this.cd[i] = 2 + this.rand() * 3; return; }
        if (crewed && speed <= 0) { this.vx[i] *= 0.4; this.vy[i] *= 0.4; return; }
        if (this.catWary) {
          // rockets have found one of them: the rest keep beyond their reach
          const fd = this._fortDist(x, y);
          if (fd < 392) { this._move(i, -1, 0, speed, 2, 0); return; }
          if (fd < 402) { this.vx[i] *= 0.4; this.vy[i] *= 0.4; return; }
        }
        if (this._flow(x, y)) this._move(i, this.fdx, this.fdy, speed, 2, 0);
        return;
      }
    }
  }

  _towerUnload(i) {
    if (this.ammo[i] < 1 || this.tick % 3) return;
    if (this.target[i] < 0) this.target[i] = this.newGroup(ORC);
    const k = this.aux2[i], s = this.segs[k];
    const a = (this.rand() - 0.5) * 3;
    this.ammo[i]--; this.count[ORC]--;
    const j = this.spawn(U.uruk, this.tx[i] + s.tx * a, this.ty[i] + s.ty * a, this.rot[i], this.target[i]);
    if (j >= 0) { this.state[j] = S_MOVE; this.el[j] = 1; }
  }

  _meleeSweep(x, y, r, dmg, skip) {
    const cx = (x / DCS) | 0, cy = (y / DCS) | 0;
    for (let yy = Math.max(0, cy - 1); yy <= Math.min(DH - 1, cy + 1); yy++) for (let xx = Math.max(0, cx - 1); xx <= Math.min(DW - 1, cx + 1); xx++) {
      for (let j = this.dcHead[yy * DW + xx]; j >= 0; j = this.cnext[j]) {
        if (j === skip || !this.alive[j]) continue;
        const dx = this.x[j] - x, dy = this.y[j] - y, rr = r + this.rad[j];
        if (dx * dx + dy * dy < rr * rr) this.damage(j, dmg * 0.6, W.smash);
      }
    }
  }

  _pickLadderSeg(y, any) {
    // (an empty wall is still worth a ladder: it is the quickest way into the Deep, and on to the back doors of the keep)
    let best = -1, bs = 1e9;
    for (let tries = 0; tries < 6; tries++) {
      const k = (this.rand() * this.map.GATE) | 0;
      const s = this.segs[k];
      if (!s || s.kind !== 'wall' || !s.valid || s.breached || (!any && (s.culvert || s.ladders + s.claimed >= 1))) continue;
      const sc = Math.abs(s.y - y) + this.rand() * 120;
      if (sc < bs) { bs = sc; best = k; }
    }
    if (best < 0 && !any) {
      for (let tries = 0; tries < 8; tries++) {
        const k = (this.rand() * this.map.GATE) | 0;
        const s = this.segs[k];
        if (s && s.kind === 'wall' && s.valid && !s.breached && !s.culvert && s.ladders + s.claimed < 3) return k;
      }
    }
    return best;
  }

  _catTarget(i, w) {
    const x = this.x[i], y = this.y[i];
    const b = this.defBox;
    const range = w.range * 1.05, wary = this.catWary;
    if (x < b[0] - range || x > b[2] + range) return false;
    if (wary && this._fortDist(x, y) < 390) return false; // inside rocket reach: pull back before shooting again
    {
      const m = i % 3;
      if (m === 1 && this.wl.breachSeg >= 0) {
        // battering mission: the stretch of wall the trolls are working on
        const sg = this.segs[this.wl.breachSeg], dx = sg.x - x, dy = sg.y - y, d2 = dx * dx + dy * dy;
        if (!sg.breached && d2 <= range * range && d2 >= w.min * w.min) { this.tx[i] = sg.x; this.ty[i] = sg.y; return true; }
      } else if (m === 2 && this.caches.length && this.rand() < 0.4) {
        // the garrison's ammunition
        let best = -1, bd = range * range;
        for (const ci of this.caches) { if (!this.alive[ci]) continue; const dx = this.x[ci] - x, dy = this.y[ci] - y, d2 = dx * dx + dy * dy; if (d2 < bd && d2 >= w.min * w.min) { bd = d2; best = ci; } }
        if (best >= 0) { this.tx[i] = this.x[best]; this.ty[i] = this.y[best]; this._alert('catAmmo', 90, 'Catapults ranging on an ammo point', 'warn', this.tx[i], this.ty[i]); return true; }
      }
    }
    // counter-battery: every other catapult hunts the mortars and guns that keep firing from one place
    if ((i & 1) === 0 && this.hotList.length) {
      const r2c = range * range, m2c = w.min * w.min;
      let bestH = -1, bd = 1e12;
      for (const c of this.hotList) {
        const dx = (c % OW) * OCS + 8 - x, dy = ((c / OW) | 0) * OCS + 8 - y, d2 = dx * dx + dy * dy;
        if (d2 <= r2c && d2 >= m2c && d2 < bd) { bd = d2; bestH = c; }
      }
      if (bestH >= 0) {
        this.tx[i] = (bestH % OW) * OCS + 8; this.ty[i] = ((bestH / OW) | 0) * OCS + 8;
        this._alert('cbat', 45, 'Catapults ranging on your mortars', 'warn', this.tx[i], this.ty[i]);
        return true;
      }
      if (x < b[0] - 150 && !wary) return false; // keep rolling forward until the guns are in reach
    }
    const x0 = Math.max(0, ((x - range) / DCS) | 0), x1 = Math.min(DW - 1, ((x + range) / DCS) | 0);
    const y0 = Math.max(0, ((y - range) / DCS) | 0), y1 = Math.min(DH - 1, ((y + range) / DCS) | 0);
    const r2 = range * range, m2 = w.min * w.min;
    // a pinning mission favours the sector the escalade is going in against
    const aimY = i % 3 !== 1 ? this.wl.mainY : -1;
    let best = -1, bs = 0;
    for (let yy = y0; yy <= y1; yy++) for (let xx = x0; xx <= x1; xx++) {
      const n = this.dcCount[yy * DW + xx];
      if (!n) continue;
      const dx = xx * DCS + 4 - x, dy = yy * DCS + 4 - y, d2 = dx * dx + dy * dy;
      if (d2 > r2 || d2 < m2) continue;
      let sc = (n + 1) * (0.4 + this.rand());
      if (aimY >= 0 && Math.abs(yy * DCS + 4 - aimY) < 70) sc *= 1.25;
      if (sc > bs) { bs = sc; best = yy * DW + xx; }
    }
    if (best < 0) return false;
    this.tx[i] = (best % DW) * DCS + 4; this.ty[i] = ((best / DW) | 0) * DCS + 4;
    return true;
  }

  _detonate(i, k) {
    this.kill(i, null, true);
    const s = this.segs[k];
    if (s.kind === 'gate' || s.kind === 'postern') {
      // the gate facing the valley is built to take six charges; the postern goes at the first
      this.explode(s.ox, s.oy, W.blast.aoe, W.blast.dmg, W.blast, ORC, true);
      this.damageSeg(k, s.kind === 'gate' ? GATE_HP / 6 : 2600);
      return;
    }
    const fresh = !s.breached;
    for (let j = k - 1; j <= k + 1; j++) { const q = this.segs[j]; if (q && q.kind === 'wall') this.breachSeg(j, j !== k); }
    this.explode(s.x, s.y, W.blast.aoe, W.blast.dmg, W.blast, ORC, true);
    if (fresh) this._alert(null, 0, s.culvert ? 'Culvert blown — the wall is breached!' : `Breach — ${this.sectors[this.segSector(k)].short}!`, 'bad', s.x, s.y, true, true);
  }

  damageSeg(k, dmg) {
    const s = this.segs[k];
    if (s.breached || s.maxHp > 1e8) return;
    const before = s.hp / s.maxHp;
    s.hp -= dmg;
    if (s.hp <= 0) {
      this.breachSeg(k);
      const txt = s.kind === 'gate' ? 'The gate has fallen!' : s.kind === 'postern' ? 'Postern broken!' : s.kind === 'door' ? 'Wall door broken!' : `Wall section down — ${this.sectors[this.segSector(k)].short}`;
      this._alert(null, 0, txt, 'bad', s.x, s.y, true, s.kind === 'gate');
      return;
    }
    // warn while there is still something to be done about it
    const now = s.hp / s.maxHp;
    if (s.kind === 'gate' || s.kind === 'postern' || s.kind === 'door') {
      const what = s.kind === 'gate' ? 'Gate' : s.kind === 'postern' ? 'Postern' : 'Wall door';
      // (the light doors at the back go from splintering to broken in seconds: their warnings go to the log, not the banner)
      const loud = s.kind === 'gate';
      if (before > 0.5 && now <= 0.5) this._alert(null, 0, `${what} at half strength`, 'bad', s.x, s.y, loud);
      else if (before > 0.25 && now <= 0.25) this._alert(null, 0, `${what} about to give way`, 'bad', s.x, s.y, loud);
      else if (before >= 1) this._alert(null, 0, `${what} under attack`, 'warn', s.x, s.y);
    } else if (before > 0.5 && now <= 0.5) this._alert('wallHp' + this.segSector(k), 30, `Wall being battered — ${this.sectors[this.segSector(k)].short}`, 'warn', s.x, s.y);
  }

  breachSeg(k, quiet) {
    const s = this.segs[k];
    if (s.breached) return;
    s.breached = true; s.hp = 0; s.ladders = 0;
    if (s.kind === 'door') for (let c = 0, n = GW * GH; c < n; c++) if (this.mtype[c] === T.DOOR) this.orcBlock[c] = 0; // the arch stands open
    this._syncWalls();
    this.navDirty = true; this.gateDirty = true; this.structVersion++; this.stats.breaches++;
    this.fx.breach(s, quiet);
    for (let i = 0; i < this.n; i++) {
      if (!this.alive[i]) continue;
      // raised ladders and docked towers on this section come down with it; anyone standing on it falls
      if ((this.type[i] === U.ladder || this.type[i] === U.tower) && this.aux2[i] === k && this.state[i] === S_DONE) { this._unlink(i); this.aux2[i] = -1; this.kill(i, null); continue; }
      if (this.el[i] && this.mseg[this.map.cellOf(this.x[i], this.y[i])] === k) { this.el[i] = 0; this.damage(i, 60 + this.rand() * 80, W.blast); }
    }
  }

  // ---------------------------------------------------------- defenders
  _def(i) {
    const d = UNITS[this.type[i]];
    if (d.cls === C.CACHE) return;
    const x = this.x[i], y = this.y[i];
    const c = ((y / CELL) | 0) * GW + ((x / CELL) | 0);
    const eg = this.elevD[c], el = eg ? 1 : 0;
    this.el[i] = el;
    const lanes = d.cls === C.INF;
    if (this.state[i] === S_MOVE) {
      const dx = this.tx[i] - x, dy = this.ty[i] - y, d2 = dx * dx + dy * dy;
      // a man lying or kneeling takes a moment to get up before he goes anywhere
      if (this.pose[i]) { this.linkT[i] = this.time + (this.pose[i] === 2 ? 1 : 0.5); this.pose[i] = 0; }
      if (d2 < 1 || this.time > this.aux[i]) { this.state[i] = S_IDLE; this.vx[i] = this.vy[i] = 0; }
      else if (lanes && this.time < this.linkT[i]) { this.vx[i] = this.vy[i] = 0; }
      else {
        let dirx, diry;
        const l = Math.sqrt(d2);
        // follow the order's path field; cut straight to the assigned spot only once it is close and on the same level
        const f = this.ord[i] >= 0 ? this.orders[this.ord[i]] : null;
        let k = f && d2 > 30 ? f.dir[c] : 255;
        const te = this.elev[this.map.cellOf(this.tx[i], this.ty[i])];
        if (eg === 2 && te === 2 && d2 > 16) {
          // along the Hornburg's curtain wall: walk round the ring rather than straight across the court
          const ux = x - KEEP.cx, uy = y - KEEP.cy, ur = Math.sqrt(ux * ux + uy * uy) || 1;
          let da = Math.atan2(this.ty[i] - KEEP.cy, this.tx[i] - KEEP.cx) - Math.atan2(uy, ux);
          if (da > Math.PI) da -= 2 * Math.PI; else if (da < -Math.PI) da += 2 * Math.PI;
          const sg = da > 0 ? 1 : -1, rc = (Math.hypot(this.tx[i] - KEEP.cx, this.ty[i] - KEEP.cy) - ur) * 0.35;
          dirx = (-uy / ur) * sg + (ux / ur) * rc; diry = (ux / ur) * sg + (uy / ur) * rc;
          const dl = Math.sqrt(dirx * dirx + diry * diry) || 1; dirx /= dl; diry /= dl;
        } else {
          if (k !== 255 && d2 < 144 && te === eg && this.tier[this.map.cellOf(this.tx[i], this.ty[i])] === this.tier[this.map.cellOf(x, y)]) k = 255; // (close, and on his own level: straight there)
          if (k !== 255) { dirx = DXN[k]; diry = DYN[k]; } else { dirx = dx / l; diry = dy / l; }
        }
        this._move(i, dirx, diry, Math.min(d.speed, l / DT), d.cls === C.INF ? 0 : 2, 1);
      }
      if (d.cls !== C.VEH) { if (this.cd[i] > 0) this.cd[i] -= DT; return; }
    }
    const g = this.grp[i];
    let slow = this.gState[g] >= 1 || this.gConf[g] > this.time ? 0.6 : 1;
    if (this.gPin[g]) slow *= this.gPin[g] === 2 ? 0.45 : 0.75; // heads down under volleys and rocks
    const w = d.wdef;
    if (lanes && (this.tick + i) % 5 === 0) this._post(i, d, x, y, eg, c);
    if (this.cd[i] > 0) this.cd[i] -= DT * slow;
    else if (this.ammo[i] >= 1) {
      // nobody shoots through the men in front of him: without a line of fire he goes looking for one
      // (grenades and mortar bombs go over their heads)
      if (lanes && this.rank[i] > 2 && !w.arc && w.key !== 'gl') { this.cd[i] = 0.4; if (this.time >= this.seekT[i] && x - this.orcMaxX < w.range * 1.5) this._seek(i, d, x, y, eg, c); }
      else this._fire(i, d, w, 0, eg, x, y, c);
    }
    else if (d.cls === C.INF) this._bayonet(i, x, y);
    if (d.w2def) {
      if (this.cd2[i] > 0) this.cd2[i] -= DT * slow;
      else if (this.ammo2[i] >= 1) this._fire(i, d, d.w2def, 1, eg, x, y, c);
    }
  }

  _bayonet(i, x, y) {
    const fx = (x / FINE) | 0, fy = (y / FINE) | 0, el = this.el[i];
    for (let cy = Math.max(0, fy - 1); cy <= Math.min(FH - 1, fy + 1); cy++) for (let cx = Math.max(0, fx - 1); cx <= Math.min(FW - 1, fx + 1); cx++) {
      for (let j = this.head[cy * FW + cx]; j >= 0; j = this.next[j]) {
        if (!this.alive[j] || this.team[j] !== ORC || this.el[j] !== el) continue;
        const dx = this.x[j] - x, dy = this.y[j] - y;
        if (dx * dx + dy * dy < 5.5) {
          this.cd[i] = 1.1; this.rot[i] = Math.atan2(dy, dx); this.fireT[i] = this.time;
          this.damage(j, W.bayonet.dmg, W.bayonet); this.fx.melee(this.x[j], this.y[j], this.unitZ(j) + 1.2);
          return;
        }
      }
    }
    this.cd[i] = 0.3;
  }

  /** Height of whatever surface is at x,y: a standing wall walk, or the ground. */
  surfZ(x, y) {
    const c = this.map.cellOf(x, y);
    return this.elev[c] ? this.segTop[this.mseg[c]] : this.map.groundZ(x, y);
  }

  _fire(i, d, w, slot, eg, x, y, c) {
    const cdA = slot ? this.cd2 : this.cd, el = eg ? 1 : 0;
    const z0 = (eg ? this.segTop[this.mseg[c]] : this.map.groundZ(x, y)) + (d.cls === C.INF ? 1.4 : 2.2);
    // fire discipline: a focus-fire order overrides it
    const hold = this.focus ? 0 : this.holdR[i];
    if (hold < 0) { cdA[i] = 0.4; return; }
    if (w.arc) {
      const o = this.artyOrd[this.grp[i]];
      if (o && o.mode === 'hold') { cdA[i] = 0.5; return; }
      let aimed = false;
      if (o && o.mode === 'target') {
        // a fire mission: walk rounds around the ordered point (sections out of range keep choosing their own targets)
        const ex = o.x - x, ey = o.y - y, e2 = ex * ex + ey * ey;
        if (e2 <= w.range * w.range && e2 >= w.min * w.min) {
          const a = this.rand() * 6.2832, rr = o.r * Math.sqrt(this.rand());
          this.tx[i] = o.x + Math.cos(a) * rr; this.ty[i] = o.y + Math.sin(a) * rr; aimed = true;
        }
      }
      if (!aimed && !this._acquireIndirect(i, w, x, y)) { cdA[i] = 0.6 + this.rand() * 0.8; return; }
      const tx = this.tx[i] + (this.rand() + this.rand() - 1) * w.scatter, ty = this.ty[i] + (this.rand() + this.rand() - 1) * w.scatter;
      const dist = Math.hypot(tx - x, ty - y);
      this.ammo[i]--; cdA[i] = w.reload * (0.9 + 0.25 * this.rand()); this.fireT[i] = this.time; this.stats.shots++;
      this.hot[((y / OCS) | 0) * OW + ((x / OCS) | 0)] += w.aoe > 8 ? 40 : 16; // muzzle flashes give the position away
      const ang = Math.atan2(ty - y, tx - x);
      if (d.cls === C.INF) this.rot[i] = ang; else this.trot[i] = ang;
      this._launch(x, y, z0, tx, ty, this.surfZ(tx, ty), w, DEF, 2, w.flight + dist / 400);
      this.fx.muzzle(x + Math.cos(ang) * d.rad, y + Math.sin(ang) * d.rad, z0 + 0.6, ang, w.flash, 1);
      this.fx.sound(w.snd, x, y, 1);
      return;
    }
    const tA = slot ? this.target2 : this.target;
    const range = el ? w.range * (this.segTop[this.mseg[c]] > 15 ? 1.2 : 1.12) : w.range;
    // holding fire to a set distance shortens the reach but not the accuracy curve: close shots hit far more often
    const reach = hold > 0 && hold < range ? Math.max(hold, (w.min || 0) + 15) : range;
    let t = tA[i], dx = 0, dy = 0, d2 = 0, ok = false;
    // on a wall he covers the ground before him, not along it
    this._arcOn = !!eg;
    if (this._arcOn) { const sg = this.segs[this.mseg[c]]; this._anx = sg.nx; this._any = sg.ny; }
    if (t >= 0 && this.alive[t] && this.team[t] === ORC) {
      dx = this.x[t] - x; dy = this.y[t] - y; d2 = dx * dx + dy * dy;
      ok = d2 <= reach * reach && d2 >= (w.min || 0) * (w.min || 0) && this._arc(t, dx, dy, d2);
    }
    if (!ok) {
      t = this._acquireDirect(i, w, reach, eg, x, y);
      tA[i] = t;
      if (t < 0) { cdA[i] = 0.25 + this.rand() * 0.4; return; }
      dx = this.x[t] - x; dy = this.y[t] - y; d2 = dx * dx + dy * dy;
    }
    const dist = Math.sqrt(d2) || 1;
    const ang = Math.atan2(dy, dx);
    if (d.cls === C.VEH) this.trot[i] = ang; else this.rot[i] = ang;
    if (slot) this.ammo2[i]--; else this.ammo[i]--;
    cdA[i] = w.reload * (0.85 + 0.3 * this.rand());
    this.fireT[i] = this.time; this.stats.shots++;
    this.wl.heat[this.sectorAt(x, y)]++; // the horde listens to where the firing comes from
    const mr = d.rad + (d.cls === C.VEH ? 2.5 : 0.7);
    const mx = x + Math.cos(ang) * mr, my = y + Math.sin(ang) * mr;
    this.fx.muzzle(mx, my, z0, ang, w.flash, 0);
    this.fx.sound(w.snd, x, y, 1);
    const xt = this.x[t], yt = this.y[t], zt = this.unitZ(t) + 1;
    if (w.speed) {
      const fl = dist / w.speed, sc = dist * 0.012 + 0.6;
      const tx = xt + this.vx[t] * fl + (this.rand() + this.rand() - 1) * sc, ty = yt + this.vy[t] * fl + (this.rand() + this.rand() - 1) * sc;
      this._launch(mx, my, z0, tx, ty, zt - 1, w, DEF, w.trail ? 1 : w.aoe > 4.5 ? 0 : w.tracer === TR.CANNON ? 6 : 5, Math.max(0.1, fl), w.key === 'gl' ? dist * 0.1 : 0);
      return;
    }
    let acc = w.acc + (w.accFar - w.acc) * (dist / range);
    if (el) acc *= 1.1;
    // cover: the foot of one's own wall is dead ground; solid objects and ditches shield whoever is behind them
    const td = UNITS[this.type[t]];
    if (this.state[t] !== S_CLIMB) {
      const tc = ((yt / CELL) | 0) * GW + ((xt / CELL) | 0);
      if (eg && this.deadG[tc] === eg) acc *= 0.3;
      if (td.sz === 0) {
        const c2 = (((yt - (dy / dist) * 4.5) / CELL) | 0) * GW + (((xt - (dx / dist) * 4.5) / CELL) | 0);
        if (this.cover[c2] | this.dyn[c2] | this.cover[tc]) acc *= el ? 0.7 : 0.5;
      }
    }
    if (w.sup) this.gSup[this.grp[t]] += this.gShield[this.grp[t]] ? w.sup * 0.5 : w.sup; // near misses keep heads down too (less so behind shields)
    const pinD = this.gPin[this.grp[i]];
    if (pinD) acc *= pinD === 2 ? 0.7 : 0.85;
    const ce = this.crewOf[t];
    if (el && ce >= 0 && this.gen[ce] === this.crewGen[t] && this.alive[ce]) { const cr = UNITS[this.type[ce]].crew; if (cr && cr.roof) acc *= 0.45; } // under the ram's roof
    const hit = this.rand() < acc;
    if (hit) this._bullet(td.cmd ? this._guard(t) : t, w, x, y);
    else if (this.rand() < 0.3) {
      // a miss into a packed formation still finds somebody
      const oc = ((yt / OCS) | 0) * OW + ((xt / OCS) | 0);
      const j = this.ocHead[oc];
      if (j >= 0 && j !== t && this.ocCount[oc] > 12) this._bullet(j, w, x, y);
    }
    if (w.multi && this.rand() < w.multi) { const j = this.cnext[t]; if (j >= 0 && this.alive[j] && this.team[j] === ORC) this._bullet(j, w, x, y); }
    if (hit) this.fx.tracer(mx, my, z0, xt, yt, zt, w.tracer, 1);
    else {
      const ex = xt + (dx / dist) * 22 + (this.rand() - 0.5) * 5, ey = yt + (dy / dist) * 22 + (this.rand() - 0.5) * 5;
      this.fx.tracer(mx, my, z0, ex, ey, this.surfZ(ex, ey), w.tracer, 0);
    }
  }

  /** A bullet arriving at attacker t from sx,sy: locked shields and pavises stop most of what comes from the front. */
  _bullet(t, w, sx, sy) {
    const g = this.grp[t];
    let p = 0;
    if (this.gShield[g]) p = this.crewOf[t] < 0 ? 0.7 : 0.45;                                    // carriers have their hands full: only their neighbours' shields cover them
    else if (this.type[t] === U.archer && this.time - this.fireT[t] < 6 && !this.el[t]) p = 0.5;  // a pavise, once he has halted to shoot
    if (p && !(this.ob[((this.y[t] / CELL) | 0) * GW + ((this.x[t] / CELL) | 0)] & OB.WIRE)) {
      const dx = sx - this.x[t], dy = sy - this.y[t], r = this.rot[t];
      if (Math.cos(r) * dx + Math.sin(r) * dy > 0.17 * Math.sqrt(dx * dx + dy * dy) && this.rand() < p) { this.stats.blocked++; return; }
    }
    this.damage(t, w.dmg, w);
  }

  /** Who takes a shot aimed at captain t: usually one of the company pressed around him. */
  _guard(t) {
    const x = this.x[t], y = this.y[t], el = this.el[t];
    const fx = (x / FINE) | 0, fy = (y / FINE) | 0;
    let n = 0, pick = -1;
    for (let cy = Math.max(0, fy - 3); cy <= Math.min(FH - 1, fy + 3); cy++) for (let cx = Math.max(0, fx - 3); cx <= Math.min(FW - 1, fx + 3); cx++) {
      for (let j = this.head[cy * FW + cx]; j >= 0; j = this.next[j]) {
        if (j === t || this.team[j] !== ORC || this.el[j] !== el || this.rad[j] > 1 || UNITS[this.type[j]].cmd) continue;
        n++; if (pick < 0 || ((n * 7 + this.tick) & 3) === 0) pick = j;
      }
    }
    return n && this.rand() < Math.min(0.85, n * 0.085) ? pick : t;
  }

  _randOrcInCell(c) {
    const n = this.ocCount[c];
    if (!n) return -1;
    let k = (this.rand() * n) | 0, j = this.ocHead[c];
    while (k-- > 0 && j >= 0) j = this.cnext[j];
    return j >= 0 && this.alive[j] ? j : -1;
  }

  _randOrcNear(cx, cy, r) {
    for (let k = 0; k < 10; k++) {
      const a = this.rand() * 6.2832, rr = r * Math.sqrt(this.rand());
      const x = cx + Math.cos(a) * rr, y = cy + Math.sin(a) * rr;
      if (x < 0 || y < 0 || x >= WORLD_W || y >= WORLD_H) continue;
      const j = this._randOrcInCell(((y / OCS) | 0) * OW + ((x / OCS) | 0));
      if (j >= 0) return j;
    }
    return -1;
  }

  _acquireDirect(i, w, range, eg, x, y) {
    if (x - this.orcMaxX > range) return -1; // the whole horde is still out of reach
    const r2 = range * range, m2 = (w.min || 0) * (w.min || 0), el = eg ? 1 : 0;
    const f = this.focus;
    if (f) {
      const dx = f.x - x, dy = f.y - y, rr = range + f.r;
      if (dx * dx + dy * dy < rr * rr) {
        if (w.pref) {
          // marksmen and anti-armour go for whatever of theirs stands inside the marked circle: this is how a captain is hunted
          const hv = this.hvt, f2 = f.r * f.r;
          let best = -1, bs = 1e18;
          for (let k = 0; k < hv.length; k++) {
            const j = hv[k];
            if (!this.alive[j] || !((UNITS[this.type[j]].hvt || (this.crewOf[j] >= 0 ? 1 : 0)) & w.pref)) continue;
            if (UNITS[this.type[j]].crew && w.kind === K.BULLET) continue;
            const fx = this.x[j] - f.x, fy = this.y[j] - f.y;
            if (fx * fx + fy * fy > f2) continue;
            const ex = this.x[j] - x, ey = this.y[j] - y, e2 = ex * ex + ey * ey;
            if (e2 > r2 || e2 < m2) continue;
            const sc = e2 * (0.5 + this.rand());
            if (sc < bs && this._arc(j, ex, ey, e2) && (el || this.el[j] || this._los(x, y, this.x[j], this.y[j]))) { bs = sc; best = j; }
          }
          if (best >= 0) return best;
        }
        for (let k = 0; k < 3; k++) {
          const j = this._randOrcNear(f.x, f.y, f.r);
          if (j < 0) break;
          const ex = this.x[j] - x, ey = this.y[j] - y, e2 = ex * ex + ey * ey;
          if (e2 <= r2 && e2 >= m2 && (!w.prefOnly || (UNITS[this.type[j]].hvt & w.pref)) && this._arc(j, ex, ey, e2) && (el || this.el[j] || this._los(x, y, this.x[j], this.y[j]))) return j;
        }
      }
    }
    if (w.pref) {
      let best = -1, bs = 1e18;
      const hv = this.hvt;
      for (let k = 0; k < hv.length; k++) {
        const j = hv[k];
        if (!this.alive[j]) continue;
        const td = UNITS[this.type[j]];
        const carrier = !td.hvt && this.crewOf[j] >= 0;
        if (!((carrier ? 1 : td.hvt) & w.pref)) continue;
        if (td.crew && w.kind === K.BULLET) continue; // bullets do nothing to the timber
        const ex = this.x[j] - x, ey = this.y[j] - y, e2 = ex * ex + ey * ey;
        if (e2 > r2 || e2 < m2) continue;
        if (td.cmd && e2 > 22500) continue;        // a captain is not picked out of the host unless close or marked
        const sc = e2 * (0.5 + this.rand()) * (carrier ? 1.2 : td.pri || 1);
        if (sc < bs && this._arc(j, ex, ey, e2) && (el || this.el[j] || this._los(x, y, this.x[j], this.y[j]))) { bs = sc; best = j; }
      }
      if (best >= 0 || w.prefOnly) return best;
    }
    const cx = (x / OCS) | 0, cy = (y / OCS) | 0, maxR = Math.ceil(range / OCS);
    const cand = this._cand, oc = this.ocCount;
    let found = 0, firstR = -1;
    for (let r = 0; r <= maxR; r++) {
      if (firstR >= 0 && r > firstR + 1) break;
      for (let oy = -r; oy <= r; oy++) {
        const yy = cy + oy; if (yy < 0 || yy >= OH) continue;
        const step = (oy === -r || oy === r || r === 0) ? 1 : 2 * r;
        for (let ox = -r; ox <= r; ox += step) {
          const xx = cx + ox; if (xx < 0 || xx >= OW) continue;
          if (oc[yy * OW + xx] > 0) { if (found < 24) cand[found++] = yy * OW + xx; if (firstR < 0) firstR = r; }
        }
      }
    }
    if (!found) return -1;
    let fallback = -1;
    for (let k = 0; k < 5; k++) {
      const j = this._randOrcInCell(cand[(this.rand() * found) | 0]);
      if (j < 0) continue;
      const ex = this.x[j] - x, ey = this.y[j] - y, e2 = ex * ex + ey * ey;
      if (e2 > r2 || e2 < m2) continue;
      if (!this._arc(j, ex, ey, e2) || !(el || this.el[j] || this._los(x, y, this.x[j], this.y[j]))) continue;
      // prefer targets that are not tucked in under one's own wall
      if (eg && !w.speed && this.deadG[((this.y[j] / CELL) | 0) * GW + ((this.x[j] / CELL) | 0)] === eg && this.state[j] !== S_CLIMB) { fallback = j; continue; }
      if (e2 > 22500 && !f && UNITS[this.type[j]].cmd) continue; // a captain is not picked out of the host at long range
      // and ones that are not behind locked shields: at long range rifles hold their fire rather than waste it on a
      // shield wall (machine guns keep it pinned, and a focus-fire order overrides this)
      if (!w.speed && this.gShield[this.grp[j]] && this.crewOf[j] < 0) { if (fallback < 0 && (e2 < 14400 || w.sup >= 1 || f)) fallback = j; continue; }
      return j;
    }
    return fallback;
  }

  _acquireIndirect(i, w, x, y) {
    const r2 = w.range * w.range, m2 = w.min * w.min;
    const f = this.focus;
    if (f) {
      const dx = f.x - x, dy = f.y - y, d2 = dx * dx + dy * dy;
      if (d2 <= r2 && d2 >= m2) {
        const a = this.rand() * 6.2832, rr = f.r * Math.sqrt(this.rand()) * 0.8;
        this.tx[i] = f.x + Math.cos(a) * rr; this.ty[i] = f.y + Math.sin(a) * rr;
        return true;
      }
    }
    if (this.rand() < (w.aoe > 8 ? 0.6 : 0.2)) {
      // counter-battery: the guns, and now and then the mortars, answer a catapult that has just loosed
      let best = -1, bd = r2;
      for (const e of this.engines) {
        if (!this.alive[e] || this.type[e] !== U.catapult || this.time - this.fireT[e] > 25) continue;
        const dx = this.x[e] - x, dy = this.y[e] - y, d2 = dx * dx + dy * dy;
        if (d2 < bd && d2 >= m2) { bd = d2; best = e; }
      }
      if (best >= 0) { this.tx[i] = this.x[best]; this.ty[i] = this.y[best]; return true; }
    }
    const x0 = Math.max(0, ((x - w.range) / OCS) | 0), x1 = Math.min(OW - 1, ((x + w.range) / OCS) | 0);
    const y0 = Math.max(0, ((y - w.range) / OCS) | 0), y1 = Math.min(OH - 1, ((y + w.range) / OCS) | 0);
    const oc = this.ocCount, dg = this.danger, lim = w.aoe > 16 ? 0 : 1;
    let best = -1, bs = 3;
    for (let yy = y0; yy <= y1; yy++) for (let xx = x0; xx <= x1; xx++) {
      const c = yy * OW + xx, n = oc[c];
      if (n < 3 || dg[c] > lim) continue;
      const dx = xx * OCS + 8 - x, dy = yy * OCS + 8 - y, d2 = dx * dx + dy * dy;
      if (d2 > r2 || d2 < m2) continue;
      const sc = n * (0.45 + this.rand());
      if (sc > bs) { bs = sc; best = c; }
    }
    if (best < 0) return false;
    const j = this.ocHead[best];
    const fl = w.flight * 0.8;
    this.tx[i] = (best % OW) * OCS + 8 + (j >= 0 ? this.vx[j] * fl : 0);
    this.ty[i] = ((best / OW) | 0) * OCS + 8 + (j >= 0 ? this.vy[j] * fl : 0);
    return true;
  }

  // -------------------------------------------------- ordnance in flight
  // vis: 0 shell, 1 rocket, 2 mortar bomb, 3 rock, 4 aerial bomb, 5 grenade, 6 cannon round
  _launch(x0, y0, z0, x1, y1, z1, w, team, vis, T, arcH) {
    const dist = Math.hypot(x1 - x0, y1 - y0);
    if (arcH === undefined) arcH = w.arc ? Math.min(110, 16 + dist * 0.22) : 0;
    this.projectiles.push({ x0, y0, z0, x1, y1, z1, t: 0, T, w, team, vis, arcH, x: x0, y: y0, z: z0, px: x0, py: y0, pz: z0, rot: Math.atan2(y1 - y0, x1 - x0) });
  }

  _projectiles() {
    const ps = this.projectiles;
    let k = 0;
    for (let i = 0; i < ps.length; i++) {
      const p = ps[i];
      p.t += DT;
      const u = p.t / p.T;
      if (u >= 1) { this.explode(p.x1, p.y1, p.w.aoe, p.w.dmg, p.w, p.team, !!p.w.ff); continue; }
      p.px = p.x; p.py = p.y; p.pz = p.z;
      p.x = p.x0 + (p.x1 - p.x0) * u; p.y = p.y0 + (p.y1 - p.y0) * u;
      p.z = p.z0 + (p.z1 - p.z0) * u + p.arcH * 4 * u * (1 - u);
      if (p.vis === 1 || p.vis === 2 || p.vis === 4) this.fx.trail(p.x, p.y, p.z, p.vis);
      ps[k++] = p;
    }
    ps.length = k;
  }

  explode(x, y, r, dmg, w, team, ff) {
    const z = this.surfZ(x, y);
    this.fx.explosion(x, y, z, r, w.fxk || 0);
    const x0 = Math.max(0, ((x - r) / FINE) | 0), x1 = Math.min(FW - 1, ((x + r) / FINE) | 0);
    const y0 = Math.max(0, ((y - r) / FINE) | 0), y1 = Math.min(FH - 1, ((y + r) / FINE) | 0);
    const r2 = r * r, enemy = team === DEF ? ORC : DEF, sup = team === DEF ? w.sup || 0 : 0;
    const supD = team === ORC && w === W.rock ? 1.5 : 0, lightHE = r < 5 && team === DEF;
    const high = this.elev[this.map.cellOf(x, y)] ? 1 : 0;
    this._bx = x; this._by = y; this._bp = r;
    for (let cy = y0; cy <= y1; cy++) for (let cx = x0; cx <= x1; cx++) {
      for (let j = this.head[cy * FW + cx]; j >= 0; j = this.next[j]) {
        if (!this.alive[j] || (!ff && this.team[j] !== enemy)) continue;
        const dx = this.x[j] - x, dy = this.y[j] - y, d2 = dx * dx + dy * dy;
        if (d2 >= r2) continue;
        if (sup && this.team[j] === ORC) this.gSup[this.grp[j]] += sup;
        if (w === W.blast && this.type[j] === U.sapper) continue; // a charge going off does not set off the next man's
        if (supD && this.team[j] === DEF) this.gSup[this.grp[j]] += supD;
        // fragmentation is patchy: small targets are either caught or spared, big ones soak the blast
        const f = 1 - Math.sqrt(d2) / r;
        let dm;
        if (this.rad[j] > 1) dm = dmg * (0.25 + 0.75 * f);
        else if (this.rand() < f * f * 1.15) { dm = dmg * (0.6 + 0.4 * f); if (lightHE && this.gShield[this.grp[j]] && this.team[j] === ORC && this.rand() < 0.25) continue; } // locked shields stop some of the splinters of a small burst
        else continue;
        // a wall between the burst and the target takes most of it
        if (this.el[j] !== high && this.state[j] !== S_CLIMB && r < 15) dm *= 0.35;
        if (this.team[j] === DEF) { if (team === ORC && this.el[j]) dm *= 0.6; else if (team === DEF) dm *= 0.7; }
        this.damage(j, dm, w);
      }
    }
    this._bx = NaN;
    if (w.sdmg) { const s = this.mseg[this.map.cellOf(x, y)]; if (s >= 0) this.damageSeg(s, w.sdmg); }
    if (r >= 5) {
      // blast clears wire
      const gx0 = Math.max(0, ((x - r) / CELL) | 0), gx1 = Math.min(GW - 1, ((x + r) / CELL) | 0), gy0 = Math.max(0, ((y - r) / CELL) | 0), gy1 = Math.min(GH - 1, ((y + r) / CELL) | 0);
      for (let gy = gy0; gy <= gy1; gy++) for (let gx = gx0; gx <= gx1; gx++) { const c = gy * GW + gx; if ((this.ob[c] & OB.WIRE) && (this.wireHp[c] -= 450) <= 0) this._clearOb(c, OB.WIRE); }
    }
  }

  _claymores() {
    const cl = this.clays, R2 = W.claymore.range * W.claymore.range;
    for (let n = cl.length - 1; n >= 0; n--) {
      const m = cl[n];
      const x0 = Math.max(0, ((m.x - 44) / OCS) | 0), x1 = Math.min(OW - 1, ((m.x + 44) / OCS) | 0), y0 = Math.max(0, ((m.y - 44) / OCS) | 0), y1 = Math.min(OH - 1, ((m.y + 44) / OCS) | 0);
      let cnt = 0, near = false;
      for (let yy = y0; yy <= y1 && !near; yy++) for (let xx = x0; xx <= x1; xx++) {
        for (let j = this.ocHead[yy * OW + xx]; j >= 0; j = this.cnext[j]) {
          const dx = this.x[j] - m.x, dy = this.y[j] - m.y, d2 = dx * dx + dy * dy;
          if (d2 > R2 * 0.45) continue;
          const dot = dx * m.dx + dy * m.dy;
          if (dot > 0 && dot * dot > d2 * 0.67) { cnt++; if (d2 < 81) near = true; }
        }
      }
      if (cnt < 7 && !near) continue;
      this.fx.claymore(m.x, m.y, this.map.groundZ(m.x, m.y) + 0.4, m.dx, m.dy);
      for (let yy = y0; yy <= y1; yy++) for (let xx = x0; xx <= x1; xx++) {
        for (let j = this.ocHead[yy * OW + xx]; j >= 0; j = this.cnext[j]) {
          if (!this.alive[j]) continue;
          const dx = this.x[j] - m.x, dy = this.y[j] - m.y, d2 = dx * dx + dy * dy;
          if (d2 > R2) continue;
          const dot = dx * m.dx + dy * m.dy;
          if (dot <= 0 || dot * dot < d2 * 0.67) continue;
          if (this.rand() < 0.9 - Math.sqrt(d2) * 0.014) this.damage(j, W.claymore.dmg, W.claymore);
        }
      }
      m.prop.alive = 0; this.propVersion++;
      cl.splice(n, 1);
    }
  }

  // ------------------------------------------------------ player orders
  setFocus(x, y, r) {
    this.focus = { x, y, r: Math.max(18, r), until: this.time + 30 };
    for (let i = 0; i < this.n; i++) if (this.alive[i] && this.team[i] === DEF) { this.target[i] = -1; this.target2[i] = -1; }
  }
  clearFocus() { this.focus = null; }

  /** Path field for an order. `x` may be a list of destination cells instead of a point. */
  _orderField(x, y, veh, r = 14) {
    const cost = new Uint16Array(GW * GH), mt = this.mtype;
    for (let c = 0; c < cost.length; c++) cost[c] = mt[c] === T.CLIFF || (veh && (this.elevD[c] || mt[c] === T.STAIR || (this.ob[c] & OB.AV))) ? 0 : 10;
    let ns = 1;
    if (Array.isArray(x)) { ns = Math.min(x.length, this.srcBuf.length); for (let k = 0; k < ns; k++) this.srcBuf[k] = x[k]; if (!ns) return -1; }
    else { const c = this.map.cellOf(x, y); if (!cost[c]) return -1; this.srcBuf[0] = c; }
    const dir = new Uint8Array(GW * GH);
    this.solver.solve(cost, this.srcBuf, ns, dir, veh ? this.navVeh : this.navDef);
    // take a path slot nobody is following; only when all are busy does the least-used order give its slot up
    const MAXO = 32, use = new Int32Array(MAXO);
    for (let i = 0; i < this.n; i++) if (this.alive[i] && this.team[i] === DEF && this.state[i] === S_MOVE && this.ord[i] >= 0) use[this.ord[i]]++;
    // a slot just handed out stays reserved for a moment: its units are assigned right after this returns
    const hold = this._orderHold || (this._orderHold = new Float32Array(MAXO).fill(-1));
    for (let k = 0; k < MAXO; k++) if (hold[k] >= this.time) use[k] += 1e6;
    let idx = 0;
    for (let k = 1; k < MAXO; k++) if (use[k] < use[idx]) idx = k;
    for (let k = 0; k < MAXO; k++) if (!use[k]) { idx = k; break; }
    hold[idx] = this.time + 2.5;
    this.orders[idx] = { dir, x, y, r };
    if (use[idx]) for (let i = 0; i < this.n; i++) if (this.ord[i] === idx) this.ord[i] = -1;
    return idx;
  }

  /** Move the given defenders to x,y in a compact block. */
  orderMove(ids, x, y) {
    const inf = [], veh = [];
    for (const i of ids) {
      if (!this.alive[i] || this.team[i] !== DEF) continue;
      const d = UNITS[this.type[i]];
      if (!d.speed) continue;
      (d.cls === C.VEH ? veh : inf).push(i);
    }
    let any = false;
    const te = this.elevD[this.map.cellOf(x, y)], tt = this.tier[this.map.cellOf(x, y)];
    for (const [list, isVeh] of [[inf, false], [veh, true]]) {
      if (!list.length) continue;
      const sp = isVeh ? 11 : 2.3;
      const cols = Math.ceil(Math.sqrt(list.length));
      const fi = this._orderField(x, y, isVeh, cols * sp * 0.75 + 10);
      if (fi < 0) continue;
      let k = 0;
      for (let s = 0; s < list.length * 8 && k < list.length; s++) {
        const cx = (s % cols) - (cols - 1) / 2, cy = Math.floor(s / cols) - (cols - 1) / 2;
        const px = x + cx * sp, py = y + cy * sp;
        if (px < 4 || py < 4 || px > WORLD_W - 4 || py > WORLD_H - 4) continue;
        const pc = this.map.cellOf(px, py);
        // keep the whole block on the level that was clicked (all on the wall walk, or all on the ground)
        if (this.mtype[pc] === T.CLIFF || this.elevD[pc] !== te || this.tier[pc] !== tt || (isVeh && (this.mtype[pc] === T.STAIR || (this.ob[pc] & OB.AV)))) continue;
        const i = list[k++];
        this.tx[i] = px; this.ty[i] = py; this.state[i] = S_MOVE; this.ord[i] = fi; this.target[i] = -1; this.ax[i] = px; this.ay[i] = py;
        this.aux[i] = this.time + 30 + Math.hypot(px - this.x[i], py - this.y[i]) / UNITS[this.type[i]].speed * 4;
        any = true;
      }
    }
    return any;
  }

  stop(ids) { for (const i of ids) if (this.alive[i] && this.team[i] === DEF) { this.state[i] = S_IDLE; this.vx[i] = this.vy[i] = 0; } }

  /** Fire discipline for the given defenders: 0 at will, a distance in metres to hold until, or -1 to hold fire. */
  setStance(ids, v) { for (const i of ids) if (this.alive[i] && this.team[i] === DEF) { this.holdR[i] = v; this.target[i] = -1; this.target2[i] = -1; } }

  /** Send the listed [distance, unit] pairs to free positions inside the Hornburg. */
  _toKeep(list) {
    if (!list.length) return 0;
    list.sort((a, b) => a[0] - b[0]);
    if (!this._keepField || this.time - this._keepField.t > 2) {
      const ring = [];
      for (let c = 0; c < GW * GH; c++) if (this.elev[c] === 2) ring.push(c);
      this._keepField = { t: this.time, court: this._orderField(PO.court[0], PO.court[1], false, 6), ring: this._orderField(ring, 0, false, 6) };
    }
    const kf = this._keepField, slots = this.map.keepSlots;
    // the court runs round the inner rock: one path field for each twelfth of it, so that a man is led round the rock to his own place
    const sect = this._keepSectors(), rk = KEEP.t1;
    let s = this._slotCursor || 0;
    for (const [, i] of list) {
      let slot = null;
      for (let tries = 0; tries < slots.length && !slot; tries++) {
        const q = slots[s++ % slots.length];
        const c = ((q.y / DCS) | 0) * DW + ((q.x / DCS) | 0);
        let occ = false;
        for (let j = this.dcHead[c]; j >= 0; j = this.cnext[j]) { const dx = this.x[j] - q.x, dy = this.y[j] - q.y; if (dx * dx + dy * dy < 1.2) { occ = true; break; } }
        if (!occ) slot = q;
      }
      for (let tries = 0; !slot && tries < 12; tries++) { // (no place left: anywhere in the outer court by the muster point)
        const q = { x: PO.courtMuster[0] + (this.rand() - 0.5) * 40, y: PO.courtMuster[1] + (this.rand() - 0.5) * 30 }, qc = this.map.cellOf(q.x, q.y);
        if (tries === 11 || (this.mtype[qc] === T.COURT && !this.tier[qc])) slot = q;
      }
      this.tx[i] = slot.x; this.ty[i] = slot.y; this.state[i] = S_MOVE; this.target[i] = -1; this.ax[i] = slot.x; this.ay[i] = slot.y;
      this.ord[i] = this.elev[this.map.cellOf(slot.x, slot.y)] === 2 ? kf.ring : kf.court;
      if (sect && this.ord[i] === kf.court) { const o = sect[(((Math.atan2(slot.y - rk.y, slot.x - rk.x) + Math.PI) / (2 * Math.PI)) * 12) % 12 | 0]; if (o >= 0) this.ord[i] = o; }
      this.aux[i] = this.time + 40 + Math.hypot(slot.x - this.x[i], slot.y - this.y[i]) / UNITS[this.type[i]].speed * 4;
    }
    this._slotCursor = s % slots.length;
    return list.length;
  }

  /** Path fields into each twelfth of the Hornburg's court (by bearing from the inner rock). Built once: the rock does not move. */
  _keepSectors() {
    if (this._keepSect) return this._keepSect;
    const lists = []; for (let k = 0; k < 12; k++) lists.push([]);
    const rk = KEEP.t1, seen = new Uint8Array(GW * GH);
    for (const q of this.map.keepSlots) {
      const c = this.map.cellOf(q.x, q.y);
      if (seen[c] || this.elev[c] === 2) continue;
      seen[c] = 1; lists[(((Math.atan2(q.y - rk.y, q.x - rk.x) + Math.PI) / (2 * Math.PI)) * 12) % 12 | 0].push(c);
    }
    const cost = new Uint16Array(GW * GH), mt = this.mtype;
    for (let c = 0; c < cost.length; c++) cost[c] = mt[c] === T.CLIFF ? 0 : 10;
    const out = [];
    for (let k = 0; k < 12; k++) {
      const src = lists[k];
      if (!src.length) { out.push(-1); continue; }
      for (let q = 0; q < src.length; q++) this.srcBuf[q] = src[q];
      const dir = new Uint8Array(GW * GH);
      this.solver.solve(cost, this.srcBuf, src.length, dir, this.navDef);
      this.orders[40 + k] = { dir, x: src, y: 0, r: 6 }; // (beyond the pool of order paths, which is recycled)
      out.push(40 + k);
    }
    return (this._keepSect = out);
  }

  /**
   * Fall back to the Hornburg. With no list, every foot soldier outside it goes (the general
   * retreat); with a list of unit ids, only those — a sector can be given up while the rest hold.
   */
  orderRetreat(ids) {
    const list = [];
    const consider = (i) => {
      if (!this.alive[i] || this.team[i] !== DEF) return;
      const d = UNITS[this.type[i]];
      if (d.cls !== C.INF || !d.speed) return;
      const dk = Math.hypot(this.x[i] - KEEP.cx, this.y[i] - KEEP.cy);
      if (dk > KEEP.r + 6 && this.elevD[this.map.cellOf(this.x[i], this.y[i])] !== 2) list.push([dk, i]); // (a man on one of the ring's bastions is in the keep already)
    };
    if (ids) for (const i of ids) consider(i); else for (let i = 0; i < this.n; i++) consider(i);
    if (!list.length) return 0;
    this._toKeep(list);
    if (!ids) { this.retreated = true; this.events.push({ type: 'banner', text: 'Fall back to the keep!', cls: 'warn', x: KEEP.cx, y: KEEP.cy }); }
    return list.length;
  }

  // ------------------------------------------------------------ artillery
  /** List the mortar and howitzer sections the garrison starts with, and name them by where they stand. */
  _findArtillery() {
    const seen = new Map();
    for (let i = 0; i < this.n; i++) {
      if (!this.alive[i] || this.team[i] !== DEF) continue;
      const w = UNITS[this.type[i]].wdef;
      if (!w || !w.arc) continue;
      const g = this.grp[i];
      if (!seen.has(g)) seen.set(g, { g, key: UNITS[this.type[i]].key, w, sx: 0, sy: 0, n: 0 });
      const a = seen.get(g); a.sx += this.x[i]; a.sy += this.y[i]; a.n++;
    }
    const names = new Map();
    for (const a of seen.values()) {
      const cx = a.sx / a.n, cy = a.sy / a.n;
      const where = Math.hypot(cx - KEEP.cx, cy - KEEP.cy) < KEEP.r ? 'Hornburg' : cx > this.map.wallAt(0.5).x + 10 ? 'the Deep' : 'the field';
      let label = `${a.key === 'howitzer' ? 'Howitzers' : 'Mortars'} · ${where}`;
      const k = (names.get(label) || 0) + 1; names.set(label, k);
      if (k > 1) label += ` ${k}`;
      this.arty.push({ g: a.g, key: a.key, w: a.w, label, n: 0, cx, cy, ammo: 1 });
      this.artyOrd[a.g] = { mode: 'free', x: 0, y: 0, r: 0 };
    }
    this.updateArtillery();
  }

  /** Refresh each section's strength, centre and ammunition (cheap enough to call a few times a second). */
  updateArtillery() {
    const A = this.arty;
    if (!A.length) return A;
    const by = new Map(A.map((a) => [a.g, a]));
    for (const a of A) { a.n = 0; a.sx = 0; a.sy = 0; a.am = 0; a.mx = 0; }
    for (let i = 0; i < this.n; i++) {
      if (!this.alive[i] || this.team[i] !== DEF) continue;
      const a = by.get(this.grp[i]);
      if (!a) continue;
      a.n++; a.sx += this.x[i]; a.sy += this.y[i]; a.am += Math.min(this.ammo[i], this.maxAmmo(i)); a.mx += this.maxAmmo(i);
    }
    for (const a of A) {
      if (a.n) { a.cx = a.sx / a.n; a.cy = a.sy / a.n; }
      a.ammo = a.mx ? a.am / a.mx : 0;
      const o = this.artyOrd[a.g]; a.mode = o.mode; a.x = o.x; a.y = o.y; a.r = o.r;
    }
    return A;
  }

  /** Positions of the live guns of one section (for range overlays). */
  groupUnits(g, max = 24) {
    const out = [];
    for (let i = 0; i < this.n; i++) if (this.alive[i] && this.grp[i] === g && this.team[i] === DEF) out.push(i);
    if (out.length <= max) return out;
    const step = out.length / max, s = [];
    for (let k = 0; k < max; k++) s.push(out[Math.floor(k * step)]);
    return s;
  }

  /** Order the listed sections (all when null) onto a point. Returns how many sections can reach it. */
  setArtyTarget(groups, x, y, r = 24) {
    let reach = 0;
    for (const a of this.arty) {
      if (groups && !groups.includes(a.g)) continue;
      if (!a.n) continue;
      const o = this.artyOrd[a.g];
      o.mode = 'target'; o.x = x; o.y = y; o.r = r;
      // reset the reload so the first rounds go out promptly on the new target
      for (let i = 0; i < this.n; i++) if (this.alive[i] && this.grp[i] === a.g && this.cd[i] > 1.5) this.cd[i] = 0.5 + this.rand() * 1.2;
      if (this.artyReach(a, x, y)) reach++;
    }
    return reach;
  }

  /** Can any gun of this section reach x,y? */
  artyReach(a, x, y) {
    const w = a.w;
    for (const i of this.groupUnits(a.g, 12)) {
      const d = Math.hypot(this.x[i] - x, this.y[i] - y);
      if (d <= w.range && d >= w.min) return true;
    }
    return false;
  }

  setArtyMode(g, mode) { const o = this.artyOrd[g]; if (o) o.mode = mode; }

  // -------------------------------------------------------------- outcome
  _checkEnd() {
    if (this.defCombat <= 0) return this._finish(false, 'The garrison has been wiped out.');
    if (this.count[ORC] <= 0) return this._finish(true, this.routing || this.stats.fled > this.initial[ORC] * 0.2 ? 'The horde has broken and fled the valley.' : 'The horde has been annihilated.');
    if (this.routing) { if (this.time > this.routT + 14) this._finish(true, 'The horde has broken and fled the valley.'); return; }
    if (this.opt.rout > 0 && this.count[ORC] <= this.initial[ORC] * this.opt.rout) {
      this.routing = true; this.routT = this.time;
      this._dropReserves();
      for (let i = 0; i < this.n; i++) if (this.alive[i] && this.team[i] === ORC && this.state[i] !== S_DONE && this.state[i] !== S_CLIMB) this.state[i] = S_FLEE;
      this.events.push({ type: 'banner', text: 'The horde breaks — they are running!', cls: 'good' });
      return;
    }
    if (this.opt.dawn > 0 && this.time >= this.opt.dawn) this._finish(true, 'Dawn. The relief column crests the ridge — you held the Deep.');
  }

  _finish(win, reason) {
    this.result = { win, reason, time: this.time };
    this.events.push({ type: 'end', win, reason });
  }

  // ------------------------------------------------------------- queries
  /** Cheap fingerprint of the whole battle state, for checking that runs are reproducible. */
  hash() {
    let h = 0x811c9dc5;
    const mix = (v) => { h = Math.imul(h ^ (v | 0), 0x01000193); };
    mix(this.tick); mix(this.count[0]); mix(this.count[1]); mix(this.defCombat);
    for (let i = 0; i < this.n; i++) { if (!this.alive[i]) continue; mix(i); mix(this.x[i] * 16); mix(this.y[i] * 16); mix(this.hp[i]); }
    return (h >>> 0).toString(16).padStart(8, '0');
  }
}

Object.assign(Sim.prototype, supportMethods, moraleMethods, directorMethods, warlordMethods, engineMethods, postMethods);
