// A unit's source, as the repository keeps it: tools/assets/src/<unit>/
//   model.json   what is in the other files, and where
//   model.bin    the rigged mesh as the generator made it (its own axes and scale)
//   colour.jpg   its colour texture
//   clips.bin    every clip as bone matrices (rest place -> place in that frame), a 4x4 per bone per frame
// The generator's own files are far larger (each clip repeats the mesh and three textures) and are not kept.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const dir = (name) => path.join(fileURLToPath(new URL('./src/', import.meta.url)), name);
const PARTS = [['pos', Float32Array], ['nrm', Float32Array], ['uv', Float32Array], ['joints', Uint8Array], ['weights', Float32Array], ['index', Uint32Array], ['ibm', Float32Array]];

export function writeSource(name, { mesh, clips, fps, colour, note }) {
  const d = dir(name); fs.mkdirSync(d, { recursive: true });
  const parts = {}, bufs = []; let off = 0;
  for (const [k, T] of PARTS) {
    const a = k === 'ibm' ? mesh.skin.ibm : mesh[k], t = a instanceof T ? a : T.from(a), b = Buffer.from(t.buffer, t.byteOffset, t.byteLength);
    parts[k] = { offset: off, length: t.length }; bufs.push(b); off += b.length;
    const pad = (4 - (off & 3)) & 3; if (pad) { bufs.push(Buffer.alloc(pad)); off += pad; }
  }
  fs.writeFileSync(path.join(d, 'model.bin'), Buffer.concat(bufs));
  let coff = 0; const cb = [];
  const cl = clips.map((c) => { const b = Buffer.from(c.mats.buffer, c.mats.byteOffset, c.mats.byteLength), e = { name: c.name, loop: c.loop, frames: c.frames, stride: +c.stride.toFixed(5), offset: coff }; cb.push(b); coff += b.length; return e; });
  fs.writeFileSync(path.join(d, 'clips.bin'), Buffer.concat(cb));
  if (colour) fs.writeFileSync(path.join(d, 'colour.jpg'), colour);
  fs.writeFileSync(path.join(d, 'model.json'), JSON.stringify({ unit: name, note, fps, bones: mesh.skin.names, parts, clips: cl }, null, 2) + '\n');
}

export function readSource(name) {
  const d = dir(name);
  if (!fs.existsSync(path.join(d, 'model.json'))) throw new Error(`no source for "${name}" in tools/assets/src/: run tools/assets/import.js first`);
  const j = JSON.parse(fs.readFileSync(path.join(d, 'model.json'), 'utf8')), bin = fs.readFileSync(path.join(d, 'model.bin')), cbin = fs.readFileSync(path.join(d, 'clips.bin'));
  const view = (buf, T, off, len) => new T(buf.buffer.slice(buf.byteOffset + off, buf.byteOffset + off + len * T.BYTES_PER_ELEMENT));
  const mesh = { skin: { names: j.bones } };
  for (const [k, T] of PARTS) { const a = view(bin, T, j.parts[k].offset, j.parts[k].length); if (k === 'ibm') mesh.skin.ibm = a; else mesh[k] = a; }
  const nj = j.bones.length;
  const clips = j.clips.map((c) => ({ ...c, mats: view(cbin, Float32Array, c.offset, c.frames * nj * 16) }));
  const colour = path.join(d, 'colour.jpg');
  return { mesh, clips, fps: j.fps, colour: fs.existsSync(colour) ? colour : null };
}
