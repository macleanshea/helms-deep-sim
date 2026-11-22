// Shared constants and data tables for the simulator.

export const WORLD_W = 1920;
export const WORLD_H = 1200;
export const CELL = 4; // nav grid cell size (m)
export const GW = WORLD_W / CELL;
export const GH = WORLD_H / CELL;
export const DT = 0.1; // fixed simulation step (s)

export const DEF = 0;
export const ORC = 1;

// nav cell types
export const T = { GROUND: 0, CLIFF: 1, WALL: 2, WATER: 3, COURT: 4, ROAD: 5 };

// armour classes
export const A = { FLESH: 0, HEAVY: 1, WOOD: 2, INF: 3, VEH: 4, GUN: 5 };
// damage kinds
export const K = { BULLET: 0, HEAVY: 1, HE: 2, AP: 3, MELEE: 4, BOLT: 5, ROCK: 6, SMASH: 7 };

// damage multiplier [kind][armour]
export const ARMOR_MULT = [
  /* bullet */ [1, 0.22, 0.12, 1, 0.3, 0.6],
  /* heavy  */ [1, 0.7, 0.6, 1, 1, 1],
  /* he     */ [1, 0.75, 1, 1, 0.5, 1],
  /* ap     */ [1, 1.3, 1.2, 1, 1, 1],
  /* melee  */ [1, 1, 1, 1, 0.12, 0.5],
  /* bolt   */ [1, 1, 1, 1, 0.03, 0.3],
  /* rock   */ [1, 1, 1, 1, 0.8, 1],
  /* smash  */ [1, 1, 1, 1, 1, 1],
];

// tracer styles (see fx.js)
export const TR = { RIFLE: 0, MG: 1, SNIPER: 2, CANNON: 3, ARROW: 4 };

export const WEAPONS = {
  rifle:      { name: 'Rifle',            range: 210, min: 0,   reload: 1.4,  dmg: 60,  acc: 0.55, accFar: 0.18, kind: K.BULLET, tracer: TR.RIFLE,  flash: 1.0, snd: 'rifle' },
  mg:         { name: 'Machine gun',      range: 360, min: 0,   reload: 0.2,  dmg: 50,  acc: 0.36, accFar: 0.1,  kind: K.BULLET, tracer: TR.MG,     flash: 1.4, snd: 'mg', multi: 0.3 },
  sniper:     { name: 'Marksman rifle',   range: 480, min: 0,   reload: 2.4,  dmg: 260, acc: 0.95, accFar: 0.75, kind: K.BULLET, tracer: TR.SNIPER, flash: 1.2, snd: 'sniper', pref: 1 },
  gl:         { name: 'Grenade launcher', range: 200, min: 14,  reload: 2.8,  dmg: 130, aoe: 4.5,   speed: 75,  kind: K.HE, flash: 1.0, snd: 'thump', fxk: 3 },
  rocket:     { name: 'Guided rocket',    range: 400, min: 20,  reload: 7,    dmg: 950, aoe: 5,   speed: 150, kind: K.AP, flash: 2.2, snd: 'rocket', pref: 2, prefOnly: true, fxk: 0, trail: true },
  mortar:     { name: 'Mortar',           range: 650, min: 60,  reload: 5.0,  dmg: 170, aoe: 6.5, arc: true, flight: 2.6, scatter: 6,  kind: K.HE, flash: 1.6, snd: 'mortar', fxk: 0 },
  howitzer:   { name: 'Howitzer',         range: 2400, min: 150, reload: 9,   dmg: 420, aoe: 11,  arc: true, flight: 3.6, scatter: 9,  kind: K.HE, flash: 3.5, snd: 'cannon', fxk: 1 },
  autocannon: { name: 'Autocannon',       range: 400, min: 0,   reload: 0.25, dmg: 110, aoe: 2.6, speed: 420, kind: K.HEAVY, flash: 1.8, snd: 'autocannon', fxk: 3, tracer: TR.CANNON },
  tankgun:    { name: 'Tank gun',         range: 600, min: 25,  reload: 5,    dmg: 750, aoe: 6.5, speed: 520, kind: K.AP, flash: 4, snd: 'cannon', pref: 2, fxk: 0 },
  coax:       { name: 'Coaxial MG',       range: 320, min: 0,   reload: 0.25, dmg: 45,  acc: 0.36, accFar: 0.1,  kind: K.BULLET, tracer: TR.MG, flash: 1.2, snd: 'mg', multi: 0.4 },
  // player-called support
  bomb:       { name: 'Air strike',       dmg: 1000, aoe: 16, kind: K.HE, fxk: 1, ff: true },
  arty:       { name: 'Artillery barrage', dmg: 800, aoe: 12, kind: K.HE, fxk: 1, ff: true },
  heli_gun:   { name: 'Gunship cannon',   dmg: 130, aoe: 3,  kind: K.HEAVY, fxk: 3 },
  heli_rkt:   { name: 'Gunship rockets',  dmg: 420, aoe: 7,  kind: K.HE, fxk: 0 },
  bayonet:    { name: 'Close combat',     dmg: 30, kind: K.BULLET },
  // attackers
  melee:      { name: 'Blades',           kind: K.MELEE },
  smash:      { name: 'Troll',            kind: K.SMASH },
  xbow:       { name: 'Crossbows',        range: 110, reload: 3.2, dmg: 25, acc: 0.16, kind: K.BOLT, tracer: TR.ARROW },
  rock:       { name: 'Catapults',        range: 400, min: 80, reload: 8, dmg: 150, aoe: 7, arc: true, flight: 3.4, scatter: 9, kind: K.ROCK, fxk: 4, sdmg: 260 },
  blast:      { name: 'Blast charge',     dmg: 900, aoe: 22, kind: K.HE, fxk: 2, ff: true },
};
for (const k in WEAPONS) WEAPONS[k].key = k;

