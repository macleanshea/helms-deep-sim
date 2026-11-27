// What is in a .glb: meshes, triangles, materials, textures, skins and animations.
//
//   node tools/assets/glbinfo.js model.glb [more.glb ...]     add --json for one JSON line each
//
// Reads only the file's JSON chunk, so it is quick on a hundred-megabyte model.
import fs from 'node:fs';

export function glbInfo(file) {
  const fd = fs.openSync(file, 'r'), head = Buffer.alloc(20);
  fs.readSync(fd, head, 0, 20, 0);
  if (head.readUInt32LE(0) !== 0x46546c67) throw new Error(`${file}: not a .glb`);
  const len = head.readUInt32LE(12), json = Buffer.alloc(len);
  fs.readSync(fd, json, 0, len, 20); fs.closeSync(fd);
  const g = JSON.parse(json.toString('utf8')), acc = g.accessors || [];
  let tris = 0, verts = 0, prims = 0;
  for (const m of g.meshes || []) for (const p of m.primitives) {
    prims++;
    const n = p.indices != null ? acc[p.indices].count : acc[p.attributes.POSITION].count;
    tris += (p.mode == null || p.mode === 4) ? n / 3 : 0;
    verts += acc[p.attributes.POSITION].count;
  }
  let lo = [1e9, 1e9, 1e9], hi = [-1e9, -1e9, -1e9];
  for (const m of g.meshes || []) for (const p of m.primitives) { const a = acc[p.attributes.POSITION]; if (a.min) for (let k = 0; k < 3; k++) { lo[k] = Math.min(lo[k], a.min[k]); hi[k] = Math.max(hi[k], a.max[k]); } }
  return {
    file, bytes: fs.statSync(file).size, meshes: (g.meshes || []).length, primitives: prims, triangles: Math.round(tris), vertices: verts,
    size: hi.map((v, k) => +(v - lo[k]).toFixed(3)), materials: (g.materials || []).length, textures: (g.textures || []).length,
    images: (g.images || []).map((im) => im.mimeType || im.uri || '?'),
    skins: (g.skins || []).map((s) => s.joints.length), animations: (g.animations || []).map((a) => a.name || '(unnamed)'),
    attributes: [...new Set((g.meshes || []).flatMap((m) => m.primitives.flatMap((p) => Object.keys(p.attributes))))],
    generator: g.asset && g.asset.generator,
  };
}

if (process.argv[1] && process.argv[1].endsWith('glbinfo.js')) {
  const json = process.argv.includes('--json');
  for (const f of process.argv.slice(2).filter((a) => !a.startsWith('--'))) {
    const i = glbInfo(f);
    if (json) console.log(JSON.stringify(i));
    else console.log(`${f}\n  ${(i.bytes / 1e6).toFixed(1)} MB · ${i.triangles.toLocaleString()} triangles, ${i.vertices.toLocaleString()} vertices in ${i.primitives} part${i.primitives > 1 ? 's' : ''} · box ${i.size.join(' x ')}\n  ${i.materials} material${i.materials === 1 ? '' : 's'}, ${i.textures} textures (${i.images.join(', ')}) · attributes ${i.attributes.join(', ')}\n  skins: ${i.skins.length ? i.skins.map((n) => n + ' joints').join(', ') : 'none'} · animations: ${i.animations.length ? i.animations.join(', ') : 'none'}`);
  }
}
