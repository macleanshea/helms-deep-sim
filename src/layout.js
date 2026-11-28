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
// against the southern cliff), z is up. All lengths are meters; ring bearings are degrees from +x,
// turning toward +y.

const PLATEAU = 12; // the Hornburg's rock and court stand this high (config.js PLATEAU_Z must agree)

/**
 * The Hornburg: a ring wall round a court, and inside it two more courts stepping up to the cliff. `t1` is the inner
 * court, the top of a great drum that stands higher than the ring wall's walk; `t2` is the upper court against the
 * rock, where the hall is cut into the cliff. All three levels can be stood on and are joined by stairs (`stairs.tiers`).
 */
const keep = {
  cx: 960, cy: 710, r: 72, half: 4.5,
  t1: { x: 968, y: 724, r: 48, z: PLATEAU + 11 },
  t2: { x: 984, y: 745, r: 27, z: PLATEAU + 19 },
  // the horn tower stands on the inner court toward the Deep, slender and far taller than anything else (it is solid:
  // nothing stands on it, and `foot` is how far round it the ground is taken up by its base)
  tower: { x: 1009, y: 724, r: 7.5, top: 90, foot: 3.5 },
};

export const LAYOUT = {
  keep,
  /** The ring wall's sections, and which of them hold the gate, the postern and the door from the Deeping Wall's walk. */
  /**
   * `bastions`: open platforms that swell out of the ring wall at these bearings, level with its walk (part of the
   * walk: men stand on them, nothing passes through them), `out` beyond the wall's center line and `r` across.
   * `gatehouse`: the two platforms that flank the gate, standing `deep` out from the wall's face and `wide` along it.
   */
  ring: { sections: 36, gate: 19, postern: 34, door: 28, bastions: [152, 238, 318, 12], bastion: { out: 2.5, r: 7.5 }, gatehouse: { deep: 7.5, wide: 7 } },

  /**
   * The valley's rock walls. The northern rim runs at y = a0 at the mouth and steps south to a1 between x0 and x1,
   * then closes in by `deep` behind the wall between dx0 and dx1; `noise` is the amplitude of its raggedness and `seed`
   * picks the pattern. The southern rim is the same, measured up from the bottom edge. `east` is the wall of rock that
   * ends the Deep.
   */
  rim: {
    // behind the wall the two rims close to a ravine little more than a hundred meters across: the Deep is a gorge, not a field
    north: { a0: 64, a1: 260, x0: 520, x1: 960, deep: 175, dx0: 1000, dx1: 1230, noise: 44, seed: 9.1 },
    south: { a0: 64, a1: 205, x0: 520, x1: 900, deep: 210, dx0: 1000, dx1: 1230, noise: 44, seed: 3.7 },
    east: { x: 1330, noise: 26, seed: 1.3 },
  },

  /**
   * The Deeping Wall: from the ring at its door to the northern cliff at x = endX (set `inset` into the rock), bowed
   * `bow` meters toward the attackers at mid-length. `culvert` is where along it (0..1) the stream passes under.
   */
  wall: { sections: 38, half: 5, endX: 992, inset: 12, bow: 26, culvert: 0.5, span: [930, 1010] }, // span: the x range it lies within, with room to spare

  /** The causeway from the gate down to the valley floor, and the stair from the postern down into the Deep: points after the door itself. */
  // the causeway: a crescent sweeping out from the gate and round to the north, down to the valley floor in about 180 m
  // (each leaves its opening square to the wall for `lead` meters before it turns: the points given come after that)
  causeway: { via: [[840, 668], [808, 648], [784, 614], [772, 568]], half: 7, lead: 14 },
  rear: { via: [[1062, 664], [1072, 634], [1074, 602]], half: 4.5, lead: 10 },
  /** The road the causeway becomes, wandering west down the valley from its foot. */
  road: { x: 772, y: 568, swing: 46, wave: 210, ease: 160 },

  /**
   * Stairs to the wall walks. On the Deeping Wall: [where along it (0..1), which way the flight climbs along the wall].
   * In the court: [bearing on the ring, which way round it climbs].
   */
  // (the third court stair, on the side of the Deep, reaches the stretch of wall over the postern)
  // `tiers`: flights that hug the drum of a court and climb to it from the level below: [which court (1 or 2), the
  // bearing of the foot from that court's center, the bearing of the head, the level it starts from (0 the court, 1 `t1`)]
  stairs: { wall: [[0.2, 1], [0.44, -1], [0.62, 1], [0.84, -1]], court: [[248, -1], [160, 1], [322, 1]], tiers: [[1, 252, 224, 0], [1, 296, 324, 0], [2, 262, 224, 1]] },

  /** The stream: it wanders `swing` meters either side of the culvert with this wavelength, and drifts south as it goes east. */
  stream: { swing: 26, wave: 120, drift: 0.1 },

  /** Where the names are written on the ground: offsets from the culvert, from the keep's center, or absolute. */
  labels: { wall: [46, 90], hornburg: [-30, -30], causeway: [800, 668], culvert: [-40, -12], deep: [1130, 480], coomb: [380, 480] },

  /**
   * The horde's side of the field. Lines across the valley are given as x, lanes up it as y.
   *   edge      where a wave appears          exit      a routed man who gets this far west is gone
   *   reserve   where the warg reserve waits, beyond every gun but the howitzers
   *   rally     where a force that has pulled back regroups
   *   far       west of this nobody is counted as near the works
   *   front     west of this is "in the open, in front of the wall"; `rout` is the same line for a broken company
   *   bled      the stretch of the approach where losses are counted against a sector
   *   lanes     the six lanes a wave is drawn up in, each `laneWidth` wide; `split` divides them into the three sectors
   *   center    the valley's middle, where alerts with no better place are pinned
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