// orc roles
export const R = { MELEE: 0, ARCHER: 1, LADDER: 2, RAM: 3, SAPPER: 4, CATAPULT: 5, TROLL: 6 };
// defender classes
export const C = { INF: 0, VEH: 1, GUN: 2, CACHE: 3 };

export const UNITS = [
  // ---- defenders -------------------------------------------------------
  { key: 'rifle', team: DEF, name: 'Rifleman', cls: C.INF, hp: 100, speed: 3.4, rad: 0.5, size: 3.4, spr: 0, w: 'rifle', ammo: 60, spacing: 2.0, supply: 1,
    desc: 'Backbone of the line. Effective out to 210 m in the dark.' },
  { key: 'mg', team: DEF, name: 'Machine Gun Team', cls: C.INF, hp: 110, speed: 2.8, rad: 0.6, size: 3.9, spr: 1, w: 'mg', ammo: 320, spacing: 2.6, supply: 2,
    desc: 'Sustained fire to 360 m. Shreds packed formations.' },
  { key: 'marksman', team: DEF, name: 'Marksman', cls: C.INF, hp: 90, speed: 3.4, rad: 0.5, size: 3.4, spr: 2, w: 'sniper', ammo: 40, spacing: 2.4, supply: 1,
    desc: 'Picks off sappers, berserkers and ladder crews at 480 m.' },
  { key: 'grenadier', team: DEF, name: 'Grenadier', cls: C.INF, hp: 100, speed: 3.3, rad: 0.5, size: 3.4, spr: 3, w: 'gl', ammo: 30, spacing: 2.2, supply: 2,
    desc: 'Lobs fragmentation rounds into the press below the wall.' },
  { key: 'at', team: DEF, name: 'Anti-Armor Team', cls: C.INF, hp: 100, speed: 3.0, rad: 0.55, size: 3.6, spr: 4, w: 'rocket', ammo: 8, spacing: 2.6, supply: 3,
    desc: 'Guided rockets. Only fires on trolls, rams and siege engines.' },
  { key: 'mortar', team: DEF, name: 'Mortar Team', cls: C.INF, hp: 140, speed: 2.2, rad: 1.0, size: 5.2, spr: 5, w: 'mortar', ammo: 30, spacing: 6, supply: 4,
    desc: 'Indirect fire 60–650 m. Fires over walls; holds fire near friendlies.' },
  { key: 'howitzer', team: DEF, name: 'Howitzer', cls: C.GUN, hp: 500, speed: 0, rad: 2.4, size: 10, spr: 6, w: 'howitzer', ammo: 24, spacing: 14, supply: 6,
    desc: 'Heavy artillery with map-wide reach. Static once emplaced.' },
  { key: 'ifv', team: DEF, name: 'Infantry Fighting Vehicle', cls: C.VEH, hp: 1800, speed: 9, rad: 2.4, size: 8.5, spr: 7, turret: 8, w: 'autocannon', ammo: 400, spacing: 10, supply: 5,
    desc: 'Fast armoured vehicle with a 30 mm autocannon.' },
  { key: 'tank', team: DEF, name: 'Main Battle Tank', cls: C.VEH, hp: 3600, speed: 8, rad: 2.8, size: 10.5, spr: 9, turret: 10, w: 'tankgun', ammo: 40, w2: 'coax', ammo2: 700, spacing: 12, supply: 6,
    desc: 'Heavy armour. Main gun kills trolls; almost immune to blades.' },
  { key: 'cache', team: DEF, name: 'Ammo Cache', cls: C.CACHE, hp: 300, speed: 0, rad: 1.6, size: 5.5, spr: 11, pool: 400, spacing: 8,
    desc: 'Re-arms nearby troops (45 m) until its stock runs out.' },
  { key: 'crate', team: DEF, name: 'Supply Drop', cls: C.CACHE, hp: 200, speed: 0, rad: 1.2, size: 4, spr: 12, pool: 150, spacing: 6, hidden: true,
    desc: 'Air-dropped ammunition.' },
  // ---- attackers -------------------------------------------------------
  { key: 'uruk', team: ORC, name: 'Uruk-hai', role: R.MELEE, hp: 130, speed: 4.8, rad: 0.5, size: 3.2, spr: 16, mdmg: 24, mreload: 1.0, reach: 1.3, spacing: 1.7, armor: A.FLESH,
    desc: 'Armoured heavy infantry. The body of the horde.' },
  { key: 'archer', team: ORC, name: 'Crossbow Uruk', role: R.ARCHER, hp: 90, speed: 4.5, rad: 0.5, size: 3.2, spr: 17, w: 'xbow', mdmg: 18, mreload: 1.2, reach: 1.3, spacing: 1.8, armor: A.FLESH,
    desc: 'Volleys bolts at 110 m. Weak against troops behind battlements.' },
  { key: 'berserker', team: ORC, name: 'Berserker', role: R.MELEE, hp: 320, speed: 6.4, rad: 0.55, size: 3.7, spr: 18, mdmg: 50, mreload: 0.8, reach: 1.5, spacing: 2.2, armor: A.FLESH, hvt: 1,
    desc: 'Fast, frenzied and very hard to drop. First up the ladders.' },
  { key: 'warg', team: ORC, name: 'Warg Rider', role: R.MELEE, hp: 240, speed: 10.5, rad: 0.9, size: 5.4, spr: 19, mdmg: 40, mreload: 0.9, reach: 1.8, spacing: 3.2, armor: A.FLESH,
    desc: 'Cavalry. Closes the killing ground in seconds.' },
  { key: 'troll', team: ORC, name: 'Siege Troll', role: R.TROLL, hp: 3600, speed: 3.6, rad: 1.8, size: 8.6, spr: 20, mdmg: 260, mreload: 1.8, reach: 2.6, maoe: 3.5, sdmg: 240, spacing: 7, armor: A.HEAVY, big: true, hvt: 2,
    desc: 'Shrugs off rifle fire. Smashes gates, walls and vehicles.' },
  { key: 'ladder', team: ORC, name: 'Ladder Crew', role: R.LADDER, hp: 420, speed: 3.6, rad: 1.2, size: 13, spr: 21, spacing: 9, armor: A.WOOD, big: true, hvt: 3,
    desc: 'Raises a siege ladder so infantry can scale the Deeping Wall.' },
  { key: 'ram', team: ORC, name: 'Battering Ram', role: R.RAM, hp: 1600, speed: 2.7, rad: 2.2, size: 12, spr: 23, sdmg: 230, spacing: 10, armor: A.WOOD, big: true, hvt: 2,
    desc: 'Heads up the causeway to break the Hornburg gate.' },
  { key: 'sapper', team: ORC, name: 'Blast Sapper', role: R.SAPPER, hp: 180, speed: 5.6, rad: 0.6, size: 3.9, spr: 24, spacing: 4, armor: A.FLESH, hvt: 1,
    desc: 'Carries a blasting charge to the culvert to breach the wall.' },
  { key: 'catapult', team: ORC, name: 'Catapult', role: R.CATAPULT, hp: 1200, speed: 1.9, rad: 2.4, size: 11, spr: 25, w: 'rock', spacing: 12, armor: A.WOOD, big: true, hvt: 2,
    desc: 'Hurls rocks at defenders 80–400 m away.' },
];

