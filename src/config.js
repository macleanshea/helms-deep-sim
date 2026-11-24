// Shared constants and data tables for the simulator.

export const WORLD_W = 1440;
export const WORLD_H = 960;
export const CELL = 4; // nav grid cell size (m)
export const GW = WORLD_W / CELL;
export const GH = WORLD_H / CELL;
export const DT = 0.1; // fixed simulation step (s)

export const DEF = 0;
export const ORC = 1;

// nav cell types
export const T = { GROUND: 0, CLIFF: 1, WALL: 2, WATER: 3, COURT: 4, ROAD: 5, STAIR: 6, DOOR: 7 };

// vertical layout (m)
export const WALL_H = 12;     // Deeping Wall walkway
export const PLATEAU_Z = 12;  // Hornburg rock and courtyard
export const RING_TOP = 21;   // Hornburg curtain wall walkway
export const STEP = 3.3;      // largest height change a unit can walk between neighbouring cells

// obstacle flags per nav cell
export const OB = { WIRE: 1, AV: 2 };

// armour classes
export const A = { FLESH: 0, HEAVY: 1, WOOD: 2, INF: 3, VEH: 4, GUN: 5 };
// damage kinds
export const K = { BULLET: 0, HEAVY: 1, HE: 2, AP: 3, MELEE: 4, BOLT: 5, ROCK: 6, SMASH: 7 };

// damage multiplier [kind][armour]
export const ARMOR_MULT = [
  /* bullet */ [1, 0.22, 0.12, 1, 0.3, 0.6],
  /* heavy  */ [1, 0.7, 0.6, 1, 1, 1],
  /* he     */ [1, 0.75, 1.5, 1, 0.5, 1],
  /* ap     */ [1, 1.3, 0.45, 1, 1, 1],
  /* melee  */ [1, 1, 1, 1, 0.12, 0.5],
  /* bolt   */ [1, 1, 1, 1, 0.03, 0.3],
  /* rock   */ [1, 1, 1, 1, 0.8, 1],
  /* smash  */ [1, 1, 1, 1, 1, 1],
];

// tracer styles (see fx.js)
export const TR = { RIFLE: 0, MG: 1, SNIPER: 2, CANNON: 3, ARROW: 4 };

