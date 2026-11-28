// Surface materials. Every vertex names a material; the shaders look it up in two texture arrays
// that are generated on the GPU at start-up (no image files):
//   A: rgb = albedo detail (0.5 is neutral — it multiplies the vertex or terrain colour), a = height
//   B: rg = tangent-space normal, b = roughness, a = specular strength
// Each layer tiles seamlessly; TILE gives its size in metres on the surface.

export const MAT = {
  PLAIN: 0, ASHLAR: 1, FLAG: 2, ROCK: 3, GRASS: 4, DIRT: 5, GRAVEL: 6, TIMBER: 7, SLATE: 8,
  IRON: 9, PAINT: 10, CLOTH: 11, CAMO: 12, HIDE: 13, SKIN: 14, GLASS: 15,
  // not layers of their own: handled in the shaders
  EMIT: 16,      // unlit and bright (tracers, flames)
  TIMBER_V: 17,  // timber with the planks running the other way
};
export const LAYERS = 16;
/** Metres covered by one repeat of each layer. */
export const TILE = [1, 8, 6, 14, 5, 5, 3, 2.4, 3, 1.2, 2.5, 0.6, 1.4, 1.0, 0.5, 1];
/** How strongly each layer's height field turns into a normal map. */
const BUMP = [0, 3.2, 2.6, 4.2, 1.6, 2.2, 3.0, 2.2, 2.6, 1.1, 0.5, 0.9, 0.9, 1.5, 0.3, 0];

const FS_HEAD = `#version 300 es
precision highp float;
precision highp sampler2DArray;
uniform int uLayer; uniform int uPass; uniform float uBump; uniform float uRes;
uniform sampler2DArray uA;
in vec2 vUV; out vec4 o;
const float TAU = 6.2831853;
float h21(vec2 p){ p = fract(p*vec2(123.34,456.21)); p += dot(p,p+45.32); return fract(p.x*p.y); }
// value noise that repeats every 'per' lattice cells
float pn(vec2 p, vec2 per){
  vec2 i = floor(p), f = fract(p); f = f*f*(3.-2.*f);
  float a = h21(mod(i,per)), b = h21(mod(i+vec2(1,0),per)), c = h21(mod(i+vec2(0,1),per)), d = h21(mod(i+vec2(1,1),per));
  return mix(mix(a,b,f.x), mix(c,d,f.x), f.y);
}
float pfbm(vec2 uv, float per, int oct){
  float s = 0., a = .5, n = 0.;
  for (int i=0;i<7;i++){ if (i>=oct) break; s += a*pn(uv*per, vec2(per)); n += a; per *= 2.; a *= .5; }
  return s/n;
}
// repeating cellular noise: x = distance to the nearest cell edge, y = random per cell, z = distance to the cell's point
vec3 pvoro(vec2 p, vec2 per){
  vec2 i = floor(p), f = fract(p), mg = vec2(0.), mr = vec2(0.); float md = 8.;
  for (int y=-1;y<=1;y++) for (int x=-1;x<=1;x++){
    vec2 g = vec2(x,y), c = mod(i+g, per), r = g + vec2(h21(c+3.7), h21(c+11.3)) - f; float d = dot(r,r);
    if (d < md){ md = d; mr = r; mg = g; }
  }
  float f1 = sqrt(md); md = 8.;
  for (int y=-2;y<=2;y++) for (int x=-2;x<=2;x++){
    vec2 g = mg + vec2(x,y), c = mod(i+g, per), r = g + vec2(h21(c+3.7), h21(c+11.3)) - f;
    if (dot(mr-r,mr-r) > 1e-5) md = min(md, dot(0.5*(mr+r), normalize(r-mr)));
  }
  return vec3(md, h21(mod(i+mg, per)+1.9), f1);
}
struct M { vec3 alb; float h; float rough; float spec; };
float weave(vec2 uv, float n){ return 0.5 + 0.5*sin(uv.x*TAU*n)*sin(uv.y*TAU*n); }
`;

