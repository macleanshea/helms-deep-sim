// The battlefield's design, in one place.
//
// Everything that says where something is on this particular map lives here: the shape of the
// valley, the Hornburg and the Deeping Wall, the ramps and stairs, and the lines and places the
// two armies use (where the horde enters and waits, where the garrison's guns and reserves stand).
// src/map.js raises the map from it; the simulation, the presets, the tools and the renderer read
// positions from it (or from the map built from it) rather than carrying numbers of their own.
// To reshape the battlefield, change it here, then run `npm run maplint`, `npm run checks` and
// `npm run matrix`. See docs/roadmap.md.
//
// Axes: x runs east up the valley (the horde comes on from x = 0), y runs south (the Hornburg stands
// against the southern cliff), z is up. All lengths are metres; ring bearings are degrees from +x,
// turning toward +y.

const PLATEAU = 12; // the Hornburg's rock and court stand this high (config.js PLATEAU_Z must agree)

/** The Hornburg: a ring wall round a court, with the inner ward climbing the rock in two terraces. */
const keep = {
  cx: 960, cy: 710, r: 72, half: 4.5,
  t1: { x: 968, y: 724, r: 48, z: PLATEAU + 8 },
  t2: { x: 990, y: 742, r: 27, z: PLATEAU + 17 },
  tower: { x: 997, y: 746, r: 12 },
};

export const LAYOUT = {
  keep,
  /** The ring wall's sections, and which of them hold the gate, the postern and the door from the Deeping Wall's walk. */
  ring: { sections: 36, gate: 19, postern: 34, door: 28 },

  /**
   * The valley's rock walls. The northern rim runs at y = a0 at the mouth and steps south to a1 between x0 and x1,
   * then closes in by `deep` behind the wall between dx0 and dx1; `noise` is the amplitude of its raggedness and `seed`
   * picks the pattern. The southern rim is the same, measured up from the bottom edge. `east` is the wall of rock that
   * ends the Deep.
   */
  rim: {
    north: { a0: 64, a1: 260, x0: 520, x1: 960, deep: 150, dx0: 1000, dx1: 1400, noise: 44, seed: 9.1 },
    south: { a0: 64, a1: 205, x0: 520, x1: 900, deep: 190, dx0: 1000, dx1: 1400, noise: 44, seed: 3.7 },
    east: { x: 1394, noise: 26, seed: 1.3 },
  },

  /**
   * The Deeping Wall: from the ring at its door to the northern cliff at x = endX (set `inset` into the rock), bowed
   * `bow` metres toward the attackers at mid-length. `culvert` is where along it (0..1) the stream passes under.
   */
  wall: { sections: 38, half: 5, endX: 992, inset: 12, bow: 26, culvert: 0.5, span: [930, 1010] }, // span: the x range it lies within, with room to spare

  /** The causeway from the gate down to the valley floor, and the stair from the postern down into the Deep: points after the door itself. */
  causeway: { via: [[852, 679], [806, 654], [762, 622], [724, 584], [702, 546]], half: 7 },
  rear: { via: [[1052, 664], [1066, 634], [1074, 602]], half: 4.5 },
  /** The road the causeway becomes, wandering west down the valley from its foot. */
  road: { x: 702, y: 546, swing: 46, wave: 210, ease: 160 },

  /**
   * Stairs to the wall walks. On the Deeping Wall: [where along it (0..1), which way the flight climbs along the wall].
   * In the court: [bearing on the ring, which way round it climbs].
   */
  stairs: { wall: [[0.2, 1], [0.44, -1], [0.62, 1], [0.84, -1]], court: [[248, -1], [160, 1]] },

  /** The stream: it wanders `swing` metres either side of the culvert with this wavelength, and drifts south as it goes east. */
  stream: { swing: 26, wave: 120, drift: 0.1 },

  /** Where the names are written on the ground: offsets from the culvert, from the keep's centre, or absolute. */
  labels: { wall: [46, 90], hornburg: [-30, -30], causeway: [770, 642], culvert: [-40, -12], deep: [1180, 470], coomb: [380, 480] },

  /**
   * The horde's side of the field. Lines across the valley are given as x, lanes up it as y.
   *   edge      where a wave appears          exit      a routed man who gets this far west is gone
   *   reserve   where the warg reserve waits, beyond every gun but the howitzers
   *   rally     where a force that has pulled back regroups
   *   far       west of this nobody is counted as near the works
   *   front     west of this is "in the open, in front of the wall"; `rout` is the same line for a broken company
   *   bled      the stretch of the approach where losses are counted against a sector
   *   lanes     the six lanes a wave is drawn up in, each `laneWidth` wide; `split` divides them into the three sectors
   *   centre    the valley's middle, where alerts with no better place are pinned
   *   sapper    the lane sappers come up (the culvert's); `vanguard` is how far onto the field the first wave is set
   */
  approach: {
    edge: 8, exit: 10, reserve: 330, rally: 430, far: 500, front: 945, rout: 930, bled: [600, 980],
    lanes: [140, 276, 412, 548, 684, 820], laneWidth: 116, split: [344, 616], centre: 480, alertX: 40,
    sapper: 443, vanguard: [300, 440], open: [300, 480], captainY: [20, 940],
    // tools and overlays: `abreast` is an x on the wall's line (which sector lies level with this y?), `behind` an x beyond
    // which a man is in the Deep, `mid` the middle of the approach, `mouth` where the note about waves still to come is pinned
    abreast: 990, behind: 1012, wallLine: 1000, mid: 700, mouth: [26, 480], testRifles: [1100, 480], testChiefs: [240, 480], testRank: 300,
  },

  /**
   * Places the garrison uses, as [x, y]. `court` is where reinforcements land and troops muster inside the Hornburg;
   * the rest are where the presets stand guns, vehicles and the reserve below the wall.
   */
  posts: {
    court: [keep.cx - 24, keep.cy - 34], courtMuster: [keep.cx - 30, keep.cy - 34],
    hornburgFront: [keep.cx - keep.r, keep.cy], captain: [keep.cx - keep.r + 1, keep.cy - 6],
    courtMortars: [keep.cx - 24, keep.cy - 40], courtCache: [keep.cx - 44, keep.cy - 22],
    courtRifles: [keep.cx - 46, keep.cy - 10], courtPlatoon: [keep.cx - 46, keep.cy - 12],
    deepMortars: [1090, 480], deepHowitzers: [1220, 490], deepRifles: [1030, 460], reserve: [1030, 450],
    mortarsEasy: [1070, 460], mortarsHard: [1080, 490], tankDeep: [1080, 540], ifvDeep: [1100, 400],
    tanksForward: [850, 400], ifvsForward: [870, 270], howitzersBench: [1270, 490], mortarsBench: [1130, 440], cacheBench: [1060, 440],
  },

  /** What the renderer needs to know about the map's extent: the fortress's shadow box as [x0, y0, x1, y1]. */
  shadowBox: [620, 160, 1190, 840],
};