// `sup`: how much a shot or burst suppresses the company it lands on (see morale.js)
export const WEAPONS = {
  rifle:      { name: 'Rifle', sup: 0.05,            range: 210, min: 0,   reload: 1.4,  dmg: 60,  acc: 0.55, accFar: 0.18, kind: K.BULLET, tracer: TR.RIFLE,  flash: 1.0, snd: 'rifle' },
  mg:         { name: 'Machine gun', sup: 1,      range: 360, min: 0,   reload: 0.2,  dmg: 50,  acc: 0.36, accFar: 0.1,  kind: K.BULLET, tracer: TR.MG,     flash: 1.4, snd: 'mg', multi: 0.3 },
  sniper:     { name: 'Marksman rifle',   range: 360, min: 0,   reload: 2.4,  dmg: 260, acc: 0.95, accFar: 0.75, kind: K.BULLET, tracer: TR.SNIPER, flash: 1.2, snd: 'sniper', pref: 1 },
  gl:         { name: 'Grenade launcher', sup: 0.4, range: 200, min: 14,  reload: 2.8,  dmg: 130, aoe: 4.5,   speed: 75,  kind: K.HE, flash: 1.0, snd: 'thump', fxk: 3 },
  rocket:     { name: 'Guided rocket', sup: 0.3,    range: 340, min: 20,  reload: 7,    dmg: 950, aoe: 5,   speed: 150, kind: K.AP, flash: 2.2, snd: 'rocket', pref: 2, prefOnly: true, fxk: 0, trail: true },
  mortar:     { name: 'Mortar', sup: 0.6,           range: 650, min: 60,  reload: 5.0,  dmg: 170, aoe: 6.5, arc: true, flight: 2.6, scatter: 6,  kind: K.HE, flash: 1.6, snd: 'mortar', fxk: 0 },
  howitzer:   { name: 'Howitzer', sup: 1,         range: 2400, min: 150, reload: 9,   dmg: 420, aoe: 11,  arc: true, flight: 3.6, scatter: 9,  kind: K.HE, flash: 3.5, snd: 'cannon', fxk: 1 },
  autocannon: { name: 'Autocannon', sup: 0.6,       range: 400, min: 0,   reload: 0.25, dmg: 110, aoe: 2.6, speed: 420, kind: K.HEAVY, flash: 1.8, snd: 'autocannon', fxk: 3, tracer: TR.CANNON },
  tankgun:    { name: 'Tank gun', sup: 1,         range: 600, min: 25,  reload: 5,    dmg: 750, aoe: 6.5, speed: 520, kind: K.AP, flash: 4, snd: 'cannon', pref: 2, fxk: 0 },
  coax:       { name: 'Coaxial MG', sup: 1,       range: 320, min: 0,   reload: 0.25, dmg: 45,  acc: 0.36, accFar: 0.1,  kind: K.BULLET, tracer: TR.MG, flash: 1.2, snd: 'mg', multi: 0.4 },
  // player-called support
  bomb:       { name: 'Air strike', sup: 1.5,       dmg: 1000, aoe: 16, kind: K.HE, fxk: 1, ff: true },
  arty:       { name: 'Artillery barrage', sup: 1, dmg: 800, aoe: 12, kind: K.HE, fxk: 1, ff: true },
  heli_gun:   { name: 'Gunship cannon', sup: 0.6,   dmg: 130, aoe: 3,  kind: K.HEAVY, fxk: 3 },
  heli_rkt:   { name: 'Gunship rockets', sup: 1,  dmg: 420, aoe: 7,  kind: K.HE, fxk: 0 },
  bayonet:    { name: 'Close combat',     dmg: 30, kind: K.BULLET },
  // attackers
  melee:      { name: 'Blades',           kind: K.MELEE },
  smash:      { name: 'Troll',            kind: K.SMASH },
  xbow:       { name: 'Crossbows',        range: 110, reload: 3.2, dmg: 25, acc: 0.16, kind: K.BOLT, tracer: TR.ARROW },
  rock:       { name: 'Catapults',        range: 400, min: 80, reload: 8, dmg: 150, aoe: 7, arc: true, flight: 3.4, scatter: 9, kind: K.ROCK, fxk: 4, sdmg: 260 },
  blast:      { name: 'Blast charge',     dmg: 900, aoe: 22, kind: K.HE, fxk: 2, ff: true },
  // defensive works
  mine:       { name: 'Mines', sup: 0.3,            dmg: 340, aoe: 5.5, kind: K.HE, fxk: 0 },
  claymore:   { name: 'Claymores', sup: 0.5,        dmg: 280, range: 42, kind: K.HE },
};
for (const k in WEAPONS) WEAPONS[k].key = k;

// orc roles
export const R = { MELEE: 0, ARCHER: 1, LADDER: 2, RAM: 3, SAPPER: 4, CATAPULT: 5, TROLL: 6, TOWER: 7 };
// defender classes
export const C = { INF: 0, VEH: 1, GUN: 2, CACHE: 3, OBST: 4 };

