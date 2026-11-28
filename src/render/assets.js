// Unit models that come from files rather than from code (built by tools/assets/build.js into assets/game/).
//
// `loadUnitPacks` fetches the manifest, then each unit's pack and color texture, and hands each to `onUnit` as it
// arrives: the game starts on its built-in models and takes these up when they are ready. Nothing here is needed
// for the game to run: a pack that fails to load leaves that unit on its built-in model.

const BASE = 'assets/game/';

/** Split a pack (see tools/assets/build.js for the layout) into its header and typed views on its data. */
export function parsePack(buf) {
  const dv = new DataView(buf);
  if (dv.getUint32(0, true) !== 0x31554448) throw new Error('not a unit pack'); // "HDU1"
  const hl = dv.getUint32(4, true), head = JSON.parse(new TextDecoder().decode(new Uint8Array(buf, 8, hl)));
  const data = 8 + hl + ((4 - ((8 + hl) & 3)) & 3);
  return {
    ...head,
    lods: head.lods.map((l) => ({ ...l, vertexData: new Uint8Array(buf, data + l.vertexOffset, l.vertices * 28), indexData: new Uint16Array(buf, data + l.indexOffset, l.triangles * 3) })),
    anim: new Float32Array(buf, data + head.animOffset, head.frames * head.bones * 12),
    clip: Object.fromEntries(head.clips.map((c) => [c.name, c])),
  };
}

/**
 * @param onUnit    (name, pack, image) called once for each unit as it finishes loading
 * @param progress  optional (done, total)
 */
/** A sculpted piece of the fortress (tools/assets/prop.js): its shape alone, to be drawn in the game's own stone. */
export function parseProp(buf) {
  const dv = new DataView(buf);
  if (String.fromCharCode(dv.getUint8(0), dv.getUint8(1), dv.getUint8(2), dv.getUint8(3)) !== 'HDP1') throw new Error('not a prop file');
  const hl = dv.getUint32(4, true), h = JSON.parse(new TextDecoder().decode(new Uint8Array(buf, 8, hl))), al = (n) => (n + 3) & ~3;
  let o = al(8 + hl);
  const pos = new Int16Array(buf, o, h.places * 3); o = al(o + h.places * 6);
  const nrm = new Int8Array(buf, o, h.places * 3); o = al(o + h.places * 3);
  const shade = new Uint8Array(buf, o, h.places); o = al(o + h.places);
  const index = h.wide ? new Uint32Array(buf, o, h.triangles * 3) : new Uint16Array(buf, o, h.triangles * 3);
  return { ...h, pos, nrm, shade, index };
}

export async function loadUnitPacks(onUnit, progress, onProp, onTexture) {
  let manifest;
  try { const r = await fetch(`${BASE}manifest.json`, { cache: 'no-cache' }); if (!r.ok) return 0; manifest = await r.json(); } catch { return 0; }
  const names = Object.keys(manifest.units || {});
  let done = 0;
  if (onTexture) for (const [name, t] of Object.entries(manifest.textures || {})) {
    fetch(BASE + t.file).then((r) => { if (!r.ok) throw new Error(r.status); return r.blob(); }).then((b) => createImageBitmap(b, { premultiplyAlpha: 'none', colorSpaceConversion: 'none' })).then((im) => onTexture(name, im)).catch((err) => console.warn(`texture "${name}" did not load`, err));
  }
  if (onProp) for (const [name, p] of Object.entries(manifest.props || {})) {
    fetch(BASE + p.file).then((r) => { if (!r.ok) throw new Error(r.status); return r.arrayBuffer(); }).then((b) => onProp(name, parseProp(b))).catch((err) => console.warn(`fortress piece "${name}" did not load; the built-in one stays`, err));
  }
  await Promise.all(names.map(async (name) => {
    const u = manifest.units[name];
    try {
      const [pack, image] = await Promise.all([
        fetch(BASE + u.pack).then((r) => { if (!r.ok) throw new Error(r.status); return r.arrayBuffer(); }).then(parsePack),
        u.texture ? fetch(BASE + u.texture).then((r) => { if (!r.ok) throw new Error(r.status); return r.blob(); }).then((b) => createImageBitmap(b, { premultiplyAlpha: 'none', colorSpaceConversion: 'none' })) : null,
      ]);
      onUnit(name, pack, image);
    } catch (err) { console.warn(`unit model "${name}" did not load; its built-in model stays`, err); }
    if (progress) progress(++done, names.length);
  }));
  return done;
}