// one generator per layer, so each program compiles only the material it draws
const FN = {
  1: `M matOf(vec2 uv){
  // coursed ashlar as masons lay it: courses half a metre high, the blocks of each course a length of their own
  // (five to eight to the tile), joints tight and a little ragged, the odd stone replaced in a darker or paler
  // rock, arrises chipped, the whole face weathered in broad stains that ignore the blocks
  float rows = 16., row = floor(uv.y*rows), nb = 5. + floor(h21(vec2(row, 3.))*3.99);
  float gx = uv.x*nb + h21(vec2(row, 7.));
  vec2 id = vec2(mod(floor(gx), nb), row), f = vec2(fract(gx), fract(uv.y*rows));
  float rag = (pfbm(uv, 32., 3)-.5)*0.035;
  float dx = min(f.x, 1.-f.x)*(8./nb), dy = min(f.y, 1.-f.y)*0.5;          // metres to the nearest joint
  float d = min(dx, dy) + rag;
  float chip = smoothstep(0.10, 0.0, dx + dy*0.9 + (pfbm(uv+.21, 48., 2)-.5)*0.12)*step(0.55, h21(id+1.7));   // a knocked corner
  float face = smoothstep(0.006, 0.03, d)*(1.-chip*0.8), hb = h21(id+3.), grain = pfbm(uv, 28., 5);
  float pit = smoothstep(0.64, 0.82, pfbm(uv+.37, 44., 3));
  float odd = step(0.93, h21(id+5.3));                                     // one stone in fifteen is a later repair
  float tone = 0.93 + 0.14*hb + odd*(h21(id+8.1) > 0.5 ? 0.16 : -0.2);
  M m; m.h = face*(0.74 + 0.16*hb) + grain*0.14 - pit*0.10*face;
  vec3 c = vec3(0.5)*tone * mix(vec3(1.035,1.0,0.955), vec3(0.965,1.0,1.03), h21(id+9.));
  c *= mix(0.42, 1., face) * (0.88 + 0.24*grain) * (1. - 0.22*pit);
  float stain = pfbm(uv+.6, 3., 4);
  c *= 0.84 + 0.32*stain;                                                  // broad weathering across many blocks
  c = mix(c, vec3(0.38,0.43,0.30), smoothstep(.58,.8,pfbm(uv+.3, 7., 3))*0.20*face);     // lichen
  c = mix(c, vec3(0.30,0.34,0.24), (1.-face)*0.35);                        // moss and dirt in the joints
  m.alb = c; m.rough = mix(0.97, 0.84, face); m.spec = 0.2;
  return m;
}
`,
  2: `M matOf(vec2 uv){
  // flagstones: worn rectangular slabs laid in courses, their joints packed with dirt and moss
  float rows = 9., row = floor(uv.y*rows), nb = 6. + floor(h21(vec2(row, 13.))*3.99);
  float gx = uv.x*nb + h21(vec2(row, 17.));
  vec2 id = vec2(mod(floor(gx), nb), row), f = vec2(fract(gx), fract(uv.y*rows));
  float d = min(min(f.x, 1.-f.x)*(6./nb), min(f.y, 1.-f.y)*(6./rows)) + (pfbm(uv, 26., 3)-.5)*0.05;
  float face = smoothstep(0.008, 0.05, d), hb = h21(id+2.), grain = pfbm(uv, 30., 5), wear = pfbm(uv+.4, 5., 3);
  M m; m.h = face*(0.7 + 0.14*hb) + grain*0.12 - smoothstep(0.55, 0.8, wear)*0.06;
  m.alb = vec3(0.5)*(0.92 + 0.14*hb)*mix(0.5, 1., face)*(0.88 + 0.24*grain)*(0.86 + 0.28*wear)*mix(vec3(1.03,1.,0.96), vec3(0.97,1.,1.03), h21(id+6.));
  m.alb = mix(m.alb, vec3(0.34,0.38,0.27), (1.-face)*0.45);                               // moss in the joints
  m.rough = mix(0.95, 0.74, face); m.spec = 0.26;
  return m;
}
`,
  3: `M matOf(vec2 uv){
  // weathered rock: creases where bands of noise cross, facets between them, faint bedding
  vec2 w = uv + (vec2(pfbm(uv,3.,3), pfbm(uv+.5,3.,3))-.5)*0.3;
  float f = pfbm(w, 4., 6);
  float n1 = pn(w*4., vec2(4.)), n2 = pn(w*9.+3.7, vec2(9.)), n3 = pn(w*23.+1.3, vec2(23.));
  float crack = min(1., (1.-smoothstep(0., 0.09, abs(n1*2.-1.)))*0.55 + (1.-smoothstep(0., 0.1, abs(n2*2.-1.)))*0.32 + (1.-smoothstep(0., 0.14, abs(n3*2.-1.)))*0.2);
  crack *= 0.45 + 0.75*pn(w*14.+5.1, vec2(14.));                                     // creases fade in and out along their length
  float facet = smoothstep(0.42, 0.58, n1)*0.5 + smoothstep(0.4, 0.6, n2)*0.3 + n3*0.2;
  float strata = 0.5+0.5*sin(uv.y*TAU*7. + pfbm(uv,4.,3)*7.);
  M m; m.h = f*0.6 + facet*0.3 + strata*0.07 - crack*0.2 + pfbm(uv, 28., 3)*0.12;
  vec3 c = vec3(0.5)*(0.66 + 0.46*f + 0.2*(facet-.5)) * (1.-0.26*crack) * (0.95+0.1*strata) * (0.9+0.2*pfbm(uv, 28., 3));
  c *= mix(vec3(1.03,1.0,0.96), vec3(0.96,1.0,1.03), n2);
  c = mix(c, vec3(0.42,0.45,0.32), smoothstep(.58,.8,pfbm(uv+.21, 7., 4))*0.25);
  m.alb = c; m.rough = 0.92; m.spec = 0.14;
  return m;
}
`,
  4: `M matOf(vec2 uv){
  // tussocks of blades lying every which way
  float b1 = pn(uv*vec2(150.,38.) + pn(uv*12., vec2(12.))*3., vec2(150.,38.));
  float b2 = pn(uv.yx*vec2(150.,38.) + 9. + pn(uv*10.+3., vec2(10.))*3., vec2(150.,38.));
  float b3 = pn((uv.xy+uv.yx)*vec2(96.,96.), vec2(96.));
  float cl = pfbm(uv, 7., 4), blades = max(b1, b2)*0.75 + b3*0.25;
  M m; m.h = blades*0.6 + cl*0.4;
  vec3 c = mix(vec3(0.38,0.47,0.33), vec3(0.60,0.60,0.44), blades) * (0.78 + 0.44*cl);
  c = mix(c, vec3(0.62,0.56,0.38), smoothstep(.7,.95,b2)*0.3);                            // bleached stems
  m.alb = c; m.rough = 0.93; m.spec = 0.1;
  return m;
}
`,
  5: `M matOf(vec2 uv){
  float f = pfbm(uv, 6., 6); vec3 p = pvoro(uv*26., vec2(26.));
  float peb = smoothstep(0.34, 0.12, p.z) * step(0.62, p.y);
  float rut = 0.5+0.5*sin(uv.x*TAU*5. + pfbm(uv,3.,3)*5.);
  M m; m.h = f*0.55 + peb*0.4 + rut*0.1;
  vec3 c = vec3(0.5)*(0.76+0.48*f)*(0.92+0.12*rut);
  c = mix(c, vec3(0.62,0.60,0.56)*(0.8+0.4*p.y), peb*0.85);
  m.alb = c; m.rough = mix(0.82, 0.9, peb); m.spec = 0.2;
  return m;
}
`,
  6: `M matOf(vec2 uv){
  vec3 p = pvoro(uv*22., vec2(22.)), q = pvoro(uv*60.+.3, vec2(60.));
  float st = smoothstep(0., 0.2, p.x);
  M m; m.h = st*(0.5+0.4*p.y) + smoothstep(0.,0.2,q.x)*0.15;
  m.alb = vec3(0.5)*(0.62+0.7*p.y)*mix(0.45,1.,st)*(0.9+0.2*q.y)*mix(vec3(1.05,1.,0.93), vec3(0.95,1.,1.05), fract(p.y*5.1));
  m.rough = 0.9; m.spec = 0.15;
  return m;
}
`,
  7: `M matOf(vec2 uv){
  // eight planks across the tile, grain running along u
  float py = uv.y*8., pid = floor(py), fy = fract(py), r = h21(vec2(pid, 2.));
  float gap = smoothstep(0., 0.05, fy)*smoothstep(0., 0.05, 1.-fy);
  float ux = uv.x + r*0.37;
  float grain = pn(vec2(ux*10., py*22. + pn(vec2(ux*5., py*2.), vec2(5.,16.))*2.5), vec2(10.,176.));
  float fine = pn(vec2(ux*40., py*60.), vec2(40.,480.));
  float butt = smoothstep(0.004, 0.012, abs(fract(uv.x + r) - .5));                         // where two boards meet end to end
  vec3 k = pvoro(vec2(ux*3., py*0.75), vec2(3., 6.));
  float knot = smoothstep(0.16, 0.05, k.z)*step(0.78, k.y);
  M m; m.h = gap*butt*(0.6 + 0.3*grain + 0.1*fine) - knot*0.2;
  vec3 c = vec3(0.5)*(0.74+0.5*r)*(0.72+0.45*grain)*(0.92+0.16*fine)*mix(0.36,1.,gap*butt);
  c = mix(c, vec3(0.25,0.2,0.16), knot*0.7);
  m.alb = c*mix(vec3(1.05,1.,0.92), vec3(0.97,1.,1.04), r); m.rough = 0.84; m.spec = 0.15;
  return m;
}
`,
  8: `M matOf(vec2 uv){
  // ten overlapping courses, tiles staggered from one course to the next
  float ry = uv.y*10., row = floor(ry), fy = fract(ry), tx = uv.x*8. + .5*mod(row,2.);
  vec2 id = vec2(mod(floor(tx),8.), row); float fx = fract(tx), r = h21(id+4.);
  float side = smoothstep(0., 0.05, fx)*smoothstep(0., 0.05, 1.-fx), lip = smoothstep(0., 0.1, fy);
  M m; m.h = (1.-fy*0.75)*side + pfbm(uv, 30., 3)*0.08;
  m.alb = vec3(0.5)*(0.78+0.44*r)*mix(0.5,1.,side)*mix(0.55,1.,lip)*(0.9+0.2*pfbm(uv,24.,4))*mix(vec3(0.96,1.,1.06), vec3(1.04,1.,0.97), fract(r*3.7));
  m.rough = 0.6; m.spec = 0.42;
  return m;
}
`,
  9: `M matOf(vec2 uv){
  // hammered plate: shallow dents, scratches and rust creeping out of the hollows
  vec3 d = pvoro(uv*10., vec2(10.));
  float f = pfbm(uv, 6., 5), fine = pfbm(uv, 48., 3);
  float scr = max(smoothstep(0.8, 0.98, pn(vec2(uv.x*8., uv.y*230.), vec2(8.,230.))), smoothstep(0.84, 0.98, pn(vec2(uv.x*230., uv.y*8.+3.), vec2(230.,8.))))*step(0.5, pn(uv*5., vec2(5.)));
  float rust = smoothstep(0.52, 0.74, f + (1.-d.z)*0.12);
  M m; m.h = 0.55 + 0.22*(1.-smoothstep(0.,0.6,d.z)) + fine*0.08 - rust*0.08 - scr*0.1;
  vec3 c = vec3(0.5)*(0.86+0.28*fine)*(0.9+0.2*d.y);
  c = mix(c, vec3(0.66,0.42,0.28)*(0.8+0.4*fine), rust*0.7) + scr*0.22;
  m.alb = c; m.rough = mix(0.42, 0.88, rust); m.spec = mix(0.95, 0.2, rust);
  return m;
}
`,
  10: `M matOf(vec2 uv){
  // painted steel: faint orange peel, grime, chips down to primer and bare metal
  float f = pfbm(uv, 5., 5), peel = pfbm(uv, 56., 3);
  float chip = smoothstep(0.66, 0.72, pfbm(uv+.43, 14., 4))*step(0.45, pn(uv*7.+2., vec2(7.)));
  float streak = pn(vec2(uv.x*40., uv.y*3.), vec2(40.,3.));
  M m; m.h = 0.5 + peel*0.06 - chip*0.25;
  vec3 c = vec3(0.5)*(0.88+0.24*f)*(0.95+0.1*streak);
  c = mix(c, vec3(0.34,0.3,0.28), chip*0.8);
  m.alb = c; m.rough = 0.5 + 0.3*chip + 0.15*f; m.spec = 0.5;
  return m;
}
`,
  11: `M matOf(vec2 uv){
  float w = weave(uv, 48.), f = pfbm(uv, 5., 4), wr = pfbm(uv+.6, 3., 3);
  M m; m.h = 0.4 + w*0.15 + wr*0.45;
  m.alb = vec3(0.5)*(0.9+0.12*w)*(0.84+0.32*f); m.rough = 0.96; m.spec = 0.05;
  return m;
}
`,
  12: `M matOf(vec2 uv){
  // four-colour disruptive pattern over the weave
  vec2 w = uv + (vec2(pfbm(uv,4.,3), pfbm(uv+.5,4.,3))-.5)*0.22;
  float a = pfbm(w, 3., 4), b = pfbm(w+.31, 5., 4), wv = weave(uv, 40.), wr = pfbm(uv+.6, 3., 3);
  vec3 c = vec3(0.5);
  c = mix(c, vec3(0.31,0.27,0.21), smoothstep(0.5, 0.54, a));
  c = mix(c, vec3(0.68,0.64,0.49), smoothstep(0.56, 0.6, b));
  c = mix(c, vec3(0.2,0.23,0.18), smoothstep(0.6, 0.63, a*0.6+b*0.4+0.07));
  M m; m.h = 0.4 + wv*0.12 + wr*0.45;
  m.alb = c*(0.92+0.1*wv)*(0.9+0.2*wr); m.rough = 0.95; m.spec = 0.05;
  return m;
}
`,
  13: `M matOf(vec2 uv){
  // leather, hide and fur: creases, mottling and a lay of coarse hair
  vec3 v = pvoro(uv*9., vec2(9.));
  float f = pfbm(uv, 5., 5), hair = pn(vec2(uv.x*26. + pn(uv*6., vec2(6.))*2., uv.y*150.), vec2(26.,150.));
  float cr = 1.-smoothstep(0., 0.08, v.x);
  M m; m.h = 0.5 + f*0.3 - cr*0.3 + hair*0.15;
  m.alb = vec3(0.5)*(0.76+0.48*f)*(1.-0.3*cr)*(0.82+0.36*hair); m.rough = 0.72; m.spec = 0.22;
  return m;
}
`,
  14: `M matOf(vec2 uv){
  float f = pfbm(uv, 6., 4);
  M m; m.h = 0.5 + f*0.2; m.alb = vec3(0.5)*(0.93+0.14*f); m.rough = 0.58; m.spec = 0.25;
  return m;
}
`,
};
const FN_PLAIN = (l) => `M matOf(vec2 uv){ M m; m.alb = vec3(0.5); m.h = 0.5; m.rough = ${l === 15 ? '0.06' : '0.7'}; m.spec = ${l === 15 ? '1.0' : '0.15'}; return m; }
`;

