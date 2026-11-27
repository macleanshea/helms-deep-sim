// WebGL2 renderer: a pitched orthographic ("isometric") 3D view.
//  - terrain: a height-field mesh textured from a baked procedural albedo
//  - fortress: one static mesh, rebuilt when a section is breached, casting a shadow map
//  - units, vehicles, props, ordnance: instanced meshes with shader animation, drawn at one of
//    four levels of detail chosen from the zoom (dots, boxes, blocky stand-ins, full models)
//  - surfaces are textured from two generated material arrays (see materials.js)
//  - particles: billboards / streaks / ground quads, depth-tested against the scene
//  - corpses, craters and scorch marks are stamped into a persistent decal texture
//  - optional post-processing: MSAA resolve, bloom, vignette

import { WORLD_W, WORLD_H, UNITS, DEF, U, R } from '../config.js';
import { HM_W, HM_H, MARGIN, GZ_W, HM_RES } from '../map.js';
import { COLS, SPR } from './atlas.js';
import { buildModels } from './models/index.js';
import { buildMaterials } from './materials.js';
import { buildStructures } from './structures.js';
import { viewMatrix, SIN_P, COS_P } from './camera.js';
import { S_DONE, S_CLIMB, LADDER_TIME } from '../sim/sim.js';
import * as SH from './shaders.js';
import { LAYOUT } from '../layout.js';

const PSTRIDE = 52, PF = 13;         // particle instance: bytes / floats
const ISTRIDE = 32;                  // mesh instance bytes
const GRID = 4;                      // terrain mesh spacing (m)
const SUN = (() => { const v = [-0.5, 0.4, 0.77], l = Math.hypot(...v); return v.map((q) => q / l); })();
// region covered by the shadow map: the fortress and its approaches
const SB = { x0: LAYOUT.shadowBox[0], x1: LAYOUT.shadowBox[2], y0: LAYOUT.shadowBox[1], y1: LAYOUT.shadowBox[3], z0: -8, z1: 120 };

// Levels of detail by zoom (CSS px per metre): dots, boxes, stand-ins, full models. The player's
// model-detail setting (`heroScale`) moves the whole ladder: full models take over at HERO_ZOOM x
// heroScale (0.5 = twice as far out); dots move out more gently, with the square root of it, so the
// whole valley stays cheap to draw; and boxes give way to stand-ins at the geometric midpoint, so
// boxes and stand-ins each cover the same span of zoom at every setting.
const DOT_ZOOM = 2.0;
const HERO_ZOOM = { high: 11, medium: 14, low: 18 };
export const HERO_SCALE_DEFAULT = 0.3;
// how linear light is scaled from the display-space mood colours in main.js
const SUN_GAIN = 1.3, AMB_GAIN = 1.1, EXPOSURE = 1.05;

// simulation unit type -> model names (one is picked per unit, for variety), drawing scale, and
// whether individuals vary a little in height
const MESH_OF = { rifle: [['rifle'], 1.3, 1], mg: [['mg'], 1.3, 1], marksman: [['marksman'], 1.3, 1], grenadier: [['grenadier'], 1.3, 1], at: [['at'], 1.3, 1], cmd: [['cmd'], 1.4, 0], mortar: [['mortar'], 1.3, 0], howitzer: [['howitzer'], 1.15, 0],
  ifv: [['ifv'], 1, 0], tank: [['tank'], 1, 0], cache: [['cache'], 1, 0], crate: [['crate'], 1, 0], uruk: [['uruk', 'urukB', 'urukC'], 1.3, 1], archer: [['archer', 'archerB'], 1.3, 1], berserker: [['berserker', 'berserkerB'], 1.4, 1], sapper: [['sapper'], 1.35, 0], chief: [['chief'], 1.6, 0],
  warg: [['warg'], 1.35, 1], troll: [['troll'], 1.25, 1], ladder: [['ladder'], 1, 0], ram: [['ram'], 1.15, 0], catapult: [['catapult'], 1.15, 0], tower: [['tower'], 1, 0] };