export const UNITS = [
  // ---- defenders (cost: requisition points, a rifleman being 10) -------
  { key: 'rifle', cost: 10, team: DEF, name: 'Rifleman', cls: C.INF, hp: 100, speed: 3.4, rad: 0.5, size: 3.4, spr: 0, w: 'rifle', ammo: 60, spacing: 2.0, supply: 1,
    desc: 'Backbone of the line. Effective out to 210 m in the dark.' },
  { key: 'mg', cost: 30, team: DEF, name: 'Machine Gun Team', cls: C.INF, hp: 110, speed: 2.8, rad: 0.6, size: 3.9, spr: 1, w: 'mg', ammo: 320, spacing: 2.6, supply: 2,
    desc: 'Sustained fire to 360 m. Pins down the companies it rakes: they slow, waver and stop shooting.' },
  { key: 'marksman', cost: 25, team: DEF, name: 'Marksman', cls: C.INF, hp: 90, speed: 3.4, rad: 0.5, size: 3.4, spr: 2, w: 'sniper', ammo: 40, spacing: 2.4, supply: 1,
    desc: 'Picks off captains, sappers, berserkers and ladder crews at 360 m.' },
  { key: 'grenadier', cost: 25, team: DEF, name: 'Grenadier', cls: C.INF, hp: 100, speed: 3.3, rad: 0.5, size: 3.4, spr: 3, w: 'gl', ammo: 30, spacing: 2.2, supply: 2,
    desc: 'Lobs fragmentation rounds into the press below the wall.' },
  { key: 'at', cost: 35, team: DEF, name: 'Anti-Armor Team', cls: C.INF, hp: 100, speed: 3.0, rad: 0.55, size: 3.6, spr: 4, w: 'rocket', ammo: 8, spacing: 2.6, supply: 3,
    desc: 'Guided rockets. Only fires on trolls, rams and siege engines.' },
  { key: 'mortar', cost: 60, team: DEF, name: 'Mortar Team', cls: C.INF, hp: 140, speed: 2.2, rad: 1.0, size: 5.2, spr: 5, w: 'mortar', ammo: 30, spacing: 6, supply: 4,
    desc: 'Indirect fire 60–650 m. Fires over walls; holds fire near friendlies.' },
  { key: 'howitzer', cost: 220, team: DEF, name: 'Howitzer', cls: C.GUN, hp: 500, speed: 0, rad: 2.4, size: 10, spr: 6, w: 'howitzer', ammo: 24, spacing: 14, supply: 6,
    desc: 'Heavy artillery with map-wide reach. Static once emplaced.' },
  { key: 'ifv', cost: 260, team: DEF, name: 'Fighting Vehicle', cls: C.VEH, hp: 1800, speed: 9, rad: 2.4, size: 8.5, spr: 7, turret: 8, w: 'autocannon', ammo: 400, spacing: 10, supply: 5,
    desc: 'Fast armoured vehicle with a 30 mm autocannon.' },
  { key: 'tank', cost: 420, team: DEF, name: 'Main Battle Tank', cls: C.VEH, hp: 3600, speed: 8, rad: 2.8, size: 10.5, spr: 9, turret: 10, w: 'tankgun', ammo: 40, w2: 'coax', ammo2: 700, spacing: 12, supply: 6,
    desc: 'Heavy armour. Main gun kills trolls; almost immune to blades.' },
  { key: 'cache', cost: 80, team: DEF, name: 'Ammo Cache', cls: C.CACHE, hp: 300, speed: 0, rad: 1.6, size: 5.5, spr: 11, pool: 150, spacing: 8,
    desc: 'Re-arms troops within 60 m until its stock runs out.' },
  { key: 'cmd', cost: 120, team: DEF, name: 'Commander', cls: C.INF, hp: 170, speed: 3.2, rad: 0.6, size: 3.8, spr: 13, w: 'rifle', ammo: 60, spacing: 3.2, supply: 1, cmd: true, aura: 110,
    desc: 'Steadies every platoon within 110 m. If it falls, the garrison is shaken.' },
  { key: 'wire', cost: 2, team: DEF, name: 'Barbed Wire', cls: C.OBST, ob: 'wire', hp: 1, speed: 0, rad: 1.6, size: 4.4, spr: 14, spacing: 3,
    desc: 'Slows infantry to a crawl until it is trampled flat or blown apart.' },
  { key: 'hedgehog', cost: 3, team: DEF, name: 'Anti-Vehicle Obstacle', cls: C.OBST, ob: 'av', hp: 1, speed: 0, rad: 1.6, size: 4.4, spr: 15, spacing: 3,
    desc: 'Stops rams, catapults and siege towers. Gives whoever shelters behind it cover.' },
  { key: 'mine', cost: 4, team: DEF, name: 'Anti-Personnel Mine', cls: C.OBST, ob: 'mine', hp: 1, speed: 0, rad: 0.5, size: 2.4, spr: 27, spacing: 3,
    desc: 'Buried and invisible to the enemy. One blast, 5 m radius.' },
  { key: 'claymore', cost: 15, team: DEF, name: 'Claymore', cls: C.OBST, ob: 'claymore', hp: 1, speed: 0, rad: 0.5, size: 2.6, spr: 28, spacing: 7,
    desc: 'Directional charge facing the enemy. Sweeps a 40 m cone when a group closes in.' },
  { key: 'crate', team: DEF, name: 'Supply Drop', cls: C.CACHE, hp: 200, speed: 0, rad: 1.2, size: 4, spr: 12, pool: 60, spacing: 6, hidden: true,
    desc: 'Air-dropped ammunition.' },
  // ---- attackers -------------------------------------------------------
  { key: 'uruk', team: ORC, name: 'Uruk-hai', role: R.MELEE, hp: 130, speed: 4.8, rad: 0.5, size: 3.2, spr: 16, mdmg: 24, mreload: 1.0, reach: 1.3, spacing: 1.7, armor: A.FLESH,
    desc: 'Armoured heavy infantry. The body of the horde.' },
  { key: 'archer', team: ORC, name: 'Crossbow Uruk', role: R.ARCHER, hp: 90, speed: 4.5, rad: 0.5, size: 3.2, spr: 17, w: 'xbow', mdmg: 18, mreload: 1.2, reach: 1.3, spacing: 1.8, armor: A.FLESH,
    desc: 'Volleys bolts at 110 m. Weak against troops behind battlements.' },
  { key: 'berserker', team: ORC, name: 'Berserker', role: R.MELEE, hp: 320, speed: 6.4, rad: 0.55, size: 3.7, spr: 18, mdmg: 50, mreload: 0.8, reach: 1.5, spacing: 2.2, armor: A.FLESH, hvt: 1, pri: 1.4, fearless: true,
    desc: 'Fast, frenzied and very hard to drop. First up the ladders, and cannot be pinned down.' },
  { key: 'warg', team: ORC, name: 'Warg Rider', role: R.MELEE, hp: 240, speed: 10.5, rad: 0.9, size: 5.4, spr: 19, mdmg: 40, mreload: 0.9, reach: 1.8, spacing: 3.2, armor: A.FLESH,
    desc: 'Cavalry. Closes the killing ground in seconds.' },
  { key: 'chief', team: ORC, name: 'Uruk Captain', role: R.MELEE, hp: 650, speed: 4.6, rad: 0.65, size: 4.4, spr: 29, mdmg: 60, mreload: 0.9, reach: 1.6, spacing: 7, armor: A.FLESH, hvt: 1, pri: 3, cmd: true, aura: 95,
    desc: 'Drives the companies around him forward from the rear. Mark him with focus fire: kill him and they waver.' },
  { key: 'troll', team: ORC, name: 'Siege Troll', role: R.TROLL, hp: 3600, speed: 3.6, rad: 1.8, size: 8.6, spr: 20, mdmg: 260, mreload: 1.8, reach: 2.6, maoe: 3.5, sdmg: 240, spacing: 7, armor: A.HEAVY, big: true, hvt: 2,
    desc: 'Shrugs off rifle fire. Smashes gates, walls and vehicles.' },
  { key: 'ladder', team: ORC, name: 'Ladder Crew', role: R.LADDER, hp: 520, speed: 3.9, rad: 1.2, size: 13, spr: 21, spacing: 9, armor: A.FLESH, big: true, hvt: 1, pri: 1.2,
    desc: 'Raises a siege ladder so infantry can scale the Deeping Wall.' },
  { key: 'ram', team: ORC, name: 'Battering Ram', role: R.RAM, hp: 1600, speed: 2.7, rad: 2.2, size: 12, spr: 23, sdmg: 230, spacing: 10, armor: A.WOOD, big: true, heavy: true, hvt: 2,
    desc: 'Heads up the causeway to break the Hornburg gate.' },
  { key: 'sapper', team: ORC, name: 'Blast Sapper', role: R.SAPPER, hp: 320, speed: 6.0, pri: 0.8, rad: 0.6, size: 3.9, spr: 24, spacing: 4, armor: A.FLESH, hvt: 1,
    desc: 'Carries a blasting charge to the culvert to breach the wall.' },
  { key: 'catapult', team: ORC, name: 'Catapult', role: R.CATAPULT, hp: 1200, speed: 1.9, rad: 2.4, size: 11, spr: 25, w: 'rock', spacing: 12, armor: A.WOOD, big: true, heavy: true, hvt: 2,
    desc: 'Hurls rocks at defenders 80–400 m away.' },
  { key: 'tower', team: ORC, name: 'Siege Tower', role: R.TOWER, hp: 10000, speed: 2.5, rad: 3.6, size: 12, spr: 30, spacing: 18, armor: A.WOOD, big: true, heavy: true, hvt: 2, pri: 0.6, carry: 50,
    desc: 'Rolls up to the wall and puts 50 Uruk-hai straight onto the battlements.' },
];

