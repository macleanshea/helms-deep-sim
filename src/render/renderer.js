// WebGL2 renderer: baked procedural terrain, a vector-drawn fortification layer,
// a persistent decal layer (corpses, craters) and instanced sprites / particles.

import { WORLD_W, WORLD_H, UNITS, DEF, U } from '../config.js';
import { HM_W, HM_H, KEEP, N_RING } from '../map.js';
import { SPR, COLS } from './atlas.js';
import { S_DONE } from '../sim/sim.js';

const MAX_INST = 72000;
const STRIDE = 28;
const PSTRIDE = 32;
// fortification layer region (world metres) and resolution
const SX0 = 1120, SY0 = 160, SW = 390, SH = 810, SPX = 5;

const VS_QUAD = `#version 300 es
layout(location=0) in vec2 a;
uniform vec4 uCam; uniform vec4 uRect;
out vec2 vUV; out vec2 vW;
void main(){ vUV = a; vW = uRect.xy + a*uRect.zw; gl_Position = vec4((vW-uCam.xy)*uCam.zw, 0., 1.); }`;

const FS_QUAD = `#version 300 es
precision highp float;
uniform sampler2D uTex; uniform vec3 uAmb; uniform float uDetail; uniform float uOpacity;
in vec2 vUV; in vec2 vW; out vec4 o;
float hash(vec2 p){ p = fract(p*vec2(123.34,456.21)); p += dot(p,p+45.32); return fract(p.x*p.y); }
float noise(vec2 p){ vec2 i=floor(p), f=fract(p); f=f*f*(3.-2.*f); return mix(mix(hash(i),hash(i+vec2(1,0)),f.x), mix(hash(i+vec2(0,1)),hash(i+vec2(1,1)),f.x), f.y); }
void main(){
  vec4 c = texture(uTex, vUV);
  if (uDetail > 0.) { float n = noise(vW*1.3)*0.4 + noise(vec2(vW.x*3.1, vW.y*4.3))*0.35 + noise(vW*9.1)*0.25; c.rgb *= 1. + (n-.5)*uDetail; }
  o = vec4(c.rgb*uAmb, c.a) * uOpacity;
}`;

const FS_BAKE = `#version 300 es
precision highp float;
uniform sampler2D uHM; uniform vec2 uWorld;
in vec2 vW; out vec4 o;
float hash(vec2 p){ p = fract(p*vec2(123.34,456.21)); p += dot(p,p+45.32); return fract(p.x*p.y); }
float noise(vec2 p){ vec2 i=floor(p), f=fract(p); f=f*f*(3.-2.*f); return mix(mix(hash(i),hash(i+vec2(1,0)),f.x), mix(hash(i+vec2(0,1)),hash(i+vec2(1,1)),f.x), f.y); }
float fbm(vec2 p){ float s=0., a=.5; for(int i=0;i<5;i++){ s+=a*noise(p); p=p*2.03+17.; a*=.5; } return s/0.97; }
float H(vec2 w){
  vec4 m = texture(uHM, w/uWorld);
  return m.r + m.g*((fbm(w/11.)-.5)*9. + (fbm(vec2(w.x/3.,w.y/1.6))-.5)*1.6) + (1.-m.g)*(fbm(w/4.)-.5)*0.5;
}
void main(){
  vec2 w = vW; vec4 m = texture(uHM, w/uWorld);
  float e = 0.8;
  float h0 = H(w);
  float hx = H(w+vec2(e,0.))-H(w-vec2(e,0.)); float hy = H(w+vec2(0.,e))-H(w-vec2(0.,e));
  vec3 n = normalize(vec3(-hx, -hy, 2.*e*0.9));
  vec3 L = normalize(vec3(-0.55,-0.62,0.56));
  float dif = max(dot(n,L),0.);
  // cast shadows from cliffs and the Hornburg rock
  float sh = 1.; vec2 ld = normalize(L.xy); float tn = L.z/length(L.xy);
  for (int i=1;i<=28;i++){ float t = float(i)*2.6; float hh = texture(uHM,(w+ld*t)/uWorld).r; sh = min(sh, clamp(1.-(hh-(h0+t*tn))*0.22, 0., 1.)); }
  float slope = 1.-n.z;
  float rock = smoothstep(0.3,0.7, m.g + slope*0.8 + (fbm(w/13.)-.5)*.35);
  float g1 = fbm(w/70.), g2 = fbm(w/9.+31.), g3 = noise(w*1.9);
  vec3 grass = mix(vec3(0.17,0.24,0.11), vec3(0.37,0.40,0.19), smoothstep(0.25,0.75,g1));
  grass = mix(grass, vec3(0.24,0.30,0.14), smoothstep(0.55,0.7,fbm(w/26.+70.))*0.6);
  grass = mix(grass, vec3(0.40,0.37,0.21), smoothstep(.5,.8,g2)*.55);
  grass *= 0.84+0.32*g3;
  vec3 dirt = mix(vec3(0.33,0.27,0.19), vec3(0.47,0.40,0.30), fbm(w/12.+5.)) * (0.82+0.36*noise(w*2.4));
  vec3 rk = mix(vec3(0.27,0.26,0.26), vec3(0.47,0.45,0.42), fbm(vec2(w.x/30., w.y/7.)+h0*0.12));
  rk = mix(rk, vec3(0.42,0.40,0.36), smoothstep(.45,.75,fbm(w/20.+9.))*.5);
  rk *= 0.75+0.5*fbm(w/3.5);
  float dm = clamp(m.b*(0.55+0.9*fbm(w/8.+3.)),0.,1.);
  vec3 c = mix(grass, dirt, dm);
  c = mix(c, rk, rock);
  vec3 wat = vec3(0.12,0.18,0.20) + 0.10*pow(noise(vec2(w.x*.3, w.y*1.1)+3.), 3.);
  c = mix(c, vec3(0.30,0.27,0.2), smoothstep(0.02,0.35,m.a)*(1.-smoothstep(0.35,0.7,m.a))*0.7);
  c = mix(c, wat, smoothstep(0.35,0.75,m.a));
  float light = (0.46 + 0.9*dif) * mix(0.7, 1., sh);
  c *= light;
  c *= 1. - 0.12*smoothstep(0.2,0.9,m.g)*(1.-slope*2.);
  o = vec4(c,1.);
}`;