const PROP_MESH = { wire: 'wire', av: 'hedgehog', mine: 'mine', claymore: 'claymore' };

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
    gl.getExtension('EXT_color_buffer_float');
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
      // a variant that has not been modelled falls back to the first
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
    this.perfOn = false; this._queries = []; this._query = null; this.view = new Float32Array(3);
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

  _instAttribs(buf) {
    const gl = this.gl;
    gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    const at = [[4, 4, gl.FLOAT, false, 0], [5, 2, gl.FLOAT, false, 16], [6, 4, gl.UNSIGNED_BYTE, true, 24], [7, 4, gl.UNSIGNED_BYTE, true, 28]];
    for (const [loc, n, type, norm, off] of at) { gl.enableVertexAttribArray(loc); gl.vertexAttribPointer(loc, n, type, norm, ISTRIDE, off); gl.vertexAttribDivisor(loc, 1); }
  }

  /** GPU buffers for a model: one instance list shared by its levels of detail (plus one for static props). */
  _initModel(m) {
    const gl = this.gl;
    m.cap = 256; m.n = 0;
    m.idata = new ArrayBuffer(m.cap * ISTRIDE); m.f = new Float32Array(m.idata); m.u8 = new Uint8Array(m.idata);
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

  _put(m, x, y, z, yaw, scale, phase, r, g, b, flash, walk, atk, tilt, pose = 0) {
    if (m.n >= m.cap) {
      m.cap *= 2;
      const nd = new ArrayBuffer(m.cap * ISTRIDE); new Uint8Array(nd).set(m.u8);
      m.idata = nd; m.f = new Float32Array(nd); m.u8 = new Uint8Array(nd);
    }
    const o = m.n * 8, f = m.f, u = m.u8, b8 = m.n * ISTRIDE;
    f[o] = x; f[o + 1] = y; f[o + 2] = z; f[o + 3] = yaw; f[o + 4] = scale; f[o + 5] = phase;
    u[b8 + 24] = r; u[b8 + 25] = g; u[b8 + 26] = b; u[b8 + 27] = flash; u[b8 + 28] = walk; u[b8 + 29] = atk; u[b8 + 30] = tilt; u[b8 + 31] = pose;
    m.n++;
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

  _updateStructures(sim) {
    const gl = this.gl;
    const mesh = buildStructures(this.map, sim.segs, this.structCache);
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
  /** Zoom (CSS px per metre) at which full models take over from stand-ins at the current settings. */
  heroZoom(q = this.quality) { return this.lod(q).hero; }
  /** Zooms below which units are dots, boxes and stand-ins; full models from `hero` up. */
  lod(q = this.quality) {
    const dot = DOT_ZOOM * Math.sqrt(this.heroScale), hero = Math.max(dot * 1.5, HERO_ZOOM[q] * this.heroScale);
    return { dot, box: Math.sqrt(dot * hero), hero };
  }

  _ensurePost(w, h, want) {
    const gl = this.gl;
    if (this.post && this.post.w === w && this.post.h === h && this.post.want === want) return this.post;
    if (this.post) {
      const p = this.post;
      gl.deleteFramebuffer(p.msFbo); gl.deleteRenderbuffer(p.msColor); gl.deleteRenderbuffer(p.msDepth); gl.deleteFramebuffer(p.resFbo); gl.deleteTexture(p.resTex);
      for (const b of p.bloom) { gl.deleteFramebuffer(b.fbo); gl.deleteTexture(b.tex); }
    }
    const samples = Math.min(want, gl.getParameter(gl.MAX_SAMPLES));
    const p = { w, h, want };
    p.msFbo = gl.createFramebuffer(); p.msColor = gl.createRenderbuffer(); p.msDepth = gl.createRenderbuffer();
    gl.bindRenderbuffer(gl.RENDERBUFFER, p.msColor); gl.renderbufferStorageMultisample(gl.RENDERBUFFER, samples, gl.RGBA8, w, h);
    gl.bindRenderbuffer(gl.RENDERBUFFER, p.msDepth); gl.renderbufferStorageMultisample(gl.RENDERBUFFER, samples, gl.DEPTH_COMPONENT24, w, h);
    gl.bindFramebuffer(gl.FRAMEBUFFER, p.msFbo);
    gl.framebufferRenderbuffer(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.RENDERBUFFER, p.msColor);
    gl.framebufferRenderbuffer(gl.FRAMEBUFFER, gl.DEPTH_ATTACHMENT, gl.RENDERBUFFER, p.msDepth);
    const target = (tw, th) => {
      const tex = this._tex(gl.LINEAR);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, tw, th, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
      const fbo = gl.createFramebuffer();
      gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
      gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0);
      return { fbo, tex, w: tw, h: th };
    };
    const res = target(w, h); p.resFbo = res.fbo; p.resTex = res.tex;
    const bw = Math.max(2, w >> 2), bh = Math.max(2, h >> 2);
    p.bloom = [target(bw, bh), target(bw, bh)];
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    return (this.post = p);
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
    // mood colours are authored in display space; the shaders light in linear space
    if (u.uSunCol) gl.uniform3f(u.uSunCol, env.sun[0] * env.sun[0] * SUN_GAIN, env.sun[1] * env.sun[1] * SUN_GAIN, env.sun[2] * env.sun[2] * SUN_GAIN);
    if (u.uAmb) gl.uniform3f(u.uAmb, env.amb[0] * env.amb[0] * AMB_GAIN, env.amb[1] * env.amb[1] * AMB_GAIN, env.amb[2] * env.amb[2] * AMB_GAIN);
    if (u.uView) gl.uniform3fv(u.uView, this.view);
    if (u.uWet) gl.uniform1f(u.uWet, env.wet || 0);
    if (u.uExposure) gl.uniform1f(u.uExposure, EXPOSURE);
    if (u.uFog) gl.uniform3fv(u.uFog, env.fog);
    if (u.uWorld) gl.uniform4f(u.uWorld, WORLD_W, WORLD_H, 60, 330);
    if (u.uShadowVP) { gl.uniformMatrix4fv(u.uShadowVP, false, this.shadowVP); gl.uniform1f(u.uShadowOn, env.shadows ? 1 : 0); gl.uniform1f(u.uShadowTexel, this.shadowTexel); gl.activeTexture(gl.TEXTURE2); gl.bindTexture(gl.TEXTURE_2D, this.shadowTex); gl.uniform1i(u.uShadow, 2); }
    if (u.uLPos) { gl.uniform4fv(u.uLPos, this.lpos); gl.uniform3fv(u.uLCol, this.lcol); }
    if (u.uDecal) { gl.activeTexture(gl.TEXTURE1); gl.bindTexture(gl.TEXTURE_2D, this.decalTex); gl.uniform1i(u.uDecal, 1); }
    if (u.uMatA) {
      gl.activeTexture(gl.TEXTURE4); gl.bindTexture(gl.TEXTURE_2D_ARRAY, this.mats.a); gl.uniform1i(u.uMatA, 4);
      gl.activeTexture(gl.TEXTURE5); gl.bindTexture(gl.TEXTURE_2D_ARRAY, this.mats.b); gl.uniform1i(u.uMatB, 5);
      gl.uniform1fv(u.uMatScale, this.mats.scale); gl.uniform3fv(u.uMatMean, this.mats.mean);
    }
  }

  _scene(env) {
    const gl = this.gl;
    gl.enable(gl.DEPTH_TEST); gl.depthMask(true); gl.disable(gl.BLEND);
    let p = this.pTerrain;
    gl.useProgram(p.p); this._common(p.u, env);
    gl.uniform4fv(p.u.uAlbRect, this.albRect); gl.uniform1f(p.u.uTime, this.clock || 0);
    gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, this.albedo); gl.uniform1i(p.u.uAlbedo, 0);
    gl.activeTexture(gl.TEXTURE3); gl.bindTexture(gl.TEXTURE_2D, this.hmTex); gl.uniform1i(p.u.uHM, 3);
    gl.bindVertexArray(this.terrain.vao);
    gl.drawElements(gl.TRIANGLES, this.terrain.count, gl.UNSIGNED_INT, 0);
    p = this.pStruct;
    gl.useProgram(p.p); this._common(p.u, env);
    gl.bindVertexArray(this.struct.vao);
    gl.drawArrays(gl.TRIANGLES, 0, this.struct.count);
    const st = this.stats; st.tris.terrain = this.terrain.count / 3; st.tris.fort = this.struct.count / 3; st.draws += 2;
  }

  /** Which geometry a model is drawn with at a level of detail (0 full, 1 stand-in, 2 box, 3 far). */
  _geo(m, tier, shadow, props) {
    if (props) return tier === 0 ? m.full : m.mid || m.full;
    if (tier === 0) return shadow ? m.mid || m.full : m.full;
    if (tier === 1 || m.big) return m.mid || m.full;
    return m.lod;
  }

  _drawMeshes(env, clock, tier, shadowPass, props) {
    const gl = this.gl, p = this.pUnit, st = this.stats;
    gl.useProgram(p.p); this._common(p.u, env);
    gl.uniform1f(p.u.uTime, clock); gl.uniform1f(p.u.uShadowPass, shadowPass ? 1 : 0); gl.uniform1f(p.u.uLift, env.lift);
    for (const name in this.meshes) {
      const m = this.meshes[name], n = props ? m.pn : m.n;
      if (!n) continue;
      if (shadowPass && (name === 'mine' || name === 'cube')) continue;
      const geo = this._geo(m, tier, shadowPass, props), a = m.anim;
      gl.uniform4f(p.u.uPivot, a[0], a[1], a[2], a[3]); gl.uniform1f(p.u.uRecoil, a[4]); gl.uniform4f(p.u.uPivot2, a[5], a[6], a[7], a[8]); gl.uniform1f(p.u.uLegX, a[9]);
      gl.uniform1f(p.u.uMatOn, geo === m.full ? 1 : 0);   // stand-ins are too small on screen for texture to show
      gl.bindVertexArray(props ? geo.pvao : geo.vao);
      if (geo.itype) gl.drawElementsInstanced(gl.TRIANGLES, geo.n, geo.itype, 0, n); else gl.drawArraysInstanced(gl.TRIANGLES, 0, geo.n, n);
      st.draws++; if (shadowPass) st.tris.shadows += (geo.n / 3) * n; else st.tris.units += (geo.n / 3) * n;
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

  _drawParticles(n, minPx, tint, zoom, vw, vh) {
    if (!n) return;
    this.stats.draws++; this.stats.tris.fx += n * 2;
    const gl = this.gl, p = this.pPart;
    gl.useProgram(p.p);
    gl.uniformMatrix4fv(p.u.uVP, false, this.vp);
    gl.uniform2f(p.u.uK, (2 * zoom) / vw, (2 * zoom) / vh); gl.uniform1f(p.u.uZoom, zoom); gl.uniform1f(p.u.uCols, COLS); gl.uniform1f(p.u.uMinPx, minPx);
    gl.uniform3fv(p.u.uTint, tint);
    gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, this.atlas); gl.uniform1i(p.u.uAtlas, 0);
    gl.bindVertexArray(this.vaoPart);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.partBuf);
    gl.bufferSubData(gl.ARRAY_BUFFER, 0, this.partF, 0, n * PF);
    gl.drawArraysInstanced(gl.TRIANGLE_STRIP, 0, 4, n);
  }

  /**
   * @param cam  {x, y, zoom, yaw, dpr}  zoom in device px per metre
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
    viewMatrix(cam, vw, vh, SIN_P, COS_P, this.vp);
    // direction from the scene toward the (orthographic) camera
    this.view[0] = -Math.sin(cam.yaw) * COS_P; this.view[1] = Math.cos(cam.yaw) * COS_P; this.view[2] = SIN_P;

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
    gl.bindFramebuffer(gl.FRAMEBUFFER, post ? post.msFbo : null);
    gl.viewport(0, 0, vw, vh);
    gl.depthMask(true);
    gl.clearColor(env.fog[0], env.fog[1], env.fog[2], 1); gl.clearDepth(1);
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
    const zc = cam.zoom / (cam.dpr || 1);
    this._time('scene');
    this._scene(env);

    let dots = 0;
    this._time('units');
    if (sim) {
      for (const name in this.meshes) this.meshes[name].n = 0;
      const L = this.lod(q);
      const tier = zc < L.dot ? 3 : zc < L.box ? 2 : zc < L.hero ? 1 : 0;
      st.tier = tier;
      dots = this._fillUnits(cam, sim, al, vw, vh, tier, clock, env.lift > 0.12);
      this._fillDynamic(sim, fx, al, clock);
      for (const name in this.meshes) { const m = this.meshes[name]; if (m.n) { gl.bindBuffer(gl.ARRAY_BUFFER, m.ibuf); gl.bufferData(gl.ARRAY_BUFFER, m.u8, gl.DYNAMIC_DRAW, 0, m.n * ISTRIDE); } }
      gl.disable(gl.BLEND);
      this._drawMeshes(env, clock, tier, false, true);
      if (env.shadows && tier < 3) {
        gl.enable(gl.BLEND); gl.depthMask(false);
        this._drawMeshes(env, clock, tier, true, false);
        gl.depthMask(true); gl.disable(gl.BLEND);
      }
      this._drawMeshes(env, clock, tier, false, false);
    }
    this._time('effects');
    gl.enable(gl.BLEND); gl.depthMask(false);
    if (dots) this._drawParticles(dots, 2.6, [1, 1, 1], cam.zoom, vw, vh);
    if (fx) {
      const n = fx.fill(this.partF, this.partU, this.partMax, sim);
      st.parts = n;
      this._drawParticles(n, 1.6, [env.amb[0] * 0.6 + 0.4, env.amb[1] * 0.6 + 0.4, env.amb[2] * 0.6 + 0.4], cam.zoom, vw, vh);
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
  _fillUnits(cam, sim, al, vw, vh, tier, clock, torches) {
    const { alive, x, y, px, py, rot, trot, type, team, hitT, fireT, el, state, ammo, vx, vy, aux, bx, by, target2 } = sim;
    const grp = sim.grp, gShield = sim.gShield, crewOf = sim.crewOf, poseOf = sim.pose, ladderBare = this.meshes.ladderBare, ramBare = this.meshes.ramBare;
    const c = Math.cos(cam.yaw), s = Math.sin(cam.yaw), z0 = cam.zoom;
    const hw = vw / 2 + 60, hh = vh / 2 + 120;
    const gz = this.map.gz, mseg = sim.mseg, segTop = sim.segTop, time = sim.time, um = this.unitMesh;
    const PFv = this.partF, PU = this.partU;
    let dots = 0, drawn = 0;
    for (let i = 0, n = sim.n; i < n; i++) {
      if (!alive[i]) continue;
      const xi = px[i] + (x[i] - px[i]) * al, yi = py[i] + (y[i] - py[i]) * al;
      let zi;
      const st = state[i];
      if (st === S_CLIMB) {
        const L = target2[i], tower = L >= 0 && type[L] === U.tower;
        if (tower) continue; // inside the tower
        const u = Math.min(1, (time - aux[i]) / LADDER_TIME);
        zi = gz[((by[i] / HM_RES) | 0) * GZ_W + ((bx[i] / HM_RES) | 0)] * (1 - u) + segTop[0] * u;
      } else if (el[i]) { const sg = mseg[((yi / 4) | 0) * (WORLD_W / 4) + ((xi / 4) | 0)]; zi = sg >= 0 ? segTop[sg] : gz[((yi / HM_RES) | 0) * GZ_W + ((xi / HM_RES) | 0)]; }
      else zi = gz[((yi / HM_RES) | 0) * GZ_W + ((xi / HM_RES) | 0)];
      const dx = xi - cam.x, dy = yi - cam.y;
      const sx = (c * dx + s * dy) * z0, sy = ((-s * dx + c * dy) * SIN_P - zi * COS_P) * z0;
      if (sx < -hw || sx > hw || sy < -hh || sy > hh) continue;
      const d = UNITS[type[i]], um_i = um[type[i]];
      const h = (Math.imul(i, 2654435761) >>> 24);
      const fl = time - hitT[i];
      const flash = fl < 0.12 ? ((1 - fl / 0.12) * (d.hp > 300 ? 70 : 220)) | 0 : 0;
      drawn++;
      if (torches && team[i] !== DEF && d.sz === 0 && (h & 15) === 3 && dots < 9000) {
        // one in sixteen carries a torch: a flickering flame and a pool of light on the ground
        const fk = 0.8 + 0.2 * Math.sin(clock * 15 + i * 1.7) * Math.sin(clock * 6.3 + i);
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
      if (tier === 3 && d.size < 7) {
        // far view: a coloured dot. cyan = armed defender, amber = out of ammunition, red = attacker
        const o = dots * PF;
        PFv[o] = xi; PFv[o + 1] = yi; PFv[o + 2] = zi + 1; PFv[o + 3] = d.size * 0.42; PFv[o + 4] = d.size * 0.42; PFv[o + 5] = 0; PFv[o + 6] = SPR.dot;
        let r, g, b;
        if (team[i] === DEF) { if (d.ammo && ammo[i] < 1) { r = 255; g = 168; b = 60; } else { r = 110; g = 210; b = 255; } }
        else if (gShield[grp[i]] && crewOf[i] < 0) { r = 214 + (h % 24); g = 216 + (h % 20); b = 226; } // behind locked shields: a steel-pale dot, neither side's colour
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
      const sp = Math.sqrt(vx[i] * vx[i] + vy[i] * vy[i]);
      const walk = st === S_CLIMB ? 200 : sp > 0.3 ? Math.min(255, sp * 80) | 0 : 0;
      const yaw = rot[i];
      const phase = st === S_CLIMB ? time * 9 + i : (xi * Math.cos(yaw) + yi * Math.sin(yaw)) * 2.3 + i;
      let atk = 0;
      if (d.role === R.TOWER) atk = st === S_DONE ? 255 : 0;
      else { const ft = time - fireT[i], dur = d.team === DEF ? 0.16 : d.role === R.CATAPULT ? 1.2 : d.role === R.RAM ? 0.7 : 0.38; if (ft < dur) atk = ((1 - ft / dur) * 255) | 0; }
      // mid-distance stand-ins are tinted by side so the two armies still read at a glance
      if (tier === 2 && d.size < 7) { if (team[i] === DEF) this._put(m, xi, yi, zi, yaw, sc, phase, 120, 200, 235, flash, walk, atk, 0, walk ? 0 : poseOf[i]); else if (sh) this._put(m, xi, yi, zi, yaw, sc, phase, 226, 228, 238, flash, walk, atk, 5); else this._put(m, xi, yi, zi, yaw, sc, phase, v, 92, 74, flash, walk, atk, 0); }
      else if (sh) this._put(m, xi, yi, zi, yaw, sc * 0.94, phase, 255, 236, 205, flash, walk, 0, 5);
      else this._put(m, xi, yi, zi, yaw, sc, phase, v, v - (h2 & 7), v - ((h2 >> 9) & 15), flash, walk, atk, 0, team[i] === DEF && !walk ? poseOf[i] : 0);
      if (um_i.turret) this._put(um_i.turret, xi, yi, zi, trot[i], um_i.scale, 0, v, v, v, flash, 0, atk, 0);
    }
    this.stats.units = drawn; this.stats.dots = dots;
    return dots;
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
      if (a.kind === 'jet') this._put(M.jet, x, y, z, a.rot, 1.7, 0, 235, 235, 235, 0, 0, 0, 0);
      else if (a.kind === 'cargo') this._put(M.cargo, x, y, z, a.rot, 1, 0, 235, 235, 235, 0, 0, 0, 0);
      else if (a.kind === 'helo') this._put(M.helo, x, y, z + Math.sin(clock * 1.3 + x) * 1.5, a.rot, 1.25, 0, 235, 235, 235, 0, 0, 0, 0);
      else this._put(M.transport, x, y, z, a.rot, 1.2, 0, 235, 235, 235, 0, 0, 0, 0);
    }
    if (!fx) return;
    for (const ch of fx.chunks) {
      const m = M[ch.mesh];
      if (m) this._put(m, ch.x, ch.y, ch.z, ch.yaw, ch.scale, 0, ch.r, ch.g, ch.b, 0, 0, 0, tiltOf(ch.tilt));
    }
  }

  /** Small top-down RGBA snapshot of terrain and fortress for the minimap. */
  terrainThumb(w, h, sim) {
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
    viewMatrix({ x: WORLD_W / 2, y: WORLD_H / 2, zoom: w / WORLD_W, yaw: 0 }, w, h, 1, 0, this.vp);
    this.vp[1] = -this.vp[1]; this.vp[5] = -this.vp[5]; this.vp[9] = -this.vp[9]; this.vp[13] = -this.vp[13];
    this.lpos.fill(0); this.lcol.fill(0);
    this.view[0] = 0; this.view[1] = 0; this.view[2] = 1;
    this._scene({ amb: [0.75, 0.75, 0.75], sun: [0.5, 0.5, 0.48], fog: [0.1, 0.1, 0.1], shadows: true, lift: 0, wet: 0 });
    const px = new Uint8Array(w * h * 4);
    gl.readPixels(0, 0, w, h, gl.RGBA, gl.UNSIGNED_BYTE, px);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.deleteFramebuffer(fbo); gl.deleteTexture(tex); gl.deleteRenderbuffer(depth);
    return px;
  }
}
