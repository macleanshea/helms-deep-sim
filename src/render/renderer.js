// WebGL2 renderer: a perspective view over the valley (see camera.js).
//  - terrain: a height-field mesh textured from a baked procedural albedo
//  - fortress: one static mesh, rebuilt when a section is breached, casting a shadow map
//  - units, vehicles, props, ordnance: instanced meshes with shader animation, each drawn at one of
//    four levels of detail chosen from its size on screen (dots, boxes, blocky stand-ins, full models)
//  - surfaces are textured from two generated material arrays (see materials.js)
//  - particles: billboards / streaks / ground quads, depth-tested against the scene
//  - corpses, craters and scorch marks are stamped into a persistent decal texture
//  - optional post-processing: MSAA resolve, bloom, vignette

import { WORLD_W, WORLD_H, UNITS, DEF, U, R } from '../config.js';
import { HM_W, HM_H, MARGIN, GZ_W, HM_RES } from '../map.js';
import { COLS, SPR } from './atlas.js';
import { buildModels } from './models/index.js';
import { LASHED_LEN } from './models/siege.js';
import { buildMaterials } from './materials.js';
import { buildStructures, torchSites } from './structures.js';
import { viewProj, orthoMatrix, camState, FOV } from './camera.js';
import { UNIT_TRI_BUDGET } from './perf.js';
import { S_DONE, S_CLIMB, MAX_UNITS } from '../sim/sim.js';
import * as SH from './shaders.js';
import { LAYOUT } from '../layout.js';

const PSTRIDE = 52, PF = 13;         // particle instance: bytes / floats
const ISTRIDE = 32;                  // mesh instance bytes
const GRID = 4;                      // terrain mesh spacing (m)
const SUN = (() => { const v = [-0.5, 0.4, 0.77], l = Math.hypot(...v); return v.map((q) => q / l); })();
// region covered by the shadow map: the fortress and its approaches
const SB = { x0: LAYOUT.shadowBox[0], x1: LAYOUT.shadowBox[2], y0: LAYOUT.shadowBox[1], y1: LAYOUT.shadowBox[3], z0: -8, z1: 120 };

// Levels of detail by scale on screen (CSS px per meter where the unit stands): dots, boxes, stand-ins, full models. The player's
// model-detail setting (`heroScale`) moves the whole ladder: full models take over at HERO_ZOOM x
// heroScale (0.5 = twice as far out); dots move out more gently, with the square root of it, so the
// whole valley stays cheap to draw; and boxes give way to stand-ins at the geometric midpoint, so
// boxes and stand-ins each cover the same span of zoom at every setting.
const DOT_ZOOM = 2.0;
const HERO_ZOOM = { high: 11, medium: 14, low: 18 };
// The zooms (CSS px per meter at the middle of the view) between which soldiers are washed toward their side's color.
const WASH_FROM = 5.5, WASH_FULL = 2.6;
export const HERO_SCALE_DEFAULT = 0.3;
// how linear light is scaled from the display-space mood colors in main.js
const SUN_GAIN = 1.3, AMB_GAIN = 1.1, EXPOSURE = 1.05;

// simulation unit type -> model names (one is picked per unit, for variety), drawing scale, and
// whether individuals vary a little in height
const MESH_OF = { rifle: [['rifle'], 1.3, 1], mg: [['mg'], 1.3, 1], marksman: [['marksman'], 1.3, 1], grenadier: [['grenadier'], 1.3, 1], at: [['at'], 1.3, 1], cmd: [['cmd'], 1.4, 0], mortar: [['mortar'], 1.3, 0], howitzer: [['howitzer'], 1.15, 0],
  ifv: [['ifv'], 1, 0], tank: [['tank'], 1, 0], cache: [['cache'], 1, 0], crate: [['crate'], 1, 0], uruk: [['uruk', 'urukB', 'urukC'], 1.3, 1], archer: [['archer', 'archerB'], 1.3, 1], berserker: [['berserker', 'berserkerB'], 1.4, 1], sapper: [['sapper'], 1.35, 0], chief: [['chief'], 1.6, 0],
  warg: [['warg'], 1.35, 1], troll: [['troll'], 1.25, 1], ladder: [['ladder'], 1, 0], ram: [['ram'], 1.15, 0], catapult: [['catapult'], 1.15, 0], tower: [['tower'], 1, 0] };
const PROP_MESH = { wire: 'wire', av: 'hedgehog', mine: 'mine', claymore: 'claymore' };
// where a lashed ladder (src/sim/lashed.js) rests on the ring's parapet: just outside the breast wall's outer face, at
// the sill of its embrasures (structures.js `battlement`: the breast wall stands 0.41 m out from the face, 1.1 m high)
const LASH_OUT = 0.45, LASH_UP = 1.1;

function compile(gl, vs, fs) {
  const p = gl.createProgram();
  for (const [type, src] of [[gl.VERTEX_SHADER, vs], [gl.FRAGMENT_SHADER, fs]]) {
    const s = gl.createShader(type);
    gl.shaderSource(s, src); gl.compileShader(s);
    if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s) + '\n' + src.split('\n').slice(0, 12).join('\n'));
    gl.attachShader(p, s);
  }
  gl.linkProgram(p);
  if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(p));
  const u = {};
  const n = gl.getProgramParameter(p, gl.ACTIVE_UNIFORMS);
  for (let i = 0; i < n; i++) { const info = gl.getActiveUniform(p, i); u[info.name.replace('[0]', '')] = gl.getUniformLocation(p, info.name); }
  return { p, u };
}