const VS_SPRITE = `#version 300 es
layout(location=0) in vec2 aCorner;
layout(location=1) in vec4 aPSR;
layout(location=2) in float aSprite;
layout(location=3) in vec4 aColor;
layout(location=4) in vec4 aDot;
uniform vec4 uCam; uniform float uZoom; uniform float uShadow; uniform float uLodOff; uniform float uCols;
out vec2 vUV; out vec2 vLocal; out vec4 vColor; out vec4 vDot; out float vLod; out float vR;
void main(){
  float px = aPSR.z * uZoom;
  float lod = max(uLodOff, clamp((px - 6.)/11., 0., 1.));
  float size = aPSR.z;
  vR = 0.21;
  if (lod <= 0.) { size = max(px*0.4, 2.3)/uZoom; vR = 0.5; }
  float c = cos(aPSR.w), s = sin(aPSR.w);
  vec2 q = aCorner * size;
  vec2 p = aPSR.xy + vec2(q.x*c - q.y*s, q.x*s + q.y*c);
  p += uShadow * vec2(aPSR.z*0.07+0.25, aPSR.z*0.10+0.3);
  float col = mod(aSprite, uCols), row = floor(aSprite/uCols);
  vUV = (vec2(col,row) + 0.5 + aCorner*0.97)/uCols;
  vLocal = aCorner; vColor = aColor; vDot = aDot; vLod = lod;
  gl_Position = vec4((p-uCam.xy)*uCam.zw, 0., 1.);
}`;

const FS_SPRITE = `#version 300 es
precision highp float;
uniform sampler2D uAtlas; uniform vec3 uAmb; uniform float uShadow;
in vec2 vUV; in vec2 vLocal; in vec4 vColor; in vec4 vDot; in float vLod; in float vR;
out vec4 o;
void main(){
  vec4 t = texture(uAtlas, vUV);
  if (uShadow > 0.5) { o = vec4(0.,0.,0., t.a*0.42*vLod*vColor.a); return; }
  vec3 rgb = t.rgb*vColor.rgb*uAmb;
  rgb = mix(rgb, vec3(t.a), vDot.a*0.85);
  vec4 spr = vec4(rgb, t.a)*vColor.a;
  float d = length(vLocal);
  float da = (1.-smoothstep(vR*0.75, vR, d))*vColor.a;
  vec4 dot_ = vec4(mix(vDot.rgb, vec3(1.), vDot.a*0.7)*da, da);
  o = mix(dot_, spr, vLod);
  if (o.a < 0.004) discard;
}`;

const VS_PART = `#version 300 es
layout(location=0) in vec2 aCorner;
layout(location=1) in vec4 aPS;
layout(location=2) in vec2 aRS;
layout(location=3) in vec4 aColor;
layout(location=4) in float aAdd;
uniform vec4 uCam; uniform float uZoom; uniform float uCols;
out vec2 vUV; out vec4 vColor; out float vAdd;
void main(){
  vec2 sz = max(aPS.zw, vec2(1.7/uZoom));
  float c = cos(aRS.x), s = sin(aRS.x);
  vec2 q = aCorner * sz;
  vec2 p = aPS.xy + vec2(q.x*c - q.y*s, q.x*s + q.y*c);
  float col = mod(aRS.y, uCols), row = floor(aRS.y/uCols);
  vUV = (vec2(col,row) + 0.5 + aCorner*0.96)/uCols;
  vColor = aColor; vAdd = aAdd;
  gl_Position = vec4((p-uCam.xy)*uCam.zw, 0., 1.);
}`;

const FS_PART = `#version 300 es
precision highp float;
uniform sampler2D uAtlas; uniform vec3 uAmb;
in vec2 vUV; in vec4 vColor; in float vAdd;
out vec4 o;
void main(){
  vec4 t = texture(uAtlas, vUV);
  float a = t.a*vColor.a;
  vec3 rgb = vColor.rgb * mix(uAmb*0.6+0.4, vec3(1.), vAdd);
  o = vec4(rgb*a, a*(1.-vAdd));
}`;

function compile(gl, vs, fs) {
  const p = gl.createProgram();
  for (const [type, src] of [[gl.VERTEX_SHADER, vs], [gl.FRAGMENT_SHADER, fs]]) {
    const s = gl.createShader(type);
    gl.shaderSource(s, src); gl.compileShader(s);
    if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s) + '\n' + src);
    gl.attachShader(p, s);
  }
  gl.linkProgram(p);
  if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(p));
  const u = {};
  const n = gl.getProgramParameter(p, gl.ACTIVE_UNIFORMS);
  for (let i = 0; i < n; i++) { const info = gl.getActiveUniform(p, i); u[info.name] = gl.getUniformLocation(p, info.name); }
  return { p, u };
}

const rgba = (r, g, b, a = 255) => ((a << 24) | (b << 16) | (g << 8) | r) >>> 0;

