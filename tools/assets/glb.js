// Reading a binary glTF (.glb): geometry, skeleton and animation, with no dependencies.
// Only what the unit pipeline needs: one skinned mesh, its joints, and clips of joint motion.
import fs from 'node:fs';

const COMP = { 5120: Int8Array, 5121: Uint8Array, 5122: Int16Array, 5123: Uint16Array, 5125: Uint32Array, 5126: Float32Array };
const NCOMP = { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4, MAT4: 16 };

export function readGlb(file) {
  const buf = fs.readFileSync(file);
  if (buf.readUInt32LE(0) !== 0x46546c67) throw new Error(`${file}: not a .glb`);
  const jl = buf.readUInt32LE(12), gltf = JSON.parse(buf.subarray(20, 20 + jl).toString('utf8'));
  const bin = buf.subarray(20 + jl + 8, 20 + jl + 8 + buf.readUInt32LE(20 + jl));
  /** An accessor as a flat array of numbers (normalized integers become 0..1 or -1..1 when `norm`). */
  const accessor = (i, norm = true) => {
    const a = gltf.accessors[i], bv = gltf.bufferViews[a.bufferView], T = COMP[a.componentType], n = NCOMP[a.type];
    const stride = bv.byteStride || T.BYTES_PER_ELEMENT * n, base = bin.byteOffset + (bv.byteOffset || 0) + (a.byteOffset || 0);
    const out = a.componentType === 5126 || !(norm && a.normalized) ? new (a.componentType === 5126 ? Float32Array : T)(a.count * n) : new Float32Array(a.count * n);
    const dv = new DataView(bin.buffer, base, (a.count - 1) * stride + T.BYTES_PER_ELEMENT * n);
    const get = { 5120: 'getInt8', 5121: 'getUint8', 5122: 'getInt16', 5123: 'getUint16', 5125: 'getUint32', 5126: 'getFloat32' }[a.componentType];
    const div = norm && a.normalized ? { 5120: 127, 5121: 255, 5122: 32767, 5123: 65535 }[a.componentType] : 0;
    for (let k = 0; k < a.count; k++) for (let c = 0; c < n; c++) { const v = dv[get](k * stride + c * T.BYTES_PER_ELEMENT, true); out[k * n + c] = div ? Math.max(-1, v / div) : v; }
    return out;
  };
  const image = (i) => { const im = gltf.images[i], bv = gltf.bufferViews[im.bufferView]; return { mime: im.mimeType, bytes: bin.subarray(bv.byteOffset || 0, (bv.byteOffset || 0) + bv.byteLength) }; };
  return { gltf, accessor, image };
}