const FS_TAIL = `void main(){
  M m = matOf(vUV);
  if (uPass == 0) { o = vec4(clamp(m.alb, 0., 1.), clamp(m.h, 0., 1.)); return; }
  // second pass: slope of the stored height field -> normal
  float e = 1./uRes, l = float(uLayer);
  float hx = texture(uA, vec3(vUV + vec2(e,0.), l)).a - texture(uA, vec3(vUV - vec2(e,0.), l)).a;
  float hy = texture(uA, vec3(vUV + vec2(0.,e), l)).a - texture(uA, vec3(vUV - vec2(0.,e), l)).a;
  vec3 n = normalize(vec3(-hx*uBump*uRes/128., -hy*uBump*uRes/128., 1.));
  o = vec4(n.xy*0.5+0.5, m.rough, m.spec);
}`;


/**
 * Generate both material arrays. Returns { a, b } textures (TEXTURE_2D_ARRAY, mipmapped, repeating).
 * `compile` and `vaoFull` come from the renderer: a program builder and a full-screen quad.
 */
export function buildMaterials(gl, compile, vsFull, vaoFull, res = 512) {
  const progs = [];
  for (let l = 0; l < LAYERS; l++) progs.push(compile(gl, vsFull, FS_HEAD + (FN[l] || FN_PLAIN(l)) + FS_TAIL));
  const aniso = gl.getExtension('EXT_texture_filter_anisotropic');
  const make = () => {
    const t = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D_ARRAY, t);
    gl.texStorage3D(gl.TEXTURE_2D_ARRAY, Math.floor(Math.log2(res)) + 1, gl.RGBA8, res, res, LAYERS);
    gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
    gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_WRAP_S, gl.REPEAT);
    gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_WRAP_T, gl.REPEAT);
    if (aniso) gl.texParameterf(gl.TEXTURE_2D_ARRAY, aniso.TEXTURE_MAX_ANISOTROPY_EXT, Math.min(4, gl.getParameter(aniso.MAX_TEXTURE_MAX_ANISOTROPY_EXT)));
    return t;
  };
  const a = make(), b = make(), fbo = gl.createFramebuffer();
  gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
  gl.viewport(0, 0, res, res);
  gl.disable(gl.DEPTH_TEST); gl.disable(gl.BLEND);
  gl.bindVertexArray(vaoFull);
  for (let pass = 0; pass < 2; pass++) {
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D_ARRAY, pass ? a : null);
    for (let l = 0; l < LAYERS; l++) {
      const prog = progs[l];
      gl.useProgram(prog.p);
      gl.uniform1f(prog.u.uRes, res); gl.uniform1i(prog.u.uPass, pass); gl.uniform1i(prog.u.uA, 0);
      gl.framebufferTextureLayer(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, pass ? b : a, 0, l);
      gl.uniform1i(prog.u.uLayer, l); gl.uniform1f(prog.u.uBump, BUMP[l]);
      gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    }
    // the height pass must be readable (with wrap-around) before the normals are derived from it
    gl.bindTexture(gl.TEXTURE_2D_ARRAY, pass ? b : a); gl.generateMipmap(gl.TEXTURE_2D_ARRAY);
  }
  // average colour of every layer (its smallest mip), so shaders can divide it out: the detail then
  // varies a surface's colour without shifting it
  const mean = new Float32Array(LAYERS * 3), px = new Uint8Array(4), top = Math.floor(Math.log2(res));
  for (let l = 0; l < LAYERS; l++) {
    gl.framebufferTextureLayer(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, a, top, l);
    gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px);
    for (let k = 0; k < 3; k++) mean[l * 3 + k] = Math.max(0.08, px[k] / 255);
  }
  gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  gl.deleteFramebuffer(fbo);
  for (const pr of progs) gl.deleteProgram(pr.p);
  gl.bindTexture(gl.TEXTURE_2D_ARRAY, null);
  gl.enable(gl.DEPTH_TEST);
  return { a, b, res, mean, scale: new Float32Array(TILE.map((t) => 1 / t)) };
}