export class Renderer {
  constructor(canvas, map, atlasCanvas) {
    this.canvas = canvas; this.map = map;
    const gl = canvas.getContext('webgl2', { antialias: false, alpha: false, powerPreference: 'high-performance' });
    if (!gl) throw new Error('WebGL2 is required');
    this.gl = gl;
    gl.getExtension('EXT_color_buffer_float');
    this.pQuad = compile(gl, VS_QUAD, FS_QUAD);
    this.pBake = compile(gl, VS_QUAD, FS_BAKE);
    this.pSprite = compile(gl, VS_SPRITE, FS_SPRITE);
    this.pPart = compile(gl, VS_PART, FS_PART);

    const quad = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, quad);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([0, 0, 1, 0, 0, 1, 1, 1]), gl.STATIC_DRAW);
    const cquad = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, cquad);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-0.5, -0.5, 0.5, -0.5, -0.5, 0.5, 0.5, 0.5]), gl.STATIC_DRAW);

    this.vaoQuad = gl.createVertexArray();
    gl.bindVertexArray(this.vaoQuad);
    gl.bindBuffer(gl.ARRAY_BUFFER, quad);
    gl.enableVertexAttribArray(0); gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);

    // sprite instances
    this.instData = new ArrayBuffer(MAX_INST * STRIDE);
    this.instF = new Float32Array(this.instData); this.instU = new Uint32Array(this.instData);
    this.instBuf = gl.createBuffer();
    this.vaoSprite = gl.createVertexArray();
    gl.bindVertexArray(this.vaoSprite);
    gl.bindBuffer(gl.ARRAY_BUFFER, cquad);
    gl.enableVertexAttribArray(0); gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.instBuf);
    gl.bufferData(gl.ARRAY_BUFFER, this.instData.byteLength, gl.DYNAMIC_DRAW);
    gl.enableVertexAttribArray(1); gl.vertexAttribPointer(1, 4, gl.FLOAT, false, STRIDE, 0); gl.vertexAttribDivisor(1, 1);
    gl.enableVertexAttribArray(2); gl.vertexAttribPointer(2, 1, gl.FLOAT, false, STRIDE, 16); gl.vertexAttribDivisor(2, 1);
    gl.enableVertexAttribArray(3); gl.vertexAttribPointer(3, 4, gl.UNSIGNED_BYTE, true, STRIDE, 20); gl.vertexAttribDivisor(3, 1);
    gl.enableVertexAttribArray(4); gl.vertexAttribPointer(4, 4, gl.UNSIGNED_BYTE, true, STRIDE, 24); gl.vertexAttribDivisor(4, 1);

    // particles
    this.partMax = 26000;
    this.partData = new ArrayBuffer(this.partMax * PSTRIDE);
    this.partF = new Float32Array(this.partData); this.partU = new Uint32Array(this.partData);
    this.partBuf = gl.createBuffer();
    this.vaoPart = gl.createVertexArray();
    gl.bindVertexArray(this.vaoPart);
    gl.bindBuffer(gl.ARRAY_BUFFER, cquad);
    gl.enableVertexAttribArray(0); gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.partBuf);
    gl.bufferData(gl.ARRAY_BUFFER, this.partData.byteLength, gl.DYNAMIC_DRAW);
    gl.enableVertexAttribArray(1); gl.vertexAttribPointer(1, 4, gl.FLOAT, false, PSTRIDE, 0); gl.vertexAttribDivisor(1, 1);
    gl.enableVertexAttribArray(2); gl.vertexAttribPointer(2, 2, gl.FLOAT, false, PSTRIDE, 16); gl.vertexAttribDivisor(2, 1);
    gl.enableVertexAttribArray(3); gl.vertexAttribPointer(3, 4, gl.UNSIGNED_BYTE, true, PSTRIDE, 24); gl.vertexAttribDivisor(3, 1);
    gl.enableVertexAttribArray(4); gl.vertexAttribPointer(4, 1, gl.FLOAT, false, PSTRIDE, 28); gl.vertexAttribDivisor(4, 1);
    gl.bindVertexArray(null);

    // atlas
    gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, true);
    this.atlas = this._tex(gl.LINEAR_MIPMAP_LINEAR);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, atlasCanvas);
    gl.generateMipmap(gl.TEXTURE_2D);

    const maxTex = gl.getParameter(gl.MAX_TEXTURE_SIZE);
    this.texScale = maxTex >= 3840 ? 2 : 1;
    this._bakeTerrain();

    // decal layer
    this.decalW = WORLD_W * this.texScale; this.decalH = WORLD_H * this.texScale;
    this.decalTex = this._tex(gl.LINEAR);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, this.decalW, this.decalH, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
    this.decalFbo = gl.createFramebuffer();
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.decalFbo);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, this.decalTex, 0);
    gl.clearColor(0, 0, 0, 0); gl.clear(gl.COLOR_BUFFER_BIT);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);

    // fortifications
    this.sCanvas = document.createElement('canvas');
    this.sCanvas.width = SW * SPX; this.sCanvas.height = SH * SPX;
    this.sctx = this.sCanvas.getContext('2d');
    this.shCanvas = document.createElement('canvas');
    this.shCanvas.width = (SW * SPX) / 4; this.shCanvas.height = (SH * SPX) / 4;
    this.structTex = this._tex(gl.LINEAR_MIPMAP_LINEAR);
    this.structVersion = -1;

    gl.disable(gl.DEPTH_TEST);
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
    this.nGround = 0; this.nAir = 0;
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

  _bakeTerrain() {
    const gl = this.gl;
    const hm = this._tex(gl.LINEAR);
    gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA16F, HM_W, HM_H, 0, gl.RGBA, gl.FLOAT, this.map.hm);
    const w = WORLD_W * this.texScale, h = WORLD_H * this.texScale;
    this.terrainTex = this._tex(gl.LINEAR_MIPMAP_LINEAR);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, w, h, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
    const fbo = gl.createFramebuffer();
    gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, this.terrainTex, 0);
    gl.viewport(0, 0, w, h);
    gl.useProgram(this.pBake.p);
    gl.uniform4f(this.pBake.u.uCam, WORLD_W / 2, WORLD_H / 2, 2 / WORLD_W, 2 / WORLD_H);
    gl.uniform4f(this.pBake.u.uRect, 0, 0, WORLD_W, WORLD_H);
    gl.uniform2f(this.pBake.u.uWorld, WORLD_W, WORLD_H);
    gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, hm);
    gl.uniform1i(this.pBake.u.uHM, 0);
    gl.disable(gl.BLEND);
    gl.bindVertexArray(this.vaoQuad);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    gl.enable(gl.BLEND);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.bindTexture(gl.TEXTURE_2D, this.terrainTex);
    gl.generateMipmap(gl.TEXTURE_2D);
    gl.deleteFramebuffer(fbo); gl.deleteTexture(hm);
  }

  /** Small RGB snapshot of the terrain for the minimap. */
  terrainThumb(w, h) {
    const gl = this.gl;
    const tex = this._tex(gl.LINEAR);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, w, h, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
    const fbo = gl.createFramebuffer();
    gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0);
    gl.viewport(0, 0, w, h);
    const cam = [WORLD_W / 2, WORLD_H / 2, 2 / WORLD_W, 2 / WORLD_H];
    this._quad(this.terrainTex, cam, [0, 0, WORLD_W, WORLD_H], [1, 1, 1], 0);
    this._quad(this.structTex, cam, [SX0, SY0, SW, SH], [1, 1, 1], 0);
    const px = new Uint8Array(w * h * 4);
    gl.readPixels(0, 0, w, h, gl.RGBA, gl.UNSIGNED_BYTE, px);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.deleteFramebuffer(fbo); gl.deleteTexture(tex);
    return px;
  }

  clearDecals() {
    const gl = this.gl;
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.decalFbo);
    gl.clearColor(0, 0, 0, 0); gl.clear(gl.COLOR_BUFFER_BIT);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  }

  // ------------------------------------------------------- fortifications
  drawStructures(segs) {
    const c = this.sctx, W = this.sCanvas.width, Hh = this.sCanvas.height;
    c.setTransform(1, 0, 0, 1, 0, 0);
    c.globalCompositeOperation = 'source-over';
    c.clearRect(0, 0, W, Hh);
    c.setTransform(SPX, 0, 0, SPX, -SX0 * SPX, -SY0 * SPX);
    c.lineJoin = 'round';
    let sd = 99;
    const rnd = () => { sd = (sd * 16807) % 2147483647; return sd / 2147483647; };
    const R = KEEP.r, da = Math.PI / N_RING + 0.004;
    const wallPath = (q, s, n0, n1, ext = 0.6) => {
      const hl = s.len / 2 + ext;
      q.beginPath();
      q.moveTo(s.x - s.tx * hl + s.nx * n0, s.y - s.ty * hl + s.ny * n0);
      q.lineTo(s.x + s.tx * hl + s.nx * n0, s.y + s.ty * hl + s.ny * n0);
      q.lineTo(s.x + s.tx * hl + s.nx * n1, s.y + s.ty * hl + s.ny * n1);
      q.lineTo(s.x - s.tx * hl + s.nx * n1, s.y - s.ty * hl + s.ny * n1);
      q.closePath();
    };
    const ringPath = (q, s, r0, r1, a0 = s.a - da, a1 = s.a + da) => { q.beginPath(); q.arc(KEEP.cx, KEEP.cy, r1, a0, a1); q.arc(KEEP.cx, KEEP.cy, r0, a1, a0, true); q.closePath(); };
    const shape = (q, s) => {
      if (s.kind === 'wall') wallPath(q, s, -6, 6);
      else if (s.kind === 'tower') { q.beginPath(); q.arc(s.x, s.y, KEEP.towerR, 0, 6.2832); }
      else if (s.kind === 'gate') ringPath(q, s, R - 8, R + 8);
      else ringPath(q, s, R - 5, R + 5);
    };
    // masonry
    for (const s of segs) {
      if (s.breached) continue;
      if (s.kind === 'wall') {
        wallPath(c, s, -6, 6); c.fillStyle = '#77736b'; c.fill();
        wallPath(c, s, -4.7, 4.3); c.fillStyle = '#9b978d'; c.fill();
      } else if (s.kind === 'tower') {
        c.beginPath(); c.arc(s.x, s.y, KEEP.towerR, 0, 6.2832); c.fillStyle = '#7b7770'; c.fill();
        c.beginPath(); c.arc(s.x, s.y, KEEP.towerR - 2.2, 0, 6.2832); c.fillStyle = '#9d998f'; c.fill();
        const g = c.createRadialGradient(s.x - 5, s.y - 6, 1, s.x, s.y, KEEP.towerR - 6);
        g.addColorStop(0, '#8b8780'); g.addColorStop(1, '#5c5954');
        c.beginPath(); c.arc(s.x, s.y, KEEP.towerR - 6.5, 0, 6.2832); c.fillStyle = g; c.fill();
        c.strokeStyle = 'rgba(0,0,0,0.28)'; c.lineWidth = 0.35;
        for (let k = 0; k < 10; k++) { const a = k * 0.6283; c.beginPath(); c.moveTo(s.x, s.y); c.lineTo(s.x + Math.cos(a) * (KEEP.towerR - 6.5), s.y + Math.sin(a) * (KEEP.towerR - 6.5)); c.stroke(); }
        c.beginPath(); c.arc(s.x, s.y, 2.2, 0, 6.2832); c.fillStyle = '#3d3b38'; c.fill();
      } else {
        const g8 = s.kind === 'gate';
        ringPath(c, s, g8 ? R - 8 : R - 5, g8 ? R + 8 : R + 5); c.fillStyle = '#77736b'; c.fill();
        ringPath(c, s, g8 ? R - 6.6 : R - 3.8, g8 ? R + 6.4 : R + 3.5); c.fillStyle = g8 ? '#8a867d' : '#9b978d'; c.fill();
      }
    }
    // stone texture and block joints, clipped to the masonry
    c.globalCompositeOperation = 'source-atop';
    for (let k = 0; k < 9000; k++) {
      const v = rnd();
      c.fillStyle = v > 0.5 ? `rgba(255,255,255,${0.03 + rnd() * 0.06})` : `rgba(0,0,0,${0.03 + rnd() * 0.08})`;
      c.fillRect(SX0 + rnd() * SW, SY0 + rnd() * SH, 0.5 + rnd() * 2.2, 0.4 + rnd() * 1.4);
    }
    c.globalCompositeOperation = 'source-over';
    // battlements
    for (const s of segs) {
      if (s.breached) continue;
      c.strokeStyle = '#bdb9ad'; c.lineWidth = 1.15; c.setLineDash([1.35, 0.95]);
      if (s.kind === 'wall') {
        const hl = s.len / 2 + 0.6;
        c.beginPath(); c.moveTo(s.x - s.tx * hl + s.nx * 5.3, s.y - s.ty * hl + s.ny * 5.3); c.lineTo(s.x + s.tx * hl + s.nx * 5.3, s.y + s.ty * hl + s.ny * 5.3); c.stroke();
        c.setLineDash([]); c.strokeStyle = 'rgba(40,38,34,0.55)'; c.lineWidth = 0.3;
        c.beginPath(); c.moveTo(s.x - s.tx * hl - s.nx * 5.9, s.y - s.ty * hl - s.ny * 5.9); c.lineTo(s.x + s.tx * hl - s.nx * 5.9, s.y + s.ty * hl - s.ny * 5.9); c.stroke();
        c.beginPath(); c.moveTo(s.x - s.tx * hl + s.nx * 5.95, s.y - s.ty * hl + s.ny * 5.95); c.lineTo(s.x + s.tx * hl + s.nx * 5.95, s.y + s.ty * hl + s.ny * 5.95); c.stroke();
        if (s.id % 6 === 3) { // stair on the inner face
          c.save(); c.translate(s.x - s.nx * 7.6, s.y - s.ny * 7.6); c.rotate(Math.atan2(s.ty, s.tx));
          c.fillStyle = '#827e75'; c.fillRect(-4, -1.6, 8, 3.2); c.strokeStyle = 'rgba(0,0,0,0.4)'; c.lineWidth = 0.25;
          for (let x = -3; x <= 3; x += 1) { c.beginPath(); c.moveTo(x, -1.6); c.lineTo(x, 1.6); c.stroke(); }
          c.restore();
        }
        if (s.culvert) {
          c.fillStyle = '#15130f'; c.beginPath(); c.arc(s.x + s.nx * 6, s.y + s.ny * 6, 3, 0, 6.2832); c.fill();
          c.strokeStyle = '#55524b'; c.lineWidth = 0.3; for (let k = -2; k <= 2; k++) { c.beginPath(); c.moveTo(s.x + s.nx * 6 + s.tx * k, s.y + s.ny * 6 + s.ty * k - 0); c.lineTo(s.x + s.nx * 9 + s.tx * k, s.y + s.ny * 9 + s.ty * k); c.stroke(); }
        }
      } else if (s.kind === 'tower') {
        c.beginPath(); c.arc(s.x, s.y, KEEP.towerR - 0.8, 0, 6.2832); c.stroke();
        c.setLineDash([]); c.strokeStyle = 'rgba(30,28,26,0.6)'; c.lineWidth = 0.4; c.beginPath(); c.arc(s.x, s.y, KEEP.towerR, 0, 6.2832); c.stroke();
      } else {
        const g8 = s.kind === 'gate';
        c.beginPath(); c.arc(KEEP.cx, KEEP.cy, g8 ? R + 7.3 : R + 4.4, s.a - da, s.a + da); c.stroke();
        c.setLineDash([]); c.strokeStyle = 'rgba(40,38,34,0.55)'; c.lineWidth = 0.3;
        c.beginPath(); c.arc(KEEP.cx, KEEP.cy, g8 ? R + 8 : R + 5, s.a - da, s.a + da); c.stroke();
        c.beginPath(); c.arc(KEEP.cx, KEEP.cy, g8 ? R - 8 : R - 5, s.a - da, s.a + da); c.stroke();
        if (g8) {
          c.fillStyle = '#17120c'; c.fillRect(s.x - 9.6, s.y - 5.2, 19.2, 10.4);
          c.fillStyle = '#5d4329'; c.fillRect(s.x - 9.4, s.y - 4.6, 3.2, 9.2);
          c.strokeStyle = '#2a2a2c'; c.lineWidth = 0.35; for (const y of [-3, 0, 3]) { c.beginPath(); c.moveTo(s.x - 9.4, s.y + y); c.lineTo(s.x - 6.2, s.y + y); c.stroke(); }
          c.strokeStyle = '#1c150d'; c.lineWidth = 0.3; c.beginPath(); c.moveTo(s.x - 7.8, s.y - 4.6); c.lineTo(s.x - 7.8, s.y + 4.6); c.stroke();
          c.fillStyle = 'rgba(0,0,0,0.35)'; c.fillRect(s.x - 6.2, s.y - 4.6, 15.6, 9.2);
        }
        if (s.kind === 'postern') { c.fillStyle = '#3d2c1b'; c.save(); c.translate(s.x + s.nx * 4.6, s.y + s.ny * 4.6); c.rotate(s.a); c.fillRect(-0.9, -1.8, 1.8, 3.6); c.restore(); }
      }
      c.setLineDash([]);
    }
    // ring turrets
    for (let k = 0; k < N_RING; k += 5) {
      const s = segs[this.map.GATE + k], p = segs[this.map.GATE + ((k + N_RING - 1) % N_RING)];
      if (s.breached || p.breached || k === 0) continue;
      const a = s.a - Math.PI / N_RING, x = KEEP.cx + Math.cos(a) * (R + 1), y = KEEP.cy + Math.sin(a) * (R + 1);
      c.beginPath(); c.arc(x, y, 7.2, 0, 6.2832); c.fillStyle = '#7b7770'; c.fill(); c.strokeStyle = 'rgba(30,28,26,0.6)'; c.lineWidth = 0.4; c.stroke();
      c.beginPath(); c.arc(x, y, 5.4, 0, 6.2832); c.fillStyle = '#a19d93'; c.fill();
      c.strokeStyle = '#bdb9ad'; c.lineWidth = 1.1; c.setLineDash([1.35, 0.95]); c.beginPath(); c.arc(x, y, 6.5, 0, 6.2832); c.stroke(); c.setLineDash([]);
    }
    // gatehouse flanking towers
    const gs = segs[this.map.GATE];
    for (const sgn of [-1, 1]) {
      const a = gs.a + sgn * (da + 0.02), x = KEEP.cx + Math.cos(a) * (R + 2), y = KEEP.cy + Math.sin(a) * (R + 2);
      c.beginPath(); c.arc(x, y, 8, 0, 6.2832); c.fillStyle = '#7b7770'; c.fill(); c.strokeStyle = 'rgba(30,28,26,0.6)'; c.lineWidth = 0.4; c.stroke();
      c.beginPath(); c.arc(x, y, 6, 0, 6.2832); c.fillStyle = '#a19d93'; c.fill();
      c.strokeStyle = '#bdb9ad'; c.lineWidth = 1.1; c.setLineDash([1.35, 0.95]); c.beginPath(); c.arc(x, y, 7.2, 0, 6.2832); c.stroke(); c.setLineDash([]);
    }
    // rubble where sections have fallen
    for (const s of segs) {
      if (!s.breached) continue;
      sd = 1000 + s.id * 77;
      const g = c.createRadialGradient(s.x, s.y, 1, s.x, s.y, 16);
      g.addColorStop(0, 'rgba(18,15,12,0.75)'); g.addColorStop(1, 'rgba(18,15,12,0)');
      c.fillStyle = g; c.fillRect(s.x - 16, s.y - 16, 32, 32);
      const n = s.kind === 'gate' || s.kind === 'postern' ? 34 : 70;
      for (let k = 0; k < n; k++) {
        const u = (rnd() - 0.5) * (s.len + 3), v = (rnd() + rnd() - 1) * 10;
        c.save(); c.translate(s.x + s.tx * u + s.nx * v, s.y + s.ty * u + s.ny * v); c.rotate(rnd() * 6.28);
        const sz = 0.5 + rnd() * rnd() * 2.4, sh = 95 + (rnd() * 75) | 0;
        if (s.kind === 'gate' && k % 3 === 0) { c.fillStyle = '#4f3923'; c.fillRect(-sz * 1.6, -0.3, sz * 3.2, 0.6); }
        else { c.fillStyle = `rgb(${sh},${sh - 4},${sh - 12})`; c.fillRect(-sz, -sz * 0.7, sz * 2, sz * 1.4); c.strokeStyle = 'rgba(0,0,0,0.5)'; c.lineWidth = 0.18; c.strokeRect(-sz, -sz * 0.7, sz * 2, sz * 1.4); }
        c.restore();
      }
    }
    // soft cast shadows, drawn underneath everything
    const sc = this.shCanvas.getContext('2d');
    sc.setTransform(1, 0, 0, 1, 0, 0); sc.clearRect(0, 0, this.shCanvas.width, this.shCanvas.height);
    sc.filter = 'blur(2.5px)';
    sc.fillStyle = '#000';
    for (const s of segs) {
      if (s.breached) continue;
      const off = s.kind === 'tower' ? 2.2 : 1;
      sc.setTransform(SPX / 4, 0, 0, SPX / 4, (-SX0 + 3.2 * off) * SPX / 4, (-SY0 + 4.4 * off) * SPX / 4);
      shape(sc, s); sc.fill();
    }
    sc.filter = 'none';
    c.setTransform(1, 0, 0, 1, 0, 0);
    c.globalCompositeOperation = 'destination-over';
    c.globalAlpha = 0.62;
    c.drawImage(this.shCanvas, 0, 0, W, Hh);
    c.globalAlpha = 1; c.globalCompositeOperation = 'source-over';

    const gl = this.gl;
    gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, true);
    gl.bindTexture(gl.TEXTURE_2D, this.structTex);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, this.sCanvas);
    gl.generateMipmap(gl.TEXTURE_2D);
  }

  // --------------------------------------------------------------- frame
  resize(w, h) {
    if (this.canvas.width !== w || this.canvas.height !== h) { this.canvas.width = w; this.canvas.height = h; }
  }

  _quad(tex, cam, rect, amb, detail, opacity = 1) {
    const gl = this.gl, p = this.pQuad;
    gl.useProgram(p.p);
    gl.uniform4fv(p.u.uCam, cam); gl.uniform4fv(p.u.uRect, rect); gl.uniform3fv(p.u.uAmb, amb);
    gl.uniform1f(p.u.uDetail, detail); gl.uniform1f(p.u.uOpacity, opacity);
    gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, tex); gl.uniform1i(p.u.uTex, 0);
    gl.bindVertexArray(this.vaoQuad);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
  }

  _sprites(cam, zoom, n, amb, shadow, lodOff = 0) {
    if (!n) return;
    const gl = this.gl, p = this.pSprite;
    gl.useProgram(p.p);
    gl.uniform4fv(p.u.uCam, cam); gl.uniform1f(p.u.uZoom, zoom); gl.uniform1f(p.u.uCols, COLS); gl.uniform1f(p.u.uLodOff, lodOff);
    gl.uniform3fv(p.u.uAmb, amb);
    gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, this.atlas); gl.uniform1i(p.u.uAtlas, 0);
    gl.bindVertexArray(this.vaoSprite);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.instBuf);
    gl.bufferSubData(gl.ARRAY_BUFFER, 0, this.instF, 0, n * 7);
    if (shadow) { gl.uniform1f(p.u.uShadow, 1); gl.drawArraysInstanced(gl.TRIANGLE_STRIP, 0, 4, n); }
    gl.uniform1f(p.u.uShadow, 0);
    gl.drawArraysInstanced(gl.TRIANGLE_STRIP, 0, 4, n);
  }

  _inst(k, x, y, size, rot, spr, color, dot) {
    const o = k * 7, f = this.instF;
    f[o] = x; f[o + 1] = y; f[o + 2] = size; f[o + 3] = rot; f[o + 4] = spr;
    this.instU[o + 5] = color; this.instU[o + 6] = dot;
  }

  /** Stamp queued decals (corpses, scorch marks) permanently into the decal layer. */
  flushDecals(fx) {
    const n = fx.decalCount;
    if (!n) return;
    const gl = this.gl, d = fx.decals;
    for (let k = 0; k < n; k++) { const o = k * 7; this._inst(k, d[o], d[o + 1], d[o + 2], d[o + 3], d[o + 4], rgba(d[o + 5] & 255, (d[o + 5] >> 8) & 255, (d[o + 5] >> 16) & 255, d[o + 6]), 0); }
    fx.decalCount = 0;
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.decalFbo);
    gl.viewport(0, 0, this.decalW, this.decalH);
    this._sprites([WORLD_W / 2, WORLD_H / 2, 2 / WORLD_W, 2 / WORLD_H], 100, n, [1, 1, 1], false, 1);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  }

  /**
   * @param cam  {x, y, zoom}  zoom in device px per metre
   * @param sim  simulation whose units are drawn (may be a static preview)
   * @param fx   effects system
   * @param al   interpolation factor between the previous and current sim step
   * @param amb  ambient light colour
   */
  render(cam, sim, fx, al, amb, clock) {
    const gl = this.gl, vw = this.canvas.width, vh = this.canvas.height;
    if (sim && sim.structVersion !== this.structVersion) { this.structVersion = sim.structVersion; this.drawStructures(sim.segs); }
    if (fx) this.flushDecals(fx);
    gl.viewport(0, 0, vw, vh);
    gl.clearColor(0.03, 0.035, 0.04, 1); gl.clear(gl.COLOR_BUFFER_BIT);
    const z = cam.zoom;
    const C = [cam.x, cam.y, (2 * z) / vw, (-2 * z) / vh];
    const detail = Math.min(0.45, Math.max(0, (z - 2) * 0.07));
    this._quad(this.terrainTex, C, [0, 0, WORLD_W, WORLD_H], amb, detail);
    this._quad(this.decalTex, C, [0, 0, WORLD_W, WORLD_H], amb, 0);
    this._quad(this.structTex, C, [SX0, SY0, SW, SH], amb, detail * 0.6);
    const uAmb = [amb[0] * 0.6 + 0.46, amb[1] * 0.6 + 0.46, amb[2] * 0.6 + 0.46];
    if (sim) {
      const n = this._fillUnits(cam, sim, al, vw, vh);
      this._sprites(C, z, n, uAmb, true);
    }
    if (fx) this._particles(C, z, fx, amb);
    if (sim) {
      const n = this._fillAir(sim, al, clock);
      this._sprites(C, z, n, [amb[0] * 0.45 + 0.55, amb[1] * 0.45 + 0.55, amb[2] * 0.45 + 0.55], false, 1);
    }
  }

  _fillUnits(cam, sim, al, vw, vh) {
    const hw = vw / cam.zoom / 2 + 8, hh = vh / cam.zoom / 2 + 8;
    const x0 = cam.x - hw, x1 = cam.x + hw, y0 = cam.y - hh, y1 = cam.y + hh;
    const { alive, x, y, px, py, rot, trot, type, team, hitT, el, state, ammo } = sim;
    const f = this.instF, u = this.instU, time = sim.time;
    let k = 0; const turrets = [];
    for (let i = 0, n = sim.n; i < n && k < MAX_INST - 600; i++) {
      if (!alive[i]) continue;
      const xi = px[i] + (x[i] - px[i]) * al, yi = py[i] + (y[i] - py[i]) * al;
      if (xi < x0 || xi > x1 || yi < y0 || yi > y1) continue;
      const d = UNITS[type[i]];
      const o = k * 7;
      let spr = d.spr, size = d.size;
      if (spr === SPR.ladder && state[i] === S_DONE) spr = SPR.ladderUp;
      const h = (Math.imul(i, 2654435761) >>> 24);
      let v = 205 + (h % 50);
      if (el[i]) { size *= 1.06; v = 255; }
      const fl = time - hitT[i];
      const flash = fl < 0.12 ? ((1 - fl / 0.12) * 200) | 0 : 0;
      f[o] = xi; f[o + 1] = yi; f[o + 2] = size; f[o + 3] = rot[i]; f[o + 4] = spr;
      u[o + 5] = rgba(v, v, v, 255);
      // far-zoom dots: cyan = armed defender, amber = out of ammunition, red = attacker
      u[o + 6] = team[i] === DEF ? (d.ammo && ammo[i] < 1 ? rgba(255, 168, 60, flash) : rgba(110, 210, 255, flash)) : rgba(150 + (h % 80), 42 + (h % 24), 30, flash);
      k++;
      if (d.turret) turrets.push(xi, yi, size, trot[i], d.turret, flash);
    }
    for (let t = 0; t < turrets.length; t += 6) { this._inst(k++, turrets[t], turrets[t + 1], turrets[t + 2], turrets[t + 3], turrets[t + 4], rgba(255, 255, 255, 255), rgba(110, 210, 255, turrets[t + 5])); }
    return k;
  }

  _fillAir(sim, al, clock) {
    let k = 0;
    const white = rgba(255, 255, 255, 255), shadow = rgba(0, 0, 0, 80);
    for (const p of sim.projectiles) {
      const x = p.px + (p.x - p.px) * al, y = p.py + (p.y - p.py) * al;
      const dist = Math.hypot(p.x1 - p.x0, p.y1 - p.y0);
      const lift = p.arc ? p.h * Math.min(70, 12 + dist * 0.16) : p.vis === 4 ? p.h * 30 : 0;
      if (lift > 1) this._inst(k++, x, y, 2.5, 0, SPR.dot, rgba(0, 0, 0, 70), 0);
      const s = 1 + p.h * 0.5;
      let rot = p.rot;
      if (p.arc) rot = Math.atan2((p.y1 - p.y0) - (1 - 2 * p.t / p.T) * Math.min(70, 12 + dist * 0.16) * 4, p.x1 - p.x0);
      switch (p.vis) {
        case 1: this._inst(k++, x, y, 6, rot, SPR.rocket, white, 0); break;
        case 2: this._inst(k++, x, y - lift, 3.2 * s, rot, SPR.shell, white, 0); break;
        case 3: this._inst(k++, x, y - lift, 3.4 * s, clock * 3, SPR.rock, white, 0); break;
        case 4: this._inst(k++, x, y - lift, 6 * s, rot, SPR.bomb, white, 0); break;
        case 5: this._inst(k++, x, y, 2.4, rot, SPR.shell, white, 0); break;
        default: this._inst(k++, x, y - lift, 5.5, rot, SPR.shell, white, 0);
      }
    }
    for (const d of sim.drops) {
      const u = Math.min(1, (d.t + al * 0.1) / d.T), h = (1 - u) * 70;
      this._inst(k++, d.x, d.y, 5 + u * 3, 0, SPR.dot, rgba(0, 0, 0, 40 + u * 50), 0);
      this._inst(k++, d.x + h * 0.25, d.y - h, 4.5, 0.3, SPR.crate, white, 0);
      this._inst(k++, d.x + h * 0.25, d.y - h, 11 + Math.sin(clock * 3 + d.x) * 0.5, 0, SPR.chute, white, 0);
    }
    for (const a of sim.aircraft) {
      const x = a.px + (a.x - a.px) * al, y = a.py + (a.y - a.py) * al;
      if (a.kind === 'jet') { this._inst(k++, x + 26, y + 36, 22, a.rot, SPR.jet, shadow, 0); this._inst(k++, x, y, 22, a.rot, SPR.jet, white, 0); }
      else if (a.kind === 'cargo') { this._inst(k++, x + 30, y + 42, 44, a.rot, SPR.cargo, shadow, 0); this._inst(k++, x, y, 44, a.rot, SPR.cargo, white, 0); }
      else {
        const spr = a.kind === 'helo' ? SPR.helo : SPR.transport, sz = a.kind === 'helo' ? 18 : 23;
        this._inst(k++, x + 14, y + 20, sz, a.rot, spr, shadow, 0);
        this._inst(k++, x + 14, y + 20, sz * 1.15, 0, SPR.rotor, rgba(0, 0, 0, 50), 0);
        this._inst(k++, x, y, sz, a.rot, spr, white, 0);
        this._inst(k++, x + Math.cos(a.rot) * sz * 0.05, y + Math.sin(a.rot) * sz * 0.05, sz * 1.15, clock * 31, SPR.rotor, white, 0);
      }
    }
    return k;
  }

  _particles(C, z, fx, amb) {
    const n = fx.fill(this.partF, this.partU, this.partMax);
    if (!n) return;
    const gl = this.gl, p = this.pPart;
    gl.useProgram(p.p);
    gl.uniform4fv(p.u.uCam, C); gl.uniform1f(p.u.uZoom, z); gl.uniform1f(p.u.uCols, COLS); gl.uniform3fv(p.u.uAmb, amb);
    gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, this.atlas); gl.uniform1i(p.u.uAtlas, 0);
    gl.bindVertexArray(this.vaoPart);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.partBuf);
    gl.bufferSubData(gl.ARRAY_BUFFER, 0, this.partF, 0, n * 8);
    gl.drawArraysInstanced(gl.TRIANGLE_STRIP, 0, 4, n);
  }
}