// ---- small matrix kit (column-major 4x4, as glTF stores them) ----
export const ident = () => [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
export function mul(a, b) {
  const o = new Array(16);
  for (let c = 0; c < 4; c++) for (let r = 0; r < 4; r++) o[c * 4 + r] = a[r] * b[c * 4] + a[4 + r] * b[c * 4 + 1] + a[8 + r] * b[c * 4 + 2] + a[12 + r] * b[c * 4 + 3];
  return o;
}
export function trs(t, q, s) {
  const [x, y, z, w] = q, xx = x * x, yy = y * y, zz = z * z, xy = x * y, xz = x * z, yz = y * z, wx = w * x, wy = w * y, wz = w * z;
  return [(1 - 2 * (yy + zz)) * s[0], 2 * (xy + wz) * s[0], 2 * (xz - wy) * s[0], 0, 2 * (xy - wz) * s[1], (1 - 2 * (xx + zz)) * s[1], 2 * (yz + wx) * s[1], 0,
    2 * (xz + wy) * s[2], 2 * (yz - wx) * s[2], (1 - 2 * (xx + yy)) * s[2], 0, t[0], t[1], t[2], 1];
}
const slerp = (a, b, u) => {
  let d = a[0] * b[0] + a[1] * b[1] + a[2] * b[2] + a[3] * b[3], s = 1;
  if (d < 0) { d = -d; s = -1; }
  let ka = 1 - u, kb = u;
  if (d < 0.9995) { const th = Math.acos(d), sn = Math.sin(th); ka = Math.sin((1 - u) * th) / sn; kb = Math.sin(u * th) / sn; }
  const o = [a[0] * ka + b[0] * kb * s, a[1] * ka + b[1] * kb * s, a[2] * ka + b[2] * kb * s, a[3] * ka + b[3] * kb * s], l = Math.hypot(...o);
  return o.map((v) => v / l);
};

/**
 * The first skinned mesh of a file: { pos, nrm, uv, joints, weights, index, skin: { joints: [node...], ibm }, nodes, parents,
 * baseColorImage } with flat arrays, all primitives of the mesh merged.
 */
export function skinnedMesh(g) {
  const { gltf, accessor } = g;
  const node = gltf.nodes.findIndex((n) => n.mesh != null && n.skin != null);
  if (node < 0) throw new Error('no skinned mesh in this file');
  const mesh = gltf.meshes[gltf.nodes[node].mesh], skin = gltf.skins[gltf.nodes[node].skin];
  const P = [], N = [], U = [], J = [], W = [], I = [];
  let base = 0, mat = null;
  for (const p of mesh.primitives) {
    const pos = accessor(p.attributes.POSITION), n = pos.length / 3;
    P.push(...pos); N.push(...accessor(p.attributes.NORMAL)); U.push(...accessor(p.attributes.TEXCOORD_0));
    J.push(...accessor(p.attributes.JOINTS_0, false)); W.push(...accessor(p.attributes.WEIGHTS_0));
    const idx = p.indices != null ? accessor(p.indices, false) : Uint32Array.from({ length: n }, (_, k) => k);
    for (const v of idx) I.push(v + base);
    base += n; if (mat == null) mat = p.material;
  }
  const parents = new Array(gltf.nodes.length).fill(-1);
  gltf.nodes.forEach((n, i) => (n.children || []).forEach((c) => { parents[c] = i; }));
  const m = gltf.materials && gltf.materials[mat], tex = m && m.pbrMetallicRoughness && m.pbrMetallicRoughness.baseColorTexture;
  return {
    pos: Float32Array.from(P), nrm: Float32Array.from(N), uv: Float32Array.from(U), joints: Uint16Array.from(J), weights: Float32Array.from(W), index: Uint32Array.from(I),
    skin: { joints: skin.joints, ibm: accessor(skin.inverseBindMatrices), names: skin.joints.map((j) => gltf.nodes[j].name || `joint${j}`) }, parents,
    baseColorImage: tex ? gltf.textures[tex.index].source : null,
  };
}

/**
 * Sample one animation of a file at `fps`: returns { frames, fps, duration, world: (frame) => world matrix per node }.
 * Nodes the clip does not move keep their rest pose.
 */
export function sampleClip(g, clipIndex, fps) {
  const { gltf, accessor } = g, anim = gltf.animations[clipIndex];
  const tracks = anim.channels.map((ch) => { const s = anim.samplers[ch.sampler]; return { node: ch.target.node, path: ch.target.path, t: accessor(s.input), v: accessor(s.output), step: s.interpolation === 'STEP', cubic: s.interpolation === 'CUBICSPLINE' }; });
  let t0 = Infinity, t1 = -Infinity;
  for (const tr of tracks) { t0 = Math.min(t0, tr.t[0]); t1 = Math.max(t1, tr.t[tr.t.length - 1]); }
  const duration = t1 - t0, frames = Math.max(1, Math.round(duration * fps));
  const parents = new Array(gltf.nodes.length).fill(-1);
  gltf.nodes.forEach((n, i) => (n.children || []).forEach((c) => { parents[c] = i; }));
  const order = []; // parents before children
  const visit = (i) => { order.push(i); (gltf.nodes[i].children || []).forEach(visit); };
  gltf.nodes.forEach((n, i) => { if (parents[i] < 0) visit(i); });
  const byNode = new Map();
  for (const tr of tracks) { if (!byNode.has(tr.node)) byNode.set(tr.node, {}); byNode.get(tr.node)[tr.path] = tr; }
  const at = (tr, time, n) => {
    const T = tr.t, last = T.length - 1, w = tr.cubic ? 3 : 1, off = tr.cubic ? n : 0; // (cubic: take the knot values, ignore tangents)
    if (time <= T[0]) return Array.from(tr.v.subarray(off, off + n));
    if (time >= T[last]) return Array.from(tr.v.subarray(last * n * w + off, last * n * w + off + n));
    let k = 0; while (k < last && T[k + 1] < time) k++;
    const a = Array.from(tr.v.subarray(k * n * w + off, k * n * w + off + n)), b = Array.from(tr.v.subarray((k + 1) * n * w + off, (k + 1) * n * w + off + n));
    if (tr.step) return a;
    const u = (time - T[k]) / (T[k + 1] - T[k]);
    return n === 4 ? slerp(a, b, u) : a.map((v, c) => v + (b[c] - v) * u);
  };
  const world = (frame) => {
    const time = t0 + (frames > 1 ? (frame / frames) * duration : 0), out = new Array(gltf.nodes.length);
    for (const i of order) {
      const n = gltf.nodes[i], tr = byNode.get(i) || {};
      const local = n.matrix && !tr.translation && !tr.rotation && !tr.scale ? n.matrix
        : trs(tr.translation ? at(tr.translation, time, 3) : n.translation || [0, 0, 0], tr.rotation ? at(tr.rotation, time, 4) : n.rotation || [0, 0, 0, 1], tr.scale ? at(tr.scale, time, 3) : n.scale || [1, 1, 1]);
      out[i] = parents[i] < 0 ? local : mul(out[parents[i]], local);
    }
    return out;
  };
  return { name: anim.name || `clip${clipIndex}`, frames, fps, duration, world };
}