export class Renderer {
  constructor(canvas, map, atlasCanvas) {
    this.canvas = canvas; this.map = map;
    const gl = canvas.getContext('webgl2', { antialias: true, alpha: false, powerPreference: 'high-performance' });
    if (!gl) throw new Error('WebGL2 is required');
    this.gl = gl;
    // HDR: the picture kept in true light values (half floats) until one tone curve at the end. Needs float color buffers;
    // ?hdr=0 turns it off; the 'low' quality draws straight to the screen and never uses it.
    this.hdrOK = !!gl.getExtension('EXT_color_buffer_float') && !/[?&]hdr=0\b/.test(typeof location !== 'undefined' ? location.search : '');
    this._hdr = -1;
    this.pTerrain = compile(gl, SH.VS_TERRAIN, SH.FS_TERRAIN);
    this.pStruct = compile(gl, SH.VS_STRUCT, SH.FS_STRUCT);
    this.pDepth = compile(gl, SH.VS_DEPTH, SH.FS_DEPTH);
    this.pUnit = compile(gl, SH.VS_UNIT, SH.FS_UNIT);
    this.pPart = compile(gl, SH.VS_PART, SH.FS_PART);
    this.pStamp = compile(gl, SH.VS_STAMP, SH.FS_STAMP);
    this.pBake = compile(gl, SH.VS_FULL, SH.FS_BAKE);
    this.timerExt = gl.getExtension('EXT_disjoint_timer_query_webgl2');
    this.pBright = compile(gl, SH.VS_FULL, SH.FS_BRIGHT);
    this.pBlur = compile(gl, SH.VS_FULL, SH.FS_BLUR);
    this.pComp = compile(gl, SH.VS_FULL, SH.FS_COMPOSITE);
    this.pSky = compile(gl, SH.VS_FULL, SH.FS_SKY);
    // units from model files: a program for each number of bones a vertex may follow (by level of detail)
    this.pSkin = { 1: compile(gl, SH.skinVS(1), SH.FS_SKIN), 2: compile(gl, SH.skinVS(2), SH.FS_SKIN), 4: compile(gl, SH.skinVS(4), SH.FS_SKIN) };
    this.assets = {}; this.unitAsset = UNITS.map(() => null);
    this.animPhase = new Float32Array(MAX_UNITS); this.animDt = 0; this._simT = 0; // where each soldier is in his stride

    // shared quads
    this.quad = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, this.quad);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([0, 0, 1, 0, 0, 1, 1, 1]), gl.STATIC_DRAW);
    this.cquad = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, this.cquad);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-0.5, -0.5, 0.5, -0.5, -0.5, 0.5, 0.5, 0.5]), gl.STATIC_DRAW);
    this.vaoFull = gl.createVertexArray();
    gl.bindVertexArray(this.vaoFull);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.quad);
    gl.enableVertexAttribArray(0); gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);

    // particles
    this.partMax = 40000;
    this.partData = new ArrayBuffer(this.partMax * PSTRIDE);
    this.partF = new Float32Array(this.partData); this.partU = new Uint32Array(this.partData);
    this.partBuf = gl.createBuffer();
    this.vaoPart = gl.createVertexArray();
    gl.bindVertexArray(this.vaoPart);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.cquad);
    gl.enableVertexAttribArray(0); gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.partBuf);
    gl.bufferData(gl.ARRAY_BUFFER, this.partData.byteLength, gl.DYNAMIC_DRAW);
    const pa = [[1, 3, gl.FLOAT, false, 0], [2, 4, gl.FLOAT, false, 12], [3, 4, gl.UNSIGNED_BYTE, true, 28], [4, 2, gl.FLOAT, false, 32], [5, 3, gl.FLOAT, false, 40]];
    for (const [loc, n, type, norm, off] of pa) { gl.enableVertexAttribArray(loc); gl.vertexAttribPointer(loc, n, type, norm, PSTRIDE, off); gl.vertexAttribDivisor(loc, 1); }

    // decal stamps
    this.stampData = new ArrayBuffer(16384 * 24);
    this.stampF = new Float32Array(this.stampData); this.stampU = new Uint32Array(this.stampData);
    this.stampBuf = gl.createBuffer();
    this.vaoStamp = gl.createVertexArray();
    gl.bindVertexArray(this.vaoStamp);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.cquad);
    gl.enableVertexAttribArray(0); gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.stampBuf);
    gl.bufferData(gl.ARRAY_BUFFER, this.stampData.byteLength, gl.DYNAMIC_DRAW);
    gl.enableVertexAttribArray(1); gl.vertexAttribPointer(1, 4, gl.FLOAT, false, 24, 0); gl.vertexAttribDivisor(1, 1);
    gl.enableVertexAttribArray(2); gl.vertexAttribPointer(2, 1, gl.FLOAT, false, 24, 16); gl.vertexAttribDivisor(2, 1);
    gl.enableVertexAttribArray(3); gl.vertexAttribPointer(3, 4, gl.UNSIGNED_BYTE, true, 24, 20); gl.vertexAttribDivisor(3, 1);
    gl.bindVertexArray(null);

    // sprite atlas (particles and decals)
    gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, true);
    this.atlas = this._tex(gl.LINEAR_MIPMAP_LINEAR);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, atlasCanvas);
    gl.generateMipmap(gl.TEXTURE_2D);
    gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);

    const maxTex = gl.getParameter(gl.MAX_TEXTURE_SIZE);
    this.texScale = maxTex >= 4096 ? 2 : 1;
    this.mats = buildMaterials(gl, compile, SH.VS_FULL, this.vaoFull, 512);
    this._bakeTerrain();
    this._buildTerrainMesh();
    this._bakeTorches();
    this._HT = new Float32Array(6000); this._nHT = 0; this._bakeHordeTorches();

    // decal layer over the playable world
    this.decalW = WORLD_W * this.texScale; this.decalH = WORLD_H * this.texScale;
    this.decalTex = this._tex(gl.LINEAR);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, this.decalW, this.decalH, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
    this.decalFbo = gl.createFramebuffer();
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.decalFbo);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, this.decalTex, 0);
    gl.clearColor(0, 0, 0, 0); gl.clear(gl.COLOR_BUFFER_BIT);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);

    // models
    this.meshes = buildModels();
    for (const name in this.meshes) this._initModel(this.meshes[name]);
    this.unitMesh = UNITS.map((d) => {
      const m = MESH_OF[d.key];
      if (!m) return null;
      // a variant that has not been modeled falls back to the first
      const variants = m[0].map((n) => this.meshes[n]).filter(Boolean);
      return { variants, scale: m[1], jitter: m[2], turret: d.key === 'tank' ? this.meshes.tankTurret : d.key === 'ifv' ? this.meshes.ifvTurret : null };
    });
    this.struct = { vbo: gl.createBuffer(), vao: gl.createVertexArray(), vaoDepth: gl.createVertexArray(), count: 0 };
    this._meshAttribs(this.struct.vao, this.struct.vbo);
    gl.bindVertexArray(this.struct.vaoDepth);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.struct.vbo);
    gl.enableVertexAttribArray(0); gl.vertexAttribPointer(0, 3, gl.FLOAT, false, 20, 0);
    gl.bindVertexArray(null);
    this.structVersion = -1; this.propVersion = -1; this.propSim = null; this.structCache = new Map();

    // shadow map
    this.shadowSize = Math.min(2048, maxTex);
    this.shadowTex = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, this.shadowTex);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.DEPTH_COMPONENT24, this.shadowSize, this.shadowSize, 0, gl.DEPTH_COMPONENT, gl.UNSIGNED_INT, null);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_COMPARE_MODE, gl.COMPARE_REF_TO_TEXTURE); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_COMPARE_FUNC, gl.LEQUAL);
    this.shadowFbo = gl.createFramebuffer();
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.shadowFbo);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.DEPTH_ATTACHMENT, gl.TEXTURE_2D, this.shadowTex, 0);
    gl.drawBuffers([gl.NONE]); gl.readBuffer(gl.NONE);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    this.shadowVP = this._lightMatrix(); this.shadowTexel = 1 / this.shadowSize;

    this.quality = 'high'; this.post = null; this.heroScale = HERO_SCALE_DEFAULT;
    this.vp = new Float32Array(16);
    this.lpos = new Float32Array(24); this.lcol = new Float32Array(18);
    this.stats = { units: 0, parts: 0, dots: 0, tier: 0, draws: 0, tris: { terrain: 0, fort: 0, units: 0, shadows: 0, fx: 0 }, cpu: 0, gpu: {}, gpuOk: !!this.timerExt };
    this.perfOn = false; this._queries = []; this._query = null; this.eye = new Float32Array(3); this.haze = new Float32Array(4);
    this.lodBias = 1; this._tier = 0; this.camF = 1; // lodBias > 1 pulls every level of detail in closer, to hold the triangle budget
    gl.enable(gl.DEPTH_TEST); gl.depthFunc(gl.LEQUAL);
    gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
  }

  _tex(minFilter) {
    const gl = this.gl, t = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, t);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, minFilter);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    return t;
  }

  _meshAttribs(vao, vbo) {
    const gl = this.gl;
    gl.bindVertexArray(vao);
    gl.bindBuffer(gl.ARRAY_BUFFER, vbo);
    gl.enableVertexAttribArray(0); gl.vertexAttribPointer(0, 3, gl.FLOAT, false, 20, 0);
    gl.enableVertexAttribArray(1); gl.vertexAttribPointer(1, 3, gl.BYTE, true, 20, 12);
    gl.enableVertexAttribArray(2); gl.vertexAttribPointer(2, 1, gl.UNSIGNED_BYTE, false, 20, 15);
    gl.enableVertexAttribArray(3); gl.vertexAttribPointer(3, 4, gl.UNSIGNED_BYTE, true, 20, 16);
  }

  /** Point the bound vertex array's per-instance attributes at `buf`, starting `base` bytes in. */
  _instAttribs(buf, base = 0) {
    const gl = this.gl;
    gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    gl.enableVertexAttribArray(4); gl.vertexAttribPointer(4, 4, gl.FLOAT, false, ISTRIDE, base); gl.vertexAttribDivisor(4, 1);
    gl.enableVertexAttribArray(5); gl.vertexAttribPointer(5, 2, gl.FLOAT, false, ISTRIDE, base + 16); gl.vertexAttribDivisor(5, 1);
    gl.enableVertexAttribArray(6); gl.vertexAttribPointer(6, 4, gl.UNSIGNED_BYTE, true, ISTRIDE, base + 24); gl.vertexAttribDivisor(6, 1);
    gl.enableVertexAttribArray(7); gl.vertexAttribPointer(7, 4, gl.UNSIGNED_BYTE, true, ISTRIDE, base + 28); gl.vertexAttribDivisor(7, 1);
  }

  /**
   * GPU buffers for a model. Its instances are queued in three lists, one for each level of detail it can be
   * drawn at (0 full, 1 stand-in, 2 box), which go to the GPU end to end in one buffer; static props have their own.
   */
  _initModel(m) {
    const gl = this.gl;
    m.lists = [0, 1, 2].map(() => { const idata = new ArrayBuffer(64 * ISTRIDE); return { cap: 64, n: 0, f: new Float32Array(idata), u8: new Uint8Array(idata) }; });
    m.n = 0; m.gcap = 0;
    m.ibuf = gl.createBuffer(); m.pbuf = gl.createBuffer(); m.pn = 0;
    for (const geo of [m.full, m.mid, m.lod]) {
      if (!geo) continue;
      const vbo = gl.createBuffer();
      gl.bindBuffer(gl.ARRAY_BUFFER, vbo);
      gl.bufferData(gl.ARRAY_BUFFER, geo.data, gl.STATIC_DRAW);
      let ibo = null;
      if (geo.index) { ibo = gl.createBuffer(); geo.itype = geo.index instanceof Uint32Array ? gl.UNSIGNED_INT : gl.UNSIGNED_SHORT; geo.n = geo.index.length; } else geo.n = geo.count;
      for (const [key, ibuf] of [['vao', m.ibuf], ['pvao', m.pbuf]]) {
        geo[key] = gl.createVertexArray(); this._meshAttribs(geo[key], vbo); this._instAttribs(ibuf);
        if (ibo) gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, ibo);
      }
      if (ibo) gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, geo.index, gl.STATIC_DRAW);
      geo.data = null; // the GPU has it now
    }
    gl.bindVertexArray(null);
  }

  /**
   * Take up a unit model built from files (see assets.js and tools/assets/build.js): its levels of detail, its
   * colors and its clips. From then on every unit of that kind is drawn with it instead of the built-in model.
   */
  addUnitAsset(name, pack, image) {
    const gl = this.gl, unit = UNITS.findIndex((d) => d.key === name);
    if (!pack.lods.length || !image) return; // (a pack that is no unit's is an aircraft: drawn by name, see _fillDynamic)
    const a = { name, clip: pack.clip, height: pack.height, big: Math.max(1, (pack.span || 0) / 2.4), n: 0, gcap: 0, ibuf: gl.createBuffer(), lods: [],
      lists: [0, 1, 2, 3].map(() => { const idata = new ArrayBuffer(64 * ISTRIDE); return { cap: 64, n: 0, f: new Float32Array(idata), u8: new Uint8Array(idata) }; }) };
    // every frame of every clip: a row a frame, three texels a bone
    a.bones = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, a.bones);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA32F, pack.bones * 3, pack.frames, 0, gl.RGBA, gl.FLOAT, pack.anim);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    a.tex = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, a.tex);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, gl.RGBA, gl.UNSIGNED_BYTE, image);
    gl.generateMipmap(gl.TEXTURE_2D);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    const an = gl.getExtension('EXT_texture_filter_anisotropic'); if (an) gl.texParameterf(gl.TEXTURE_2D, an.TEXTURE_MAX_ANISOTROPY_EXT, 4);
    for (const l of pack.lods) {
      const vbo = gl.createBuffer(), ibo = gl.createBuffer(), vao = gl.createVertexArray();
      gl.bindVertexArray(vao);
      gl.bindBuffer(gl.ARRAY_BUFFER, vbo); gl.bufferData(gl.ARRAY_BUFFER, l.vertexData, gl.STATIC_DRAW);
      gl.enableVertexAttribArray(0); gl.vertexAttribPointer(0, 3, gl.FLOAT, false, 28, 0);
      gl.enableVertexAttribArray(1); gl.vertexAttribPointer(1, 3, gl.BYTE, true, 28, 12);
      gl.enableVertexAttribArray(2); gl.vertexAttribPointer(2, 2, gl.UNSIGNED_SHORT, true, 28, 16);
      gl.enableVertexAttribArray(3); gl.vertexAttribPointer(3, 4, gl.UNSIGNED_BYTE, false, 28, 20);
      gl.enableVertexAttribArray(8); gl.vertexAttribPointer(8, 4, gl.UNSIGNED_BYTE, true, 28, 24);
      this._instAttribs(a.ibuf);
      gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, ibo); gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, l.indexData, gl.STATIC_DRAW);
      a.lods.push({ vao, count: l.triangles * 3, prog: this.pSkin[l.influences] || this.pSkin[4] });
    }
    gl.bindVertexArray(null);
    this.assets[name] = a; if (unit >= 0) this.unitAsset[unit] = a;
    if (this.fx) this.fx.model3d = this.unitAsset;
  }

  /** Draw the units that come from model files. In the shadow pass the nearest are drawn one level of detail down. */
  _drawSkinned(env, shadowPass) {
    const gl = this.gl, st = this.stats;
    for (const name in this.assets) {
      const a = this.assets[name];
      if (!a.n) continue;
      gl.activeTexture(gl.TEXTURE6); gl.bindTexture(gl.TEXTURE_2D, a.bones);
      gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, a.tex);
      for (let t = 0, base = 0, last = null; t < 4; t++) {
        const n = a.lists[t].n;
        if (!n) continue;
        const lod = a.lods[Math.min(a.lods.length - 1, shadowPass ? t + 1 : t)], p = lod.prog;
        if (p !== last) {
          last = p;
          gl.useProgram(p.p); this._common(p.u, env);
          gl.uniform1f(p.u.uShadowPass, shadowPass ? 1 : 0); gl.uniform1f(p.u.uLift, env.lift);
          gl.uniform1i(p.u.uTex, 0); gl.uniform1i(p.u.uBones, 6);
        }
        gl.bindVertexArray(lod.vao);
        this._instAttribs(a.ibuf, base * ISTRIDE); base += n;
        gl.drawElementsInstanced(gl.TRIANGLES, lod.count, gl.UNSIGNED_SHORT, 0, n);
        st.draws++; if (shadowPass) st.tris.shadows += (lod.count / 3) * n; else st.tris.units += (lod.count / 3) * n;
      }
    }
  }

  _put(m, x, y, z, yaw, scale, phase, r, g, b, flash, walk, atk, tilt, pose = 0) {
    const L = m.lists[this._tier]; // (the level of detail is set by the caller before it queues a unit)
    if (L.n >= L.cap) {
      L.cap *= 2;
      const nd = new ArrayBuffer(L.cap * ISTRIDE); new Uint8Array(nd).set(L.u8);
      L.f = new Float32Array(nd); L.u8 = new Uint8Array(nd);
    }
    const o = L.n * 8, f = L.f, u = L.u8, b8 = L.n * ISTRIDE;
    f[o] = x; f[o + 1] = y; f[o + 2] = z; f[o + 3] = yaw; f[o + 4] = scale; f[o + 5] = phase;
    u[b8 + 24] = r; u[b8 + 25] = g; u[b8 + 26] = b; u[b8 + 27] = flash; u[b8 + 28] = walk; u[b8 + 29] = atk; u[b8 + 30] = tilt; u[b8 + 31] = pose;
    L.n++; m.n++;
  }

  // ------------------------------------------------------------- terrain
  _bakeTerrain() {
    const gl = this.gl;
    const hm = this._tex(gl.LINEAR);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA16F, HM_W, HM_H, 0, gl.RGBA, gl.FLOAT, this.map.hm);
    const sc = this.texScale, w = HM_W * HM_RES * sc, h = HM_H * HM_RES * sc;
    this.albRect = [-MARGIN, -MARGIN, HM_W * HM_RES, HM_H * HM_RES];
    this.albedo = this._tex(gl.LINEAR_MIPMAP_LINEAR);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, w, h, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
    const fbo = gl.createFramebuffer();
    gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, this.albedo, 0);
    gl.viewport(0, 0, w, h);
    gl.disable(gl.DEPTH_TEST); gl.disable(gl.BLEND);
    gl.useProgram(this.pBake.p);
    gl.uniform4fv(this.pBake.u.uRect, this.albRect);
    gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, hm); gl.uniform1i(this.pBake.u.uHM, 0);
    gl.bindVertexArray(this.vaoFull);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.bindTexture(gl.TEXTURE_2D, this.albedo); gl.generateMipmap(gl.TEXTURE_2D);
    gl.deleteFramebuffer(fbo);
    this.hmTex = hm; // kept: the terrain shader reads its material masks (rock, dirt, water) at run time
    gl.enable(gl.DEPTH_TEST);
  }

  /**
   * Crags: the mountainsides are cut into ledges and sheer rises, with gullies between buttresses. Only the picture
   * changes (the battle's ground is the map's own, and nothing walks up there); the rock is only ever cut away, never
   * built out, so the camera, which keeps clear of the map's ground, cannot end up inside it. The valley floor, the
   * Hornburg's shelf and the rock the fortress is built into are left as they are.
   */
  _crags(v, nx, ny) {
    const hm = this.map.hm, st = GRID / HM_RES, K = this.map.layout.keep;
    const hash = (i, j) => { let h = Math.imul(i, 374761393) ^ Math.imul(j, 668265263); h = Math.imul(h ^ (h >>> 13), 1274126177); return ((h ^ (h >>> 16)) >>> 0) / 4294967296; };
    const vn = (x, y) => { const i = Math.floor(x), j = Math.floor(y), a = x - i, b = y - j, sa = a * a * (3 - 2 * a), sb = b * b * (3 - 2 * b), p = hash(i, j), q = hash(i + 1, j), r = hash(i, j + 1), t = hash(i + 1, j + 1); return p + (q - p) * sa + (r - p) * sb + (p - q - r + t) * sa * sb; };
    const ridge = (x, y) => { const n = 1 - Math.abs(2 * vn(x, y) - 1); return n * n; };
    const ss = (a, b, x) => { const t = Math.max(0, Math.min(1, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
    const moved = new Uint8Array(nx * ny);
    for (let j = 1; j < ny - 1; j++) for (let i = 1; i < nx - 1; i++) {
      const o = (j * nx + i) * 6, X = v[o], Y = v[o + 1], z = v[o + 2];
      const a = Math.min(HM_W - 1, Math.max(0, Math.round(i * st))), b = Math.min(HM_H - 1, Math.max(0, Math.round(j * st))), rock = hm[(b * HM_W + a) * 4 + 1];
      const dk = Math.hypot(X - K.cx, Y - K.cy);
      // the rock the Hornburg stands on: its smooth skirt is broken into ribs and hollows, so the wall grows out of crag
      const ws = ss(K.r + K.half + 1.5, K.r + K.half + 4.5, dk) * (1 - ss(K.r + K.half + 9, K.r + K.half + 13, dk)) * ss(0.4, 2, z) * ss(0.05, 0.3, rock);
      if (ws > 0.01) {
        const cut = ((1 - ridge(X / 15 + 3.1, Y / 15 + 7.7)) * 0.65 + (1 - ridge(X / 7 + 1.3, Y / 7)) * 0.35) * 3.2 * ws;
        v[o + 2] = z - cut; moved[j * nx + i] = 1;
        continue;
      }
      const w = ss(0.55, 0.9, rock) * ss(16, 44, z) * ss(K.r + 24, K.r + 70, dk);
      if (w < 0.01) continue;
      // strata: each band of height is a ledge, then a sheer rise, then the slope it had (the bands wander, so no ledge runs level for long)
      const S = 36, wob = (vn(X / 170, Y / 170) - 0.5) * 1.6, q = z / S + wob, f = q - Math.floor(q);
      const stepped = (Math.floor(q) + ss(0.45, 0.8, f) - wob) * S;
      let z2 = z + (Math.min(z, stepped) - z) * 0.9 * w;
      // gullies: the face is cut back between buttresses, deepest where two scales of furrow meet
      const cut = (1 - (ridge(X / 88, Y / 88) * 0.6 + ridge(X / 34 + 9.3, Y / 34 + 4.1) * 0.4)) * 12 * w;
      const hl = Math.hypot(v[o + 3], v[o + 4]) || 1;
      v[o] -= (v[o + 3] / hl) * cut * 0.4; v[o + 1] -= (v[o + 4] / hl) * cut * 0.4; v[o + 2] = z2 - cut * 0.6;
      moved[j * nx + i] = 1;
    }
    // new normals where the rock was cut (and beside it), from the faces as they now stand
    for (let j = 1; j < ny - 1; j++) for (let i = 1; i < nx - 1; i++) {
      const c = j * nx + i;
      if (!(moved[c] || moved[c - 1] || moved[c + 1] || moved[c - nx] || moved[c + nx])) continue;
      const l = (c - 1) * 6, r = (c + 1) * 6, u = (c - nx) * 6, d = (c + nx) * 6;
      const ax = v[r] - v[l], ay = v[r + 1] - v[l + 1], az = v[r + 2] - v[l + 2], bx = v[d] - v[u], by = v[d + 1] - v[u + 1], bz = v[d + 2] - v[u + 2];
      let x = ay * bz - az * by, y = az * bx - ax * bz, z = ax * by - ay * bx;
      if (z < 0) { x = -x; y = -y; z = -z; }
      const len = Math.hypot(x, y, z) || 1;
      v[c * 6 + 3] = x / len; v[c * 6 + 4] = y / len; v[c * 6 + 5] = z / len;
    }
  }

  /**
   * The watch fires as a map: for every place in and round the fortress, how much firelight reaches it (red channel)
   * and how high the fires that give it burn (alpha, in units of 64 m). Every lit shader reads it by position, so
   * dozens of fires cost one texture read. Baked once: the braziers do not move.
   */
  _bakeTorches() {
    const gl = this.gl, N = 384, x0 = SB.x0 - 30, y0 = SB.y0 - 30, w = SB.x1 - SB.x0 + 60, h = SB.y1 - SB.y0 + 60, I = new Float32Array(N * N), Z = new Float32Array(N * N), R = 17;
    for (const t of torchSites(this.map)) {
      const ci = ((t.x - x0) / w) * N, cj = ((t.y - y0) / h) * N, ri = Math.ceil((R / w) * N), rj = Math.ceil((R / h) * N);
      for (let j = Math.max(1, Math.floor(cj - rj)); j <= Math.min(N - 2, cj + rj); j++) for (let i = Math.max(1, Math.floor(ci - ri)); i <= Math.min(N - 2, ci + ri); i++) {
        const dx = ((i + 0.5) / N) * w + x0 - t.x, dy = ((j + 0.5) / N) * h + y0 - t.y, d2 = (dx * dx + dy * dy) / (R * R);
        if (d2 >= 1) continue;
        const k = (1 - d2) * (1 - d2) / (1 + d2 * 6);
        I[j * N + i] += k; Z[j * N + i] += k * (t.z + 1.7);
      }
    }
    const px = new Uint8Array(N * N * 4);
    for (let c = 0; c < N * N; c++) { px[c * 4] = Math.min(255, I[c] * 255); px[c * 4 + 3] = I[c] > 1e-4 ? Math.min(255, (Z[c] / I[c] / 64) * 255) : 0; }
    // The same map's other two channels: how closed in each place is by what stands round it (green), and the height of
    // its floor (blue). The lighting code dims the sky's light by the first, most at the floor and less with every meter
    // above it: the foot of a wall, a corner of a court, the well of a stair sit in shade, and the fortress on its ground.
    const gz = this.map.gz, at = (x, y) => (x < 0 || y < 0 || x >= WORLD_W || y >= WORLD_H ? 0 : gz[((y / HM_RES) | 0) * GZ_W + ((x / HM_RES) | 0)]);
    const DIRS = 12, RING = [2.2, 4.4, 7.5, 12];
    for (let j = 1; j < N - 1; j++) for (let i = 1; i < N - 1; i++) {
      const x = ((i + 0.5) / N) * w + x0, y = ((j + 0.5) / N) * h + y0, f = at(x, y);
      let occ = 0;
      for (let d = 0; d < DIRS; d++) {
        const a = (d / DIRS) * 6.2832 + 0.26, cx = Math.cos(a), cy = Math.sin(a);
        let e = 0;
        for (const r of RING) { const k = (at(x + cx * r, y + cy * r) - f) / (r + 1.5); if (k > e) e = k; }
        occ += Math.min(1, e / 1.1);
      }
      const c = j * N + i;
      px[c * 4 + 1] = Math.min(255, (occ / DIRS) * 2.1 * 255); px[c * 4 + 2] = Math.max(0, Math.min(255, (f / 96) * 255));
    }
    this.torchTex = this._tex(gl.LINEAR);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, N, N, 0, gl.RGBA, gl.UNSIGNED_BYTE, px);
    this.torchRect = new Float32Array([x0, y0, w, h]);
  }

  /**
   * The horde's torches as a second map of firelight, over the whole field and made afresh each frame from the
   * torch-bearers in view (a coarse one: a torch's light is a pool a dozen meters across). The ground, the wall's
   * foot and the companies themselves are lit by it as the host comes on.
   */
  _bakeHordeTorches() {
    const gl = this.gl, W = 256, H = 184, n = this._nHT;
    if (!this.torch2Tex) {
      this.torch2Tex = this._tex(gl.LINEAR);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, W, H, 0, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array(W * H * 4));
      this._htI = new Float32Array(W * H); this._htZ = new Float32Array(W * H); this._htPx = new Uint8Array(W * H * 4); this._htDirty = false;
    }
    if (!n && !this._htDirty) return;
    const I = this._htI, Z = this._htZ, px = this._htPx, sx = W / WORLD_W, sy = H / WORLD_H, R = 13, T = this._HT;
    I.fill(0); Z.fill(0);
    for (let k = 0; k < n; k++) {
      const x = T[k * 3], y = T[k * 3 + 1], z = T[k * 3 + 2], ci = x * sx, cj = y * sy, ri = Math.ceil(R * sx), rj = Math.ceil(R * sy);
      for (let j = Math.max(1, Math.floor(cj - rj)); j <= Math.min(H - 2, cj + rj); j++) for (let i = Math.max(1, Math.floor(ci - ri)); i <= Math.min(W - 2, ci + ri); i++) {
        const dx = (i + 0.5) / sx - x, dy = (j + 0.5) / sy - y, d2 = (dx * dx + dy * dy) / (R * R);
        if (d2 >= 1) continue;
        const w = (1 - d2) * (1 - d2);
        I[j * W + i] += w; Z[j * W + i] += w * z;
      }
    }
    for (let c = 0; c < W * H; c++) { const v = I[c]; px[c * 4] = 190 * (1 - Math.exp(-0.55 * v)); /* many torches together do not add without end: the light saturates */ px[c * 4 + 3] = v > 1e-4 ? Math.max(0, Math.min(255, (Z[c] / v / 64) * 255)) : 0; }
    gl.activeTexture(gl.TEXTURE8); gl.bindTexture(gl.TEXTURE_2D, this.torch2Tex);
    gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, W, H, gl.RGBA, gl.UNSIGNED_BYTE, px);
    gl.activeTexture(gl.TEXTURE0);
    this._htDirty = n > 0;
  }

  _buildTerrainMesh() {
    const gl = this.gl, hm = this.map.hm;
    const nx = (HM_W * HM_RES) / GRID + 1, ny = (HM_H * HM_RES) / GRID + 1;
    const H = (i, j) => { const a = Math.min(HM_W - 1, Math.max(0, i)), b = Math.min(HM_H - 1, Math.max(0, j)); return hm[(b * HM_W + a) * 4]; };
    const v = new Float32Array(nx * ny * 6), st = GRID / HM_RES;
    for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) {
      const o = (j * nx + i) * 6, hi = i * st, hj = j * st;
      // average the four texels around the vertex so walls and plateaus keep crisp, level edges
      const z = (H(hi - 1, hj - 1) + H(hi, hj - 1) + H(hi - 1, hj) + H(hi, hj)) / 4;
      v[o] = i * GRID - MARGIN; v[o + 1] = j * GRID - MARGIN; v[o + 2] = z;
      const dx = H(hi + 1, hj) - H(hi - 2, hj), dy = H(hi, hj + 1) - H(hi, hj - 2), l = Math.hypot(dx, dy, 3 * HM_RES);
      v[o + 3] = -dx / l; v[o + 4] = -dy / l; v[o + 5] = (3 * HM_RES) / l;
    }
    this._crags(v, nx, ny);
    const idx = new Uint32Array((nx - 1) * (ny - 1) * 6);
    let k = 0;
    for (let j = 0; j < ny - 1; j++) for (let i = 0; i < nx - 1; i++) { const a = j * nx + i; idx[k++] = a; idx[k++] = a + 1; idx[k++] = a + nx + 1; idx[k++] = a; idx[k++] = a + nx + 1; idx[k++] = a + nx; }
    this.terrain = { vao: gl.createVertexArray(), count: idx.length };
    gl.bindVertexArray(this.terrain.vao);
    const vb = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, vb); gl.bufferData(gl.ARRAY_BUFFER, v, gl.STATIC_DRAW);
    gl.enableVertexAttribArray(0); gl.vertexAttribPointer(0, 3, gl.FLOAT, false, 24, 0);
    gl.enableVertexAttribArray(1); gl.vertexAttribPointer(1, 3, gl.FLOAT, false, 24, 12);
    const ib = gl.createBuffer(); gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, ib); gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, idx, gl.STATIC_DRAW);
    gl.bindVertexArray(null);
  }

  /** Orthographic light matrix looking down the sun direction at the fortress. */
  _lightMatrix() {
    const L = SUN, r = [L[1], -L[0], 0]; const rl = Math.hypot(r[0], r[1]); r[0] /= rl; r[1] /= rl;
    const u = [L[1] * r[2] - L[2] * r[1], L[2] * r[0] - L[0] * r[2], L[0] * r[1] - L[1] * r[0]];
    let a0 = 1e9, a1 = -1e9, b0 = 1e9, b1 = -1e9, d0 = 1e9, d1 = -1e9;
    for (const x of [SB.x0, SB.x1]) for (const y of [SB.y0, SB.y1]) for (const z of [SB.z0, SB.z1]) {
      const a = x * r[0] + y * r[1], b = x * u[0] + y * u[1] + z * u[2], d = x * L[0] + y * L[1] + z * L[2];
      a0 = Math.min(a0, a); a1 = Math.max(a1, a); b0 = Math.min(b0, b); b1 = Math.max(b1, b); d0 = Math.min(d0, d); d1 = Math.max(d1, d);
    }
    const sa = 2 / (a1 - a0), sb = 2 / (b1 - b0), sd = 2 / (d1 - d0);
    // clip = ((a - a0)*sa - 1, (b - b0)*sb - 1, 1 - (d - d0)*sd): nearer the sun = smaller depth
    return new Float32Array([
      r[0] * sa, u[0] * sb, -L[0] * sd, 0,
      r[1] * sa, u[1] * sb, -L[1] * sd, 0,
      0, u[2] * sb, -L[2] * sd, 0,
      -a0 * sa - 1, -b0 * sb - 1, 1 + d0 * sd, 1,
    ]);
  }

  /** A painted layer has arrived (the stone's patina: stains, lichen and damp, laid over the built blocks). */
  addTexture(name, image) {
    if (name !== 'patina') return;
    const gl = this.gl;
    this.patinaTex = this.patinaTex || gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, this.patinaTex);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, gl.RGBA, gl.UNSIGNED_BYTE, image);
    gl.generateMipmap(gl.TEXTURE_2D);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.REPEAT); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.REPEAT);
    const an = gl.getExtension('EXT_texture_filter_anisotropic'); if (an) gl.texParameterf(gl.TEXTURE_2D, an.TEXTURE_MAX_ANISOTROPY_EXT, 4);
  }

  /** A sculpted piece of the fortress has arrived: the fortress is built again with it in place of the built-in one. */
  addProp(name, prop) { (this.props || (this.props = {}))[name] = prop; this.structVersion = -1; }

  _updateStructures(sim) {
    const gl = this.gl;
    const mesh = buildStructures(this.map, sim.segs, this.structCache, this.props);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.struct.vbo);
    gl.bufferData(gl.ARRAY_BUFFER, mesh.data, gl.DYNAMIC_DRAW);
    this.struct.count = mesh.count;
    // re-render the static shadow map
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.shadowFbo);
    gl.viewport(0, 0, this.shadowSize, this.shadowSize);
    gl.clearDepth(1); gl.clear(gl.DEPTH_BUFFER_BIT);
    gl.disable(gl.BLEND); gl.depthMask(true);
    gl.enable(gl.POLYGON_OFFSET_FILL); gl.polygonOffset(2, 4);
    gl.useProgram(this.pDepth.p);
    gl.uniformMatrix4fv(this.pDepth.u.uVP, false, this.shadowVP);
    gl.bindVertexArray(this.terrain.vao); gl.drawElements(gl.TRIANGLES, this.terrain.count, gl.UNSIGNED_INT, 0);
    gl.bindVertexArray(this.struct.vaoDepth); gl.drawArrays(gl.TRIANGLES, 0, this.struct.count);
    gl.disable(gl.POLYGON_OFFSET_FILL);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  }

  _updateProps(sim) {
    const gl = this.gl;
    for (const name in this.meshes) this.meshes[name].pn = 0;
    const lists = {};
    for (const p of sim.props) { if (!p.alive) continue; (lists[PROP_MESH[p.kind]] ||= []).push(p); }
    for (const name in lists) {
      const m = this.meshes[name], ps = lists[name];
      const buf = new ArrayBuffer(ps.length * ISTRIDE), f = new Float32Array(buf), u = new Uint8Array(buf);
      ps.forEach((p, k) => {
        const o = k * 8, b = k * ISTRIDE, v = 215 + ((k * 37) % 40);
        f[o] = p.x; f[o + 1] = p.y; f[o + 2] = this.map.groundZ(p.x, p.y); f[o + 3] = p.ang + (p.kind === 'av' ? k * 1.3 : 0); f[o + 4] = 1; f[o + 5] = 0;
        u[b + 24] = v; u[b + 25] = v; u[b + 26] = v; u[b + 27] = 0;
      });
      gl.bindBuffer(gl.ARRAY_BUFFER, m.pbuf); gl.bufferData(gl.ARRAY_BUFFER, buf, gl.DYNAMIC_DRAW);
      m.pn = ps.length;
    }
  }

  // ---------------------------------------------------------------- decals
  clearDecals() {
    const gl = this.gl;
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.decalFbo);
    gl.clearColor(0, 0, 0, 0); gl.clear(gl.COLOR_BUFFER_BIT);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  }

  /** Burn queued decals (corpses, scorch marks, craters) permanently into the ground texture. */
  _flushDecals(fx) {
    const n = fx.decalCount;
    if (!n) return;
    const gl = this.gl, d = fx.decals, f = this.stampF, u = this.stampU;
    for (let k = 0; k < n; k++) {
      const o = k * 7, q = k * 6;
      f[q] = d[o]; f[q + 1] = d[o + 1]; f[q + 2] = d[o + 2]; f[q + 3] = d[o + 3]; f[q + 4] = d[o + 4];
      u[q + 5] = ((d[o + 6] << 24) | d[o + 5]) >>> 0;
    }
    fx.decalCount = 0;
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.decalFbo);
    gl.viewport(0, 0, this.decalW, this.decalH);
    gl.disable(gl.DEPTH_TEST); gl.enable(gl.BLEND);
    gl.useProgram(this.pStamp.p);
    gl.uniform2f(this.pStamp.u.uWorld2, WORLD_W, WORLD_H); gl.uniform1f(this.pStamp.u.uCols, COLS);
    gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, this.atlas); gl.uniform1i(this.pStamp.u.uAtlas, 0);
    gl.bindVertexArray(this.vaoStamp);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.stampBuf);
    gl.bufferSubData(gl.ARRAY_BUFFER, 0, this.stampF, 0, n * 6);
    gl.drawArraysInstanced(gl.TRIANGLE_STRIP, 0, 4, n);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.enable(gl.DEPTH_TEST);
  }

  // ------------------------------------------------------- post-processing
  resize(w, h) {
    if (this.canvas.width !== w || this.canvas.height !== h) { this.canvas.width = w; this.canvas.height = h; }
  }

  setQuality(q) { this.quality = q; }
  /** Zoom (CSS px per meter) at which full models take over from stand-ins at the current settings. */
  heroZoom(q = this.quality) { return this.lod(q).hero; }
  /** Zooms below which units are dots, boxes and stand-ins; full models from `hero` up. */
  lod(q = this.quality) {
    const dot = DOT_ZOOM * Math.sqrt(this.heroScale), hero = Math.max(dot * 1.5, HERO_ZOOM[q] * this.heroScale);
    return { dot, box: Math.sqrt(dot * hero), hero };
  }

  _ensurePost(w, h, want) {
    const gl = this.gl, hdr = this.hdrOK;
    if (this.post && this.post.w === w && this.post.h === h && this.post.want === want && this.post.hdr === hdr) return this.post;
    if (this.post) {
      const p = this.post;
      gl.deleteFramebuffer(p.msFbo); gl.deleteRenderbuffer(p.msColor); gl.deleteRenderbuffer(p.msDepth); gl.deleteFramebuffer(p.resFbo); gl.deleteTexture(p.resTex);
      for (const b of p.bloom) { gl.deleteFramebuffer(b.fbo); gl.deleteTexture(b.tex); }
    }
    const samples = Math.min(want, gl.getParameter(gl.MAX_SAMPLES));
    const p = { w, h, want, hdr };
    p.msFbo = gl.createFramebuffer(); p.msColor = gl.createRenderbuffer(); p.msDepth = gl.createRenderbuffer();
    gl.bindRenderbuffer(gl.RENDERBUFFER, p.msColor); gl.renderbufferStorageMultisample(gl.RENDERBUFFER, samples, hdr ? gl.RGBA16F : gl.RGBA8, w, h);
    gl.bindRenderbuffer(gl.RENDERBUFFER, p.msDepth); gl.renderbufferStorageMultisample(gl.RENDERBUFFER, samples, gl.DEPTH_COMPONENT24, w, h);
    gl.bindFramebuffer(gl.FRAMEBUFFER, p.msFbo);
    gl.framebufferRenderbuffer(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.RENDERBUFFER, p.msColor);
    gl.framebufferRenderbuffer(gl.FRAMEBUFFER, gl.DEPTH_ATTACHMENT, gl.RENDERBUFFER, p.msDepth);
    const target = (tw, th, float = false) => {
      const tex = this._tex(gl.LINEAR);
      if (float) gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA16F, tw, th, 0, gl.RGBA, gl.HALF_FLOAT, null);
      else gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, tw, th, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
      const fbo = gl.createFramebuffer();
      gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
      gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0);
      return { fbo, tex, w: tw, h: th };
    };
    const res = target(w, h, hdr); p.resFbo = res.fbo; p.resTex = res.tex;
    if (hdr) {
      // (a card that says it can and cannot: fall back to the 8-bit picture for good)
      let ok = gl.checkFramebufferStatus(gl.FRAMEBUFFER) === gl.FRAMEBUFFER_COMPLETE;
      gl.bindFramebuffer(gl.FRAMEBUFFER, p.msFbo); ok = ok && gl.checkFramebufferStatus(gl.FRAMEBUFFER) === gl.FRAMEBUFFER_COMPLETE;
      if (!ok) { this.hdrOK = false; this.post = p; return this._ensurePost(w, h, want); }
    }
    const bw = Math.max(2, w >> 2), bh = Math.max(2, h >> 2);
    p.bloom = [target(bw, bh), target(bw, bh)];
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    return (this.post = p);
  }

  /** Tell every shader whether the picture is being kept in light values (see shaders.js SCENE). */
  _setHDR(on) {
    if (this._hdr === (on ? 1 : 0)) return;
    this._hdr = on ? 1 : 0;
    const gl = this.gl;
    for (const pr of [this.pTerrain, this.pStruct, this.pUnit, this.pPart, this.pSky, this.pBright, this.pComp, this.pSkin[1], this.pSkin[2], this.pSkin[4]]) if (pr.u.uHDR) { gl.useProgram(pr.p); gl.uniform1f(pr.u.uHDR, this._hdr); }
  }

  _pass(prog, tex, target, setup) {
    const gl = this.gl;
    gl.bindFramebuffer(gl.FRAMEBUFFER, target ? target.fbo : null);
    gl.viewport(0, 0, target ? target.w : this.canvas.width, target ? target.h : this.canvas.height);
    gl.useProgram(prog.p);
    gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, tex); gl.uniform1i(prog.u.uTex, 0);
    if (setup) setup(prog.u);
    gl.bindVertexArray(this.vaoFull);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
  }

  // ----------------------------------------------------------------- frame
  _common(u, env) {
    const gl = this.gl;
    gl.uniformMatrix4fv(u.uVP, false, this.vp);
    if (u.uSun) gl.uniform3fv(u.uSun, SUN);
    // mood colors are authored in display space; the shaders light in linear space
    if (u.uSunCol) gl.uniform3f(u.uSunCol, env.sun[0] * env.sun[0] * SUN_GAIN, env.sun[1] * env.sun[1] * SUN_GAIN, env.sun[2] * env.sun[2] * SUN_GAIN);
    if (u.uAmb) gl.uniform3f(u.uAmb, env.amb[0] * env.amb[0] * AMB_GAIN, env.amb[1] * env.amb[1] * AMB_GAIN, env.amb[2] * env.amb[2] * AMB_GAIN);
    if (u.uEye) gl.uniform3fv(u.uEye, this.eye);
    if (u.uHaze) gl.uniform4fv(u.uHaze, this.haze);
    if (u.uWet) gl.uniform1f(u.uWet, env.wet || 0);
    if (u.uExposure) gl.uniform1f(u.uExposure, EXPOSURE);
    if (u.uTorch) {
      // the fires count for little by day and for most of the light there is at night
      const night = Math.max(0, Math.min(1, ((env.lift || 0) - 0.03) / 0.2)), fl = 0.93 + 0.07 * Math.sin((this.clock || 0) * 11) * Math.sin((this.clock || 0) * 4.3);
      gl.activeTexture(gl.TEXTURE7); gl.bindTexture(gl.TEXTURE_2D, this.torchTex); gl.uniform1i(u.uTorch, 7);
      gl.uniform4fv(u.uTorchRect, this.torchRect); gl.uniform1f(u.uTorchK, (0.1 + 0.9 * night) * fl);
    }
    if (u.uTorch2 && this.torch2Tex) { gl.activeTexture(gl.TEXTURE8); gl.bindTexture(gl.TEXTURE_2D, this.torch2Tex); gl.uniform1i(u.uTorch2, 8); gl.uniform2f(u.uTorch2Size, WORLD_W, WORLD_H); }
    if (u.uFog) gl.uniform3fv(u.uFog, env.fog);
    if (u.uWorld) gl.uniform4f(u.uWorld, WORLD_W, WORLD_H, 40, MARGIN - 8); // the ground is gone into the haze before the modeled terrain ends
    if (u.uShadowVP) { gl.uniformMatrix4fv(u.uShadowVP, false, this.shadowVP); gl.uniform1f(u.uShadowOn, env.shadows ? 1 : 0); gl.uniform1f(u.uShadowTexel, this.shadowTexel); gl.activeTexture(gl.TEXTURE2); gl.bindTexture(gl.TEXTURE_2D, this.shadowTex); gl.uniform1i(u.uShadow, 2); }
    if (u.uLPos) { gl.uniform4fv(u.uLPos, this.lpos); gl.uniform3fv(u.uLCol, this.lcol); }
    if (u.uDecal) { gl.activeTexture(gl.TEXTURE1); gl.bindTexture(gl.TEXTURE_2D, this.decalTex); gl.uniform1i(u.uDecal, 1); }
    if (u.uMatA) {
      gl.activeTexture(gl.TEXTURE4); gl.bindTexture(gl.TEXTURE_2D_ARRAY, this.mats.a); gl.uniform1i(u.uMatA, 4);
      gl.activeTexture(gl.TEXTURE5); gl.bindTexture(gl.TEXTURE_2D_ARRAY, this.mats.b); gl.uniform1i(u.uMatB, 5);
      gl.uniform1fv(u.uMatScale, this.mats.scale); gl.uniform3fv(u.uMatMean, this.mats.mean);
    }
  }

  /**
   * The ground and the fortress, depth only. What is drawn after them can then be shaded once, where it shows:
   * the terrain's costly shader never runs under a soldier, behind a wall or on the far side of a ridge.
   */
  _scenePre() {
    const gl = this.gl, p = this.pDepth;
    gl.enable(gl.DEPTH_TEST); gl.depthMask(true); gl.depthFunc(gl.LESS); gl.disable(gl.BLEND);
    gl.colorMask(false, false, false, false);
    gl.useProgram(p.p); gl.uniformMatrix4fv(p.u.uVP, false, this.vp);
    gl.bindVertexArray(this.terrain.vao); gl.drawElements(gl.TRIANGLES, this.terrain.count, gl.UNSIGNED_INT, 0);
    gl.bindVertexArray(this.struct.vaoDepth); gl.drawArrays(gl.TRIANGLES, 0, this.struct.count);
    gl.colorMask(true, true, true, true);
    this.stats.draws += 2;
  }

  /** The ground and the fortress in color. `pre`: their depths are already laid down (see _scenePre), so only what shows is shaded. */
  _scene(env, pre = false) {
    const gl = this.gl;
    gl.enable(gl.DEPTH_TEST); gl.depthMask(!pre); gl.depthFunc(pre ? gl.LEQUAL : gl.LESS); gl.disable(gl.BLEND);
    let p = this.pTerrain;
    gl.useProgram(p.p); this._common(p.u, env);
    gl.uniform4fv(p.u.uAlbRect, this.albRect); gl.uniform1f(p.u.uTime, this.clock || 0);
    gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, this.albedo); gl.uniform1i(p.u.uAlbedo, 0);
    gl.activeTexture(gl.TEXTURE3); gl.bindTexture(gl.TEXTURE_2D, this.hmTex); gl.uniform1i(p.u.uHM, 3);
    gl.bindVertexArray(this.terrain.vao);
    gl.drawElements(gl.TRIANGLES, this.terrain.count, gl.UNSIGNED_INT, 0);
    p = this.pStruct;
    gl.useProgram(p.p); this._common(p.u, env);
    if (p.u.uPatina) {
      if (!this.patinaTex) { // (until the painted layer loads: mid gray, which leaves the stone as built)
        this.patinaTex = gl.createTexture(); gl.bindTexture(gl.TEXTURE_2D, this.patinaTex);
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, 1, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array([128, 128, 128, 255]));
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
      }
      gl.activeTexture(gl.TEXTURE10); gl.bindTexture(gl.TEXTURE_2D, this.patinaTex); gl.uniform1i(p.u.uPatina, 10); gl.activeTexture(gl.TEXTURE0);
    }
    if (p.u.uRound) {
      // (each radius is nudged so that a whole number of 8 m stone tiles goes round: the pattern then meets itself at the seam)
      const K = LAYOUT.keep, lay = (r) => (Math.max(1, Math.round((2 * Math.PI * r) / 8)) * 8) / (2 * Math.PI);
      gl.uniform4fv(p.u.uRound, [K.tower.x, K.tower.y, K.tower.r + K.tower.foot + 1.5, lay(K.tower.r), K.t2.x, K.t2.y, K.t2.r + 1.5, lay(K.t2.r), K.t1.x, K.t1.y, K.t1.r + 1.5, lay(K.t1.r), K.cx, K.cy, K.r + K.half + 2.5, lay(K.r + K.half)]);
    }
    if (p.u.uBases) gl.uniform3f(p.u.uBases, LAYOUT.keep.t1.z - 11.2, LAYOUT.keep.t1.z - 0.2, LAYOUT.keep.t2.z - 0.2); // (the court is 11 m below the inner court)
    gl.bindVertexArray(this.struct.vao);
    gl.drawArrays(gl.TRIANGLES, 0, this.struct.count);
    gl.depthMask(true); gl.depthFunc(gl.LESS);
    const st = this.stats; st.tris.terrain = this.terrain.count / 3; st.tris.fort = this.struct.count / 3; st.draws += 2;
  }

  /** Which geometry a model is drawn with at a level of detail (0 full, 1 stand-in, 2 box, 3 far). */
  _geo(m, tier, shadow, props) {
    if (props) return tier === 0 ? m.full : m.mid || m.full;
    if (tier === 0) return shadow ? m.mid || m.full : m.full;
    if (tier === 1 || m.big) return m.mid || m.full;
    return m.lod || m.mid || m.full;
  }

  _drawMeshes(env, clock, tier, shadowPass, props) {
    const gl = this.gl, p = this.pUnit, st = this.stats;
    gl.useProgram(p.p); this._common(p.u, env);
    gl.uniform1f(p.u.uTime, clock); gl.uniform1f(p.u.uShadowPass, shadowPass ? 1 : 0); gl.uniform1f(p.u.uLift, env.lift);
    for (const name in this.meshes) {
      const m = this.meshes[name], a = m.anim;
      if (!(props ? m.pn : m.n)) continue;
      if (shadowPass && (name === 'mine' || name === 'cube')) continue;
      gl.uniform4f(p.u.uPivot, a[0], a[1], a[2], a[3]); gl.uniform1f(p.u.uRecoil, a[4]); gl.uniform4f(p.u.uPivot2, a[5], a[6], a[7], a[8]); gl.uniform1f(p.u.uLegX, a[9]);
      // props: one list, at the level of detail of the middle of the view. Units: a list for each level, end to end in the buffer
      for (let t = 0, base = 0; t < (props ? 1 : 3); t++) {
        const n = props ? m.pn : m.lists[t].n;
        if (!n) continue;
        const geo = this._geo(m, props ? tier : t, shadowPass, props);
        gl.uniform1f(p.u.uMatOn, geo === m.full ? 1 : 0);   // stand-ins are too small on screen for texture to show
        gl.bindVertexArray(props ? geo.pvao : geo.vao);
        if (!props) { this._instAttribs(m.ibuf, base * ISTRIDE); base += n; }
        if (geo.itype) gl.drawElementsInstanced(gl.TRIANGLES, geo.n, geo.itype, 0, n); else gl.drawArraysInstanced(gl.TRIANGLES, 0, geo.n, n);
        st.draws++; if (shadowPass) st.tris.shadows += (geo.n / 3) * n; else st.tris.units += (geo.n / 3) * n;
      }
    }
  }

  // ------------------------------------------------------------ GPU timing
  /** Start timing a named stretch of the frame on the GPU (only while the performance overlay is up). */
  _time(name) {
    const gl = this.gl, ext = this.timerExt;
    if (!ext || !this.perfOn) return;
    if (this._query) { gl.endQuery(ext.TIME_ELAPSED_EXT); this._query = null; }
    if (!name) return;
    const q = gl.createQuery();
    gl.beginQuery(ext.TIME_ELAPSED_EXT, q);
    this._query = q; this._queries.push({ name, q });
  }
  _collectTimes() {
    const gl = this.gl, ext = this.timerExt;
    if (!ext) return;
    const g = this.stats.gpu;
    // nothing in flight (the perf overlay is off): skip the query, a synchronous round trip to the GPU
    if (!this._queries.length) { if (!this.perfOn) for (const k in g) delete g[k]; return; }
    const disjoint = gl.getParameter(ext.GPU_DISJOINT_EXT);
    while (this._queries.length && this._queries[0].q !== this._query) {
      const { name, q } = this._queries[0];
      if (!gl.getQueryParameter(q, gl.QUERY_RESULT_AVAILABLE)) break;
      if (!disjoint) { const ms = gl.getQueryParameter(q, gl.QUERY_RESULT) / 1e6; g[name] = g[name] == null ? ms : g[name] * 0.9 + ms * 0.1; }
      gl.deleteQuery(q); this._queries.shift();
    }
    if (!this.perfOn && !this._queries.length) for (const k in g) delete g[k];
  }

  /** `f`: the camera's focal length in pixels. */
  _drawParticles(n, minPx, tint, f, vw, vh) {
    if (!n) return;
    this.stats.draws++; this.stats.tris.fx += n * 2;
    const gl = this.gl, p = this.pPart;
    gl.useProgram(p.p);
    gl.uniformMatrix4fv(p.u.uVP, false, this.vp);
    gl.uniform2f(p.u.uK, (2 * f) / vw, (2 * f) / vh); gl.uniform1f(p.u.uZoom, f); gl.uniform1f(p.u.uCols, COLS); gl.uniform1f(p.u.uMinPx, minPx);
    gl.uniform3fv(p.u.uTint, tint);
    gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, this.atlas); gl.uniform1i(p.u.uAtlas, 0);
    gl.bindVertexArray(this.vaoPart);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.partBuf);
    gl.bufferSubData(gl.ARRAY_BUFFER, 0, this.partF, 0, n * PF);
    gl.drawArraysInstanced(gl.TRIANGLE_STRIP, 0, 4, n);
  }

  /**
   * @param cam  {x, y, zoom, yaw, dpr}  zoom in device px per meter
   * @param env  {amb, sun, fog: [r,g,b], lift, flash, shadows}
   */
  render(cam, sim, fx, al, env, clock) {
    const gl = this.gl, vw = this.canvas.width, vh = this.canvas.height, st = this.stats, t0 = performance.now();
    this.clock = clock;
    st.draws = 0; st.tris.units = st.tris.shadows = st.tris.fx = 0;
    this._collectTimes();
    if (sim && sim.structVersion !== this.structVersion) { this.structVersion = sim.structVersion; this._updateStructures(sim); }
    if (sim && (sim !== this.propSim || sim.propVersion !== this.propVersion)) { this.propSim = sim; this.propVersion = sim.propVersion; this._updateProps(sim); }
    if (fx) this._flushDecals(fx);
    const cs = camState(cam, vw, vh);
    this._dpr = cam.dpr || 1;
    viewProj(cam, vw, vh, this.vp);
    this.eye[0] = cs.ex; this.eye[1] = cs.ey; this.eye[2] = cs.ez; this.camF = cs.f;
    // the air: clear out to a little beyond the point of interest, then thickening toward the horizon
    this.haze[0] = Math.max(140, cs.dist * 1.25); this.haze[1] = 1 / (700 + cs.dist * 0.6); this.haze[2] = 0.94; this.haze[3] = 420;
    // at night the mist lies in the valley floor: thicker, nearer, and thinning quickly with height, so the walls and the
    // rock stand up out of it
    { const night = Math.max(0, Math.min(1, ((env.lift || 0) - 0.03) / 0.2)); this.haze[0] *= 1 - 0.45 * night; this.haze[1] *= 1 + 1.3 * night; this.haze[3] = 420 - 330 * night; }

    // brightest few flashes become real lights
    this.lpos.fill(0); this.lcol.fill(0);
    if (fx) {
      const ls = fx.lights; let k = 0;
      for (let i = ls.length - 1; i >= 0 && k < 6; i--) {
        const l = ls[i], f = Math.max(0, l.life / l.max);
        this.lpos[k * 4] = l.x; this.lpos[k * 4 + 1] = l.y; this.lpos[k * 4 + 2] = l.z; this.lpos[k * 4 + 3] = l.rad;
        this.lcol[k * 3] = l.r * l.r * f; this.lcol[k * 3 + 1] = l.g * l.g * f; this.lcol[k * 3 + 2] = l.b * l.b * f; k++;
      }
    }

    const q = this.quality;
    const post = q === 'low' ? null : this._ensurePost(vw, vh, q === 'high' ? 4 : 2);
    this._setHDR(!!(post && post.hdr));
    gl.bindFramebuffer(gl.FRAMEBUFFER, post ? post.msFbo : null);
    gl.viewport(0, 0, vw, vh);
    gl.depthMask(true);
    gl.clearColor(env.fog[0], env.fog[1], env.fog[2], 1); gl.clearDepth(1);
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
    const zc = cam.zoom / (cam.dpr || 1);
    this._time('depth');
    {
      // the sky, behind everything
      const p = this.pSky, th = Math.tan(FOV / 2);
      gl.disable(gl.DEPTH_TEST); gl.depthMask(false); gl.disable(gl.BLEND);
      gl.useProgram(p.p);
      gl.uniform3f(p.u.uCamR, cs.rx, cs.ry, 0); gl.uniform3f(p.u.uCamU, cs.ux, cs.uy, cs.uz); gl.uniform3f(p.u.uCamF, cs.fx, cs.fy, cs.fz);
      gl.uniform2f(p.u.uTan, (th * vw) / vh, th); gl.uniform3fv(p.u.uFog, env.fog); gl.uniform1f(p.u.uTime, clock || 0);
      gl.uniform3f(p.u.uZenith, env.amb[0] * 0.38 + env.fog[0] * 0.3, env.amb[1] * 0.38 + env.fog[1] * 0.3, env.amb[2] * 0.38 + env.fog[2] * 0.3);
      gl.bindVertexArray(this.vaoFull);
      gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
      gl.enable(gl.DEPTH_TEST); gl.depthMask(true);
      st.draws++;
    }
    this._scenePre();

    let dots = 0;
    this._time('units');
    if (sim) {
      for (const name in this.meshes) this.meshes[name].n = 0;
      const L = this.lod(q);
      // the level of detail at the middle of the view (props are drawn at it; each unit takes its own from its distance)
      const tier = zc < L.dot ? 3 : zc < L.box ? 2 : zc < L.hero ? 1 : 0;
      st.tier = tier;
      for (const name in this.meshes) { const ls = this.meshes[name].lists; ls[0].n = ls[1].n = ls[2].n = 0; }
      for (const name in this.assets) { const a = this.assets[name], ls = a.lists; a.n = ls[0].n = ls[1].n = ls[2].n = ls[3].n = 0; }
      // how much battle time has passed since the last frame (none while paused, eightfold at 8x): strides advance by it
      { const t = sim.time + (al - 1) * 0.1, dt = t - this._simT; this._simT = t; this.animDt = dt > 0 && dt < 1 ? dt : 0; this._cs = cs; this._L = L; }
      dots = this._fillUnits(cam, cs, sim, al, vw, vh, L, clock, env.lift > 0.12);
      this._tier = 0;
      this._fillDynamic(sim, fx, al, clock);
      for (const m of [...Object.values(this.meshes), ...Object.values(this.assets)]) {
        if (!m.n) continue;
        gl.bindBuffer(gl.ARRAY_BUFFER, m.ibuf);
        if (m.n > m.gcap) m.gcap = Math.max(64, m.n * 2);
        gl.bufferData(gl.ARRAY_BUFFER, m.gcap * ISTRIDE, gl.DYNAMIC_DRAW); // (a fresh store each frame: the driver need not wait on the last one)
        let base = 0;
        for (const ls of m.lists) if (ls.n) { gl.bufferSubData(gl.ARRAY_BUFFER, base * ISTRIDE, ls.u8, 0, ls.n * ISTRIDE); base += ls.n; }
      }
      // solid things first, then the ground and fortress where they still show, then the shadows that lie on them
      gl.disable(gl.BLEND);
      this._drawMeshes(env, clock, tier, false, true);
      this._drawMeshes(env, clock, tier, false, false);
      this._drawSkinned(env, false);
      this._time('scene');
      this._bakeHordeTorches();
      this._scene(env, true);
      this._time('shadows');
      if (env.shadows) {
        gl.enable(gl.BLEND); gl.depthMask(false);
        this._drawMeshes(env, clock, tier, true, false);
        this._drawSkinned(env, true);
        gl.depthMask(true); gl.disable(gl.BLEND);
      }
      // hold the triangle budget: if this view spent too much on units, bring every level of detail in closer next frame
      const spent = st.tris.units + st.tris.shadows;
      if (spent > UNIT_TRI_BUDGET) this.lodBias = Math.min(12, this.lodBias * Math.max(1.06, Math.sqrt(spent / UNIT_TRI_BUDGET)));
      else if (spent < UNIT_TRI_BUDGET * 0.6 && this.lodBias > 1) this.lodBias = Math.max(1, this.lodBias / 1.03);
    } else { this._time('scene'); this._scene(env, true); }
    this._time('effects');
    gl.enable(gl.BLEND); gl.depthMask(false);
    if (dots) this._drawParticles(dots, 2.6, [1, 1, 1], cs.f, vw, vh);
    if (fx) {
      const n = fx.fill(this.partF, this.partU, this.partMax, sim);
      st.parts = n;
      this._drawParticles(n, 1.6, [env.amb[0] * 0.6 + 0.4, env.amb[1] * 0.6 + 0.4, env.amb[2] * 0.6 + 0.4], cs.f, vw, vh);
    }
    gl.depthMask(true); gl.disable(gl.BLEND);

    this._time('post');
    if (post) {
      gl.bindFramebuffer(gl.READ_FRAMEBUFFER, post.msFbo); gl.bindFramebuffer(gl.DRAW_FRAMEBUFFER, post.resFbo);
      gl.blitFramebuffer(0, 0, vw, vh, 0, 0, vw, vh, gl.COLOR_BUFFER_BIT, gl.NEAREST);
      gl.disable(gl.DEPTH_TEST);
      const [a, b] = post.bloom;
      this._pass(this.pBright, post.resTex, a);
      this._pass(this.pBlur, a.tex, b, (u) => gl.uniform2f(u.uDir, 1 / a.w, 0));
      this._pass(this.pBlur, b.tex, a, (u) => gl.uniform2f(u.uDir, 0, 1 / a.h));
      this._pass(this.pBlur, a.tex, b, (u) => gl.uniform2f(u.uDir, 2 / a.w, 0));
      this._pass(this.pBlur, b.tex, a, (u) => gl.uniform2f(u.uDir, 0, 2 / a.h));
      this._pass(this.pComp, post.resTex, null, (u) => { gl.activeTexture(gl.TEXTURE1); gl.bindTexture(gl.TEXTURE_2D, a.tex); gl.uniform1i(u.uBloom, 1); gl.uniform1f(u.uBloomK, 0.85); gl.uniform1f(u.uFlash, env.flash || 0); });
      gl.enable(gl.DEPTH_TEST);
      st.draws += 6;
    }
    this._time(null);
    st.cpu = st.cpu * 0.9 + (performance.now() - t0) * 0.1;
  }

  /** Queue every visible unit. Returns the number of far-view dots written to the particle buffer. */
  _fillUnits(cam, cs, sim, al, vw, vh, L, clock, torches) {
    const { alive, x, y, px, py, rot, trot, type, team, hitT, fireT, el, state, ammo, vx, vy, aux, bx, by, target2, isLashed } = sim;
    const grp = sim.grp, gShield = sim.gShield, crewOf = sim.crewOf, poseOf = sim.pose, ladderBare = this.meshes.ladderBare, ramBare = this.meshes.ramBare;
    const { ex, ey, ez, rx, ry, ux, uy, uz, fx: fwx, fy: fwy, fz: fwz, f: focal, near } = cs;
    const hw = vw / 2, hh = vh / 2, dprI = 1 / (cam.dpr || 1);
    // each unit's level of detail comes from its scale on screen (CSS px per meter where it stands)
    const bias = this.lodBias, zDot = L.dot * bias, zBox = L.box * bias, zHero = L.hero * bias, zClose = Math.max(L.hero * 3.2, 30) * bias; // zClose: from here in, a soldier stands some sixty pixels tall and earns the finest model
    const gz = this.map.gz, mseg = sim.mseg, segTop = sim.segTop, time = sim.time, um = this.unitMesh;
    const PFv = this.partF, PU = this.partU;
    let dots = 0, drawn = 0;
    this._nHT = 0;
    // the side tint: none from WASH_FROM px per meter in, full by WASH_FULL, the same for every unit in view
    // Dots or figures is likewise one choice for the whole view, by the zoom: taken unit by unit, a tilted view drew the far
    // half of a block as a red carpet of dots and the near half as men. (Under load the bias moves the change closer in.)
    const dotsNow = cam.zoom * dprI < zDot * 1.3;
    let W = (WASH_FROM - cam.zoom * dprI) / (WASH_FROM - WASH_FULL); W = W < 0 ? 0 : W > 1 ? 1 : W; W = W * W * (3 - 2 * W);
    for (let i = 0, n = sim.n; i < n; i++) {
      if (!alive[i]) continue;
      let xi = px[i] + (x[i] - px[i]) * al, yi = py[i] + (y[i] - py[i]) * al, zi;
      const st = state[i];
      if (st === S_CLIMB) {
        const L = target2[i], tower = L >= 0 && type[L] === U.tower;
        if (tower) continue; // inside the tower
        // as Sim.unitZ: from the ground at the foot to the walk of the wall the ladder leans on, over the climb's own time
        const u = Math.min(1, (time - aux[i]) / sim._climbTime(L)), zf = gz[((by[i] / HM_RES) | 0) * GZ_W + ((bx[i] / HM_RES) | 0)];
        const hd = L >= 0 && alive[L] && isLashed[L] ? this._lashedHead(sim, L) : null;
        // up a lashed ladder: along the timber as it is drawn (the simulation moves him straight to the walk behind the parapet)
        if (hd) { xi = bx[i] + (hd[0] - bx[i]) * u; yi = by[i] + (hd[1] - by[i]) * u; zi = zf + (hd[2] - zf) * u; }
        else { const k = L >= 0 && alive[L] ? sim.aux2[L] : -1; zi = zf * (1 - u) + segTop[k >= 0 ? k : 0] * u; }
      } else if (el[i]) { const sg = mseg[((yi / 4) | 0) * (WORLD_W / 4) + ((xi / 4) | 0)]; zi = sg >= 0 ? segTop[sg] : gz[((yi / HM_RES) | 0) * GZ_W + ((xi / HM_RES) | 0)]; }
      else zi = gz[((yi / HM_RES) | 0) * GZ_W + ((xi / HM_RES) | 0)];
      const dx = xi - ex, dy = yi - ey, dz = zi - ez, w = dx * fwx + dy * fwy + dz * fwz;
      if (w < near) continue;
      // off screen, with room for the tallest and widest thing drawn (a siege tower, a ladder laid flat)
      const z0 = focal / w, sx = (dx * rx + dy * ry) * z0, sy = (dx * ux + dy * uy + dz * uz) * z0, pad = (st === S_DONE && isLashed[i] ? 26 : 14) * z0 + 8; // (a lashed ladder's head stands 26 m from its foot)
      if (sx < -hw - pad || sx > hw + pad || sy < -hh - pad || sy > hh + pad) continue;
      const zc = z0 * dprI, tier = zc < zDot ? 3 : zc < zBox ? 2 : zc < zHero ? 1 : 0;
      this._tier = tier === 3 ? 2 : tier;
      const d = UNITS[type[i]], um_i = um[type[i]];
      const h = (Math.imul(i, 2654435761) >>> 24);
      const fl = time - hitT[i];
      const flash = fl < 0.12 ? ((1 - fl / 0.12) * (d.hp > 300 ? 70 : 220)) | 0 : 0;
      drawn++;
      if (torches && team[i] !== DEF && d.sz === 0 && (h & 15) === 3 && dots < 9000) {
        // one in sixteen carries a torch: a flickering flame and a pool of light on the ground
        const fk = 0.8 + 0.2 * Math.sin(clock * 15 + i * 1.7) * Math.sin(clock * 6.3 + i);
        if (this._nHT < 2000) { const q = this._nHT++ * 3; this._HT[q] = xi; this._HT[q + 1] = yi; this._HT[q + 2] = zi + 2.2; } // (and lights whatever is round him: see _bakeHordeTorches)
        let o = dots++ * PF;
        PFv[o] = xi; PFv[o + 1] = yi; PFv[o + 2] = zi + (st === S_CLIMB ? 1.5 : 2.5); PFv[o + 3] = PFv[o + 4] = Math.max(1.7, 7.5 / z0) * fk; PFv[o + 5] = 0; PFv[o + 6] = SPR.glow;
        PU[o + 7] = ((235 << 24) | (70 << 16) | (165 << 8) | 255) >>> 0;
        PFv[o + 8] = 1; PFv[o + 9] = 0; PFv[o + 10] = 0; PFv[o + 11] = 0; PFv[o + 12] = 0;
        if (el[i] === 0 && st !== S_CLIMB) {
          o = dots++ * PF;
          PFv[o] = xi; PFv[o + 1] = yi; PFv[o + 2] = zi + 0.25; PFv[o + 3] = PFv[o + 4] = 13 * fk; PFv[o + 5] = 0; PFv[o + 6] = SPR.glow;
          PU[o + 7] = ((46 << 24) | (60 << 16) | (140 << 8) | 255) >>> 0;
          PFv[o + 8] = 1; PFv[o + 9] = 2; PFv[o + 10] = 0; PFv[o + 11] = 0; PFv[o + 12] = 0;
        }
      }
      if (dotsNow && d.size < 7) {
        // far view: a colored dot. cyan = armed defender, amber = out of ammunition, red = attacker
        if (dots >= this.partMax) continue; // (the particle buffer is full: a horde this size is a carpet of dots already)
        const o = dots * PF;
        PFv[o] = xi; PFv[o + 1] = yi; PFv[o + 2] = zi + 1; PFv[o + 3] = d.size * 0.42; PFv[o + 4] = d.size * 0.42; PFv[o + 5] = 0; PFv[o + 6] = SPR.dot;
        let r, g, b;
        if (team[i] === DEF) { if (d.ammo && ammo[i] < 1) { r = 255; g = 168; b = 60; } else { r = 110; g = 210; b = 255; } }
        else if (gShield[grp[i]] && crewOf[i] < 0) { r = 214 + (h % 24); g = 216 + (h % 20); b = 226; } // behind locked shields: a steel-pale dot, neither side's color
        else { r = 150 + (h % 80); g = 42 + (h % 24); b = 30; }
        if (flash) { r = 255; g = 255; b = 255; }
        PU[o + 7] = ((255 << 24) | (b << 16) | (g << 8) | r) >>> 0;
        PFv[o + 8] = 0; PFv[o + 9] = 0; PFv[o + 10] = 0; PFv[o + 11] = 0; PFv[o + 12] = 0;
        dots++;
        continue;
      }
      const vs = um_i.variants, h2 = Math.imul(i, 2246822519) >>> 20;
      let m = d.role === R.LADDER && st === S_DONE ? this.meshes.ladderUp : vs.length > 1 ? vs[h2 % vs.length] : vs[0];
      // with crewed engines the carriers are soldiers of their own: draw the timber alone
      if (d.crew) { if (d.role === R.LADDER && st !== S_DONE) m = ladderBare || m; else if (d.role === R.RAM) m = ramBare || m; }
      // locked shields: the rank leans in behind them, and catches the light
      const sh = team[i] !== DEF && gShield[grp[i]] && crewOf[i] < 0 && d.sz === 0 ? 1 : 0;
      // no two soldiers stand quite the same height or wear quite the same shade
      const sc = um_i.jitter ? um_i.scale * (0.95 + ((h2 >> 4) & 31) * 0.0034) : um_i.scale;
      const v = 200 + (h % 56);
      if (st === S_DONE && isLashed[i]) {
        // two ladders lashed end to end, from the foot on the valley floor to the ring's parapet: the one model, laid flat,
        // pitched up by the tilt byte (a turn in 255ths) and stretched so that its head reaches the parapet's height
        // whatever the tilt rounds to (the head then lands within 0.3 m of the face, under its hooks)
        const hd = this._lashedHead(sim, i);
        if (hd) {
          const run = Math.hypot(hd[0] - xi, hd[1] - yi), rise = hd[2] - zi, tb = Math.round((Math.atan2(rise, run) / 6.2832) * 255);
          this._put(this.meshes.ladderLashed, xi, yi, zi, Math.atan2(hd[1] - yi, hd[0] - xi), rise / Math.sin((tb / 255) * 6.2832) / LASHED_LEN, 0, v, v, v, flash, 0, 0, tb);
          continue;
        }
      }
      const sp = Math.sqrt(vx[i] * vx[i] + vy[i] * vy[i]);
      const walk = st === S_CLIMB ? 200 : sp > 0.3 ? Math.min(255, sp * 80) | 0 : 0;
      const yaw = rot[i];
      const phase = st === S_CLIMB ? time * 9 + i : (xi * Math.cos(yaw) + yi * Math.sin(yaw)) * 2.3 + i;
      let atk = 0;
      if (d.role === R.TOWER) atk = st === S_DONE ? 255 : 0;
      else { const ft = time - fireT[i], dur = d.team === DEF ? 0.16 : d.role === R.CATAPULT ? 1.2 : d.role === R.RAM ? 0.7 : 0.38; if (ft < dur) atk = ((1 - ft / dur) * 255) | 0; }
      const A = this.unitAsset[type[i]];
      if (A) {
        // a model from files: pick the clip that fits what he is doing, and the frame of it he has reached
        const C = A.clip, ft = time - fireT[i];
        let cl, fr;
        if (C.up) { cl = st === S_DONE ? C.up : C.idle; fr = 0; } // (a scaling ladder: carried, or stood against the wall)
        else if (C.turret) {
          // a machine: its one clip is the turret's full turn, and the frame is the angle between the gun and the hull
          cl = C.turret; let a = (trot[i] - yaw) / 6.283185307; a -= Math.floor(a); fr = Math.min(cl.frames - 1, a * cl.frames);
        } else if (st === S_CLIMB) { cl = C.climb || C.walk; fr = (time * cl.fps * 1.4 + i * 7) % cl.frames; }
        else if (C.attack && ft < 0.9 && sp < 1.5) { cl = C.attack; fr = Math.min(cl.frames - 1, (ft / 0.9) * cl.frames); }
        else if (sp > 0.3 && C.walk) { // (an engine has no stride: it rolls as it stands)
          const eng = crewOf[i] >= 0 ? UNITS[type[crewOf[i]]] : null;
          cl = (eng ? (eng.role === R.LADDER ? C.carry : C.push) : sh ? C.shield : sp > 2.6 ? C.run : C.walk) || C.walk;
          // his stride keeps time with the ground he covers, within what the clip can bear without looking wound up or drugged
          const nat = cl.fps / cl.frames, rate = Math.max(nat * 0.6, Math.min(nat * 1.9, cl.stride > 0.2 ? sp / cl.stride : nat));
          let ph = this.animPhase[i] + this.animDt * rate; ph -= Math.floor(ph); this.animPhase[i] = ph;
          fr = ph * cl.frames;
        } else {
          // standing his ground: a defender in the stance his post gives him (at the parapet kneeling, in the open prone), weapon up
          const ps = team[i] === DEF ? poseOf[i] : 0;
          cl = (ps === 2 ? C.prone : ps === 1 ? C.kneel : null) || (team[i] === DEF && C.aim) || C.idle || C.walk;
          fr = cl.frames > 1 ? (time * cl.fps + i * 13) % cl.frames : 0; // (a stance is one held frame: nobody shuffles on the spot)
        }
        // (for looking a clip over: renderer.debugClip = { name, at: 0..1 } poses every such unit in it)
        if (this.debugClip && C[this.debugClip.name]) { cl = C[this.debugClip.name]; fr = Math.min(cl.frames - 1, this.debugClip.at * cl.frames); }
        const js = um_i.jitter ? 0.95 + ((h2 >> 4) & 31) * 0.0034 : 1;
        // four levels of detail: the finest only where a soldier stands tall on screen, the coarsest where the built-in models are boxes
        // (a machine several times a man's size earns each level from that much further off)
        if (A.big > 1) { const zb = zc * A.big; this._tier = zb >= zClose ? 0 : zb >= zHero ? 1 : zb >= zBox ? 2 : 3; }
        else this._tier = zc >= zClose ? 0 : tier === 0 ? 1 : tier === 1 ? 2 : 3;
        // seen from far off, the two armies are tinted by side so they still read at a glance. How far is one figure for the whole
        // map, set by the zoom alone (W): never by how near the camera a soldier happens to stand, which painted a block half and half
        // (the last argument is the wash: how far the figure is taken from its own colors toward its side's)
        if (A.big > 1) { this._put(A, xi, yi, zi, yaw, js, cl.start + fr, v, v, v, flash, 0, 0, 0); continue; } // (a machine is told by its size)
        let r = v, g = v - (h2 & 7), b = v - ((h2 >> 9) & 15), wm = 0;
        if (sh) { r = 255; g = 244; b = 226; } // (behind locked shields a rank catches the light)
        if (W > 0) {
          let sr, sg, sb;
          if (team[i] === DEF) { if (d.ammo && ammo[i] < 1) { sr = 255; sg = 178; sb = 70; } else { sr = 120; sg = 205; sb = 245; } wm = 190 * W; }
          else if (sh) { sr = 236; sg = 236; sb = 244; wm = 170 * W; }
          else { sr = 215; sg = 84; sb = 62; wm = 170 * W; }
          r += (sr - r) * W; g += (sg - g) * W; b += (sb - b) * W;
        }
        this._put(A, xi, yi, zi, yaw, js, cl.start + fr, r, g, b, flash, 0, 0, 0, wm);
        continue;
      }
      // the built-in stand-ins take the same tint, by the same zoom
      let r = v, g = v - (h2 & 7), b = v - ((h2 >> 9) & 15);
      if (sh) { r = 255; g = 236; b = 205; }
      if (W > 0 && d.size < 7) {
        const df = team[i] === DEF, sr = df ? 120 : sh ? 226 : v, sg = df ? 200 : sh ? 228 : 92, sb = df ? 235 : sh ? 238 : 74;
        r += (sr - r) * W; g += (sg - g) * W; b += (sb - b) * W;
      }
      if (sh) this._put(m, xi, yi, zi, yaw, sc * 0.94, phase, r, g, b, flash, walk, 0, 5);
      else this._put(m, xi, yi, zi, yaw, sc, phase, r, g, b, flash, walk, atk, 0, team[i] === DEF && !walk ? poseOf[i] : 0);
      if (um_i.turret) this._put(um_i.turret, xi, yi, zi, trot[i], um_i.scale, 0, v, v, v, flash, 0, atk, 0);
    }
    this.stats.units = drawn; this.stats.dots = dots;
    return dots;
  }

  /** Where lashed ladder L rests on the parapet of the stretch of the ring it leans on: [x, y, z] (scratch), or null. */
  _lashedHead(sim, L) {
    const k = sim.aux2[L], s = k >= 0 ? sim.segs[k] : null;
    if (!s) return null;
    const h = this._lh || (this._lh = new Float64Array(3)), d = s.half + LASH_OUT;
    h[0] = s.x + s.nx * d; h[1] = s.y + s.ny * d; h[2] = s.top + LASH_UP;
    return h;
  }

  /** Ordnance in flight, aircraft, parachutes, flying debris, wrecks. */
  _fillDynamic(sim, fx, al, clock) {
    const M = this.meshes;
    const tiltOf = (a) => { let t = a / 6.2832; t -= Math.floor(t); return (t * 255) | 0; };
    for (const p of sim.projectiles) {
      const x = p.px + (p.x - p.px) * al, y = p.py + (p.y - p.py) * al, z = p.pz + (p.z - p.pz) * al;
      const pitch = Math.atan2(p.z - p.pz, Math.hypot(p.x - p.px, p.y - p.py) + 1e-4);
      const m = p.vis === 1 ? M.rocket : p.vis === 3 ? M.rockm : p.vis === 4 ? M.bombm : p.vis === 6 ? M.round : M.shell;
      this._put(m, x, y, z, p.rot, p.vis === 5 ? 0.9 : p.vis === 2 ? 1.5 : p.vis === 6 ? 1 : 1.8, 0, 255, 255, 255, 0, 0, 0, p.vis === 3 ? tiltOf(clock * 4) : tiltOf(pitch));
    }
    for (const d of sim.drops) {
      const u = Math.min(1, (d.t + al * 0.1) / d.T), g = this.map.groundZ(d.x, d.y);
      this._put(M.chute, d.x + (1 - u) * 14, d.y, g + (1 - u) * 95, 0.4, 1, 0, 255, 255, 255, 0, 0, 0, 0);
    }
    for (const a of sim.aircraft) {
      const x = a.px + (a.x - a.px) * al, y = a.py + (a.y - a.py) * al, z = a.z == null ? 100 : (a.pz ?? a.z) + (a.z - (a.pz ?? a.z)) * al;
      const A = this.assets[a.kind];
      if (A) {
        // a model from files: the level of detail its size on screen earns, and for a helicopter the rotor's turn (its one clip)
        const cs = this._cs, L = this._L, bias = this.lodBias, w = (x - cs.ex) * cs.fx + (y - cs.ey) * cs.fy + (z - cs.ez) * cs.fz;
        if (w < cs.near) continue;
        const zb = (cs.f / w / (this._dpr || 1)) * A.big;
        this._tier = zb >= Math.max(L.hero * 3.2, 30) * bias ? 0 : zb >= L.hero * bias ? 1 : zb >= L.box * bias ? 2 : 3;
        const spin = A.clip.turret, fr = spin ? spin.start + (((clock * 3.1 + x * 0.01) % 1) * spin.frames) : A.clip.idle.start;
        this._put(A, x, y, a.kind === 'helo' ? z + Math.sin(clock * 1.3 + x) * 1.5 : z, a.rot, 1, fr, 235, 235, 235, 0, 0, 0, 0);
        this._tier = 0;
        continue;
      }
      if (a.kind === 'jet') this._put(M.jet, x, y, z, a.rot, 1.7, 0, 235, 235, 235, 0, 0, 0, 0);
      else if (a.kind === 'cargo') this._put(M.cargo, x, y, z, a.rot, 1, 0, 235, 235, 235, 0, 0, 0, 0);
      else if (a.kind === 'helo') this._put(M.helo, x, y, z + Math.sin(clock * 1.3 + x) * 1.5, a.rot, 1.25, 0, 235, 235, 235, 0, 0, 0, 0);
      else this._put(M.transport, x, y, z, a.rot, 1.2, 0, 235, 235, 235, 0, 0, 0, 0);
    }
    if (!fx) return;
    // the fallen: each plays his death once and lies where he ends it (drawn only where near enough to be more than a mark)
    if (fx.fallen.length) {
      const cs = this._cs, L = this._L, bias = this.lodBias, hw = this.canvas.width / 2, hh = this.canvas.height / 2, t = this._simT + 0.1;
      for (const c of fx.fallen) {
        const A = this.unitAsset[c.type], die = A && A.clip.die;
        if (!die) continue;
        const dx = c.x - cs.ex, dy = c.y - cs.ey, dz = c.z - cs.ez, w = dx * cs.fx + dy * cs.fy + dz * cs.fz;
        if (w < cs.near) continue;
        const z0 = cs.f / w, sx = (dx * cs.rx + dy * cs.ry) * z0, sy = (dx * cs.ux + dy * cs.uy + dz * cs.uz) * z0, pad = 4 * z0 + 8;
        if (sx < -hw - pad || sx > hw + pad || sy < -hh - pad || sy > hh + pad) continue;
        const zc = z0 / (this._dpr || 1);
        if (zc < L.box * bias) continue;
        this._tier = zc < L.hero * bias ? 2 : zc < Math.max(L.hero * 3.2, 30) * bias ? 1 : 0;
        this._put(A, c.x, c.y, c.z, c.rot, c.s, die.start + Math.min(die.frames - 1, Math.max(0, (t - c.t) * die.fps * 1.5)), c.v, c.v, c.v, 0, 0, 0, 0);
      }
      this._tier = 0;
    }
    for (const ch of fx.chunks) {
      const m = M[ch.mesh];
      if (m) this._put(m, ch.x, ch.y, ch.z, ch.yaw, ch.scale, 0, ch.r, ch.g, ch.b, 0, 0, 0, tiltOf(ch.tilt));
    }
  }

  /** Small top-down RGBA snapshot of terrain and fortress for the minimap. */
  terrainThumb(w, h, sim) {
    this._setHDR(false); // (a plain 8-bit snapshot)
    const gl = this.gl;
    if (sim && sim.structVersion !== this.structVersion) { this.structVersion = sim.structVersion; this._updateStructures(sim); }
    const tex = this._tex(gl.LINEAR);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, w, h, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
    const depth = gl.createRenderbuffer();
    gl.bindRenderbuffer(gl.RENDERBUFFER, depth); gl.renderbufferStorage(gl.RENDERBUFFER, gl.DEPTH_COMPONENT24, w, h);
    const fbo = gl.createFramebuffer();
    gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0);
    gl.framebufferRenderbuffer(gl.FRAMEBUFFER, gl.DEPTH_ATTACHMENT, gl.RENDERBUFFER, depth);
    gl.viewport(0, 0, w, h);
    gl.clearColor(0, 0, 0, 1); gl.clearDepth(1); gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
    // straight down, north up; flipped vertically so row 0 of the read-back is the north edge
    orthoMatrix({ x: WORLD_W / 2, y: WORLD_H / 2, zoom: w / WORLD_W, yaw: 0 }, w, h, 1, 0, this.vp);
    this.vp[1] = -this.vp[1]; this.vp[5] = -this.vp[5]; this.vp[9] = -this.vp[9]; this.vp[13] = -this.vp[13];
    this.lpos.fill(0); this.lcol.fill(0);
    this.eye[0] = WORLD_W / 2; this.eye[1] = WORLD_H / 2; this.eye[2] = 1e5; this.haze.fill(0); this.haze[3] = 1; // seen from straight above, through clear air
    this._scene({ amb: [0.75, 0.75, 0.75], sun: [0.5, 0.5, 0.48], fog: [0.1, 0.1, 0.1], shadows: true, lift: 0, wet: 0 });
    const px = new Uint8Array(w * h * 4);
    gl.readPixels(0, 0, w, h, gl.RGBA, gl.UNSIGNED_BYTE, px);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.deleteFramebuffer(fbo); gl.deleteTexture(tex); gl.deleteRenderbuffer(depth);
    return px;
  }
}