export const U = {};
UNITS.forEach((u, i) => {
  u.id = i;
  U[u.key] = i;
  u.wdef = u.w ? WEAPONS[u.w] : null;
  u.w2def = u.w2 ? WEAPONS[u.w2] : null;
  if (u.team === DEF) u.armor = u.cls === C.INF ? A.INF : u.cls === C.VEH ? A.VEH : A.GUN;
});

export const SUPPORT = {
  air:       { name: 'Air Strike',     key: '1', cd: 40, def: 4, drag: true,  desc: 'Two jets drop a stick of bombs along a line. Click a point, or drag to set the attack heading. Danger close: hits friendlies too.' },
  gunship:   { name: 'Gunships',       key: '2', cd: 80, def: 2, desc: 'A pair of attack helicopters orbits the target for 40 s.' },
  arty:      { name: 'Artillery',      key: '3', cd: 30, def: 5, desc: 'Off-map battery saturates a 45 m circle. Danger close: hits friendlies too.' },
  supply:    { name: 'Resupply Drop',  key: '4', cd: 35, def: 4, desc: 'Parachutes two ammo crates onto the marker. Troops within 45 m re-arm.' },
  reinforce: { name: 'Air Assault',    key: '5', cd: 90, def: 2, desc: 'A transport helicopter inserts a fresh platoon at the marker.' },
};

export const DEFAULT_OPTIONS = {
  ammoMult: 1,
  support: { air: 4, gunship: 2, arty: 5, supply: 4, reinforce: 2 },
  dawn: 1200, // seconds until relief arrives (0 = never)
  rout: 0.08, // horde breaks when this fraction remains (0 = fights to the last)
  seed: 1,
};