export const U = {};
UNITS.forEach((u, i) => {
  u.id = i;
  U[u.key] = i;
  u.wdef = u.w ? WEAPONS[u.w] : null;
  u.w2def = u.w2 ? WEAPONS[u.w2] : null;
  if (u.team === DEF) u.armor = u.cls === C.INF ? A.INF : u.cls === C.VEH ? A.VEH : A.GUN;
  u.sz = u.heavy ? 2 : u.big ? 1 : 0; // 0 foot, 1 big (no stairs or ladders), 2 heavy (also stopped by obstacles)
});

// Player-called support. In a challenge battle every call is paid for from one shared pool of
// Command Points (`cost`, with the short `cpCd` between calls of the same kind); in the sandbox
// each kind has its own number of uses (`def`) and the longer `cd`.
export const SUPPORT = {
  air:       { name: 'Air Strike',     key: '1', cd: 40, cpCd: 20, cost: 5, def: 4, drag: true,  desc: 'Two jets drop a stick of bombs along a line. Click a point, or drag to set the attack heading. Danger close: hits friendlies too.' },
  gunship:   { name: 'Gunships',       key: '2', cd: 80, cpCd: 45, cost: 6, def: 2, desc: 'A pair of attack helicopters orbits the target for 40 s.' },
  arty:      { name: 'Artillery',      key: '3', cd: 30, cpCd: 12, cost: 3, def: 5, desc: 'Off-map battery saturates a 45 m circle. Danger close: hits friendlies too.' },
  supply:    { name: 'Resupply Drop',  key: '4', cd: 35, cpCd: 15, cost: 4, def: 4, desc: 'Parachutes two ammo crates onto the marker. Troops within 60 m re-arm.' },
  reinforce: { name: 'Air Assault',    key: '5', cd: 90, cpCd: 60, cost: 8, def: 2, desc: 'A transport helicopter inserts a fresh platoon at the marker.' },
};
// Command Points paid out for destroying what the horde can least afford to lose. The bounty is a
// fixed pool shared over everything on this list in the attacker's order of battle.
export const BOUNTY = { chief: 4, tower: 4, ram: 3, catapult: 2, troll: 1 };
export const BOUNTY_SHARE = 0.35; // size of the pool, as a fraction of the trickle income up to dawn

export const DEFAULT_OPTIONS = {
  ammoMult: 1,
  sandbox: false, // free build: both armies, no budget, no waves, support by uses, win conditions of the player's choosing
  cpStart: 6,     // Command Points in hand when the battle opens (challenge)
  cpRate: 0.025,  // Command Points gained per second
  cpCap: 20,      // most that can be banked
  support: { air: 4, gunship: 2, arty: 5, supply: 4, reinforce: 2 },
  dawn: 1200, // seconds until relief arrives (0 = never)
  rout: 0.08, // horde breaks when this fraction remains (0 = fights to the last)
  morale: true, // companies waver, break and rally
  seed: 1,
};
