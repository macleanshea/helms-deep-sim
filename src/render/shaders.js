// GLSL sources for the 3D renderer.

const NOISE = `
float hash(vec2 p){ p = fract(p*vec2(123.34,456.21)); p += dot(p,p+45.32); return fract(p.x*p.y); }
float noise(vec2 p){ vec2 i=floor(p), f=fract(p); f=f*f*(3.-2.*f); return mix(mix(hash(i),hash(i+vec2(1,0)),f.x), mix(hash(i+vec2(0,1)),hash(i+vec2(1,1)),f.x), f.y); }
float fbm(vec2 p){ float s=0., a=.5; for(int i=0;i<5;i++){ s+=a*noise(p); p=p*2.03+17.; a*=.5; } return s/0.97; }
float fbm3(vec2 p){ float s=0., a=.5; for(int i=0;i<3;i++){ s+=a*noise(p); p=p*2.07+11.; a*=.5; } return s/0.875; }
vec2 hash2(vec2 p){ return fract(sin(vec2(dot(p,vec2(127.1,311.7)), dot(p,vec2(269.5,183.3))))*43758.5453); }
// cellular noise: x = distance to the nearest cell edge, y = a random value per cell (blocks, flagstones, fractured rock)
vec2 voro(vec2 p){
  vec2 i = floor(p), f = fract(p), mg = vec2(0.), mr = vec2(0.); float md = 8.;
  for (int y=-1;y<=1;y++) for (int x=-1;x<=1;x++){ vec2 g = vec2(x,y), r = g + hash2(i+g) - f; float d = dot(r,r); if (d < md){ md = d; mr = r; mg = g; } }
  md = 8.;
  for (int y=-1;y<=1;y++) for (int x=-1;x<=1;x++){ vec2 g = mg + vec2(x,y), r = g + hash2(i+g) - f; if (dot(mr-r,mr-r) > 1e-4) md = min(md, dot(0.5*(mr+r), normalize(r-mr))); }
  return vec2(md, hash(i+mg));
}
// weathered rock face, seen side-on: big fractured blocks, finer cracks, bedding, lichen and rain streaks
vec3 rockFace(vec2 q){
  vec2 b = voro(q*vec2(0.075, 0.11) + fbm3(q*0.02)*1.3);
  vec2 s = voro(q*vec2(0.24, 0.32));
  float grain = fbm(q*0.55);
  vec3 c = mix(vec3(0.29,0.285,0.28), vec3(0.50,0.49,0.465), 0.35 + 0.5*b.y);
  c *= mix(0.45, 1., smoothstep(0., 0.09, b.x)) * mix(0.72, 1., smoothstep(0., 0.06, s.x));
  c *= 0.8 + 0.38*grain;
  c *= 0.9 + 0.1*sin(q.y*0.7 + fbm3(q*0.05)*9.);
  c = mix(c, vec3(0.37,0.38,0.27), smoothstep(0.62, 0.82, fbm3(q*0.06 + 7.))*0.32);
  c *= 1. - 0.3*smoothstep(0.58, 0.95, noise(vec2(q.x*0.3, q.y*0.012 + 3.)));
  return c;
}
`;

// sun + ambient + shadow map + a handful of point lights (explosion flashes, fires)
const LIGHT = `
uniform vec3 uSun; uniform vec3 uSunCol; uniform vec3 uAmb;
uniform mat4 uShadowVP; uniform highp sampler2DShadow uShadow; uniform float uShadowOn;
uniform vec4 uLPos[6]; uniform vec3 uLCol[6];
float shadowAt(vec3 wp, float ndl){
  if (uShadowOn < .5) return 1.;
  vec4 sc = uShadowVP*vec4(wp,1.); vec3 p = sc.xyz*0.5+0.5;
  if (p.x<0.||p.x>1.||p.y<0.||p.y>1.||p.z>1.||p.z<0.) return 1.;
  float bias = 0.0016 + 0.005*(1.-ndl);
  return texture(uShadow, vec3(p.xy, p.z - bias));
}
vec3 lighting(vec3 albedo, vec3 n, vec3 wp, float occl){
  float ndl = max(dot(n,uSun),0.);
  float sh = min(shadowAt(wp, ndl), occl);
  vec3 l = uAmb*(0.6+0.4*n.z) + uSunCol*ndl*mix(0.12, 1., sh);
  for (int i=0;i<6;i++){
    vec3 d = uLPos[i].xyz - wp; float r = uLPos[i].w; float att = max(0., 1. - dot(d,d)/(r*r));
    l += uLCol[i]*att*att*(0.35+0.65*max(dot(n, normalize(d)),0.));
  }
  return albedo*l;
}
uniform vec3 uFog; uniform vec4 uWorld; // world w,h and fade distances
vec3 fogged(vec3 c, vec2 wxy){
  vec2 o = max(max(-wxy, wxy - uWorld.xy), vec2(0.));
  return mix(c, uFog, smoothstep(uWorld.z, uWorld.w, length(o)));
}
`;

export const VS_TERRAIN = `#version 300 es
layout(location=0) in vec3 aPos; layout(location=1) in vec3 aNormal;
uniform mat4 uVP;
out vec3 vW; out vec3 vN;
void main(){ vW = aPos; vN = aNormal; gl_Position = uVP*vec4(aPos,1.); }`;

export const FS_TERRAIN = `#version 300 es
precision highp float;
in vec3 vW; in vec3 vN; out vec4 o;
uniform sampler2D uAlbedo; uniform sampler2D uDecal; uniform sampler2D uHM; uniform vec4 uAlbRect; uniform float uDetail; uniform float uTime;
${NOISE}${LIGHT}
void main(){
  vec3 n = normalize(vN);
  vec2 uv = (vW.xy - uAlbRect.xy)/uAlbRect.zw;
  vec3 c = texture(uAlbedo, uv).rgb;
  vec4 m = texture(uHM, uv);          // height, rock, dirt, water
  // steep faces: the top-down texture smears, so texture them side-on as fractured rock
  float steep = smoothstep(0.2, 0.5, 1.-n.z);
  if (steep > 0.) {
    vec2 t = normalize(vec2(-n.y, n.x) + 1e-5);
    vec3 rk = rockFace(vec2(dot(vW.xy, t), vW.z));
    c = mix(c, rk, steep*0.94);
  }
  // a dusting of old snow on the high shelves of the mountain
  float snow = smoothstep(175., 230., vW.z + (fbm3(vW.xy*0.015)-.5)*70.) * smoothstep(0.6, 0.85, n.z) * smoothstep(0.35, 0.6, fbm3(vW.xy*0.05));
  c = mix(c, vec3(0.72,0.74,0.78)*(0.85+0.2*noise(vW.xy*0.4)), snow*0.75);
  if (uDetail > 0.) {
    float grass = (1.-m.g)*(1.-m.b)*(1.-m.a)*(1.-steep);
    float blades = noise(vec2(vW.x*3.7 + noise(vW.xy*0.8)*2., vW.y*3.1))*0.55 + noise(vW.xy*11.)*0.45;
    float pebbles = 1. - smoothstep(0., 0.12, voro(vW.xy*1.6).x)*0.5;
    float d = mix(noise(vW.xy*1.3)*0.5 + noise(vW.xy*6.1)*0.5, blades, grass);
    c *= 1. + (d-.5)*uDetail*1.6;
    c *= mix(1., pebbles, m.b*(1.-grass)*uDetail*1.4);
  }
  // water: a dark, moving surface that catches what light there is
  if (m.a > 0.3) {
    float w = smoothstep(0.3, 0.7, m.a);
    float rip = noise(vec2(vW.x*0.5, vW.y*1.6 - uTime*1.7)) * noise(vec2(vW.x*1.3 + uTime*0.6, vW.y*0.7));
    vec3 wc = vec3(0.05,0.08,0.09) + uFog*1.4 + uSunCol*0.12*pow(rip, 2.)*2.4;
    c = mix(c, wc, w*0.85);
  }
  if (vW.x > 0. && vW.y > 0. && vW.x < uWorld.x && vW.y < uWorld.y) { vec4 d = texture(uDecal, vW.xy/uWorld.xy); c = c*(1.-d.a) + d.rgb; }
  o = vec4(fogged(lighting(c, n, vW, 1.), vW.xy), 1.);
}`;

export const FS_BAKE = `#version 300 es
precision highp float;
uniform sampler2D uHM; uniform vec4 uRect;
in vec2 vUV; out vec4 o;
${NOISE}
float D(vec2 w, float rock){ return rock*((fbm(w/11.)-.5)*9. + (fbm(vec2(w.x/3.,w.y/1.6))-.5)*1.6 - smoothstep(0.,0.15,voro(w/7.).x)*1.4) + (1.-rock)*((fbm(w/4.)-.5)*0.5 + (noise(w*1.7)-.5)*0.12); }
void main(){
  vec2 w = uRect.xy + vUV*uRect.zw; vec4 m = texture(uHM, vUV);
  float e = 0.8;
  float hx = D(w+vec2(e,0.), m.g)-D(w-vec2(e,0.), m.g), hy = D(w+vec2(0.,e), m.g)-D(w-vec2(0.,e), m.g);
  vec3 n = normalize(vec3(-hx, -hy, 2.*e*0.9));
  float dif = max(dot(n, normalize(vec3(-0.5,0.4,0.76))),0.);
  float rock = smoothstep(0.3,0.7, m.g + (fbm(w/13.)-.5)*.35);
  // rough upland pasture: tussocky, part green, part bleached, with clover-dark hollows and heather
  float g1 = fbm(w/90.), g2 = fbm(w/11.+31.), g3 = noise(w*1.9), g4 = fbm(w/3.2+5.);
  vec3 grass = mix(vec3(0.19,0.24,0.12), vec3(0.33,0.35,0.18), smoothstep(0.25,0.75,g1));
  grass = mix(grass, vec3(0.15,0.2,0.1), smoothstep(0.55,0.72,fbm(w/26.+70.))*0.55);
  grass = mix(grass, vec3(0.43,0.40,0.25), smoothstep(.52,.82,g2)*.6);
  grass = mix(grass, vec3(0.27,0.21,0.2), smoothstep(.66,.8,fbm(w/17.+120.))*.35);
  grass *= 0.8 + 0.28*g3 + 0.18*(g4-.5);
  // trampled earth and mud: darker and wetter in the ruts
  vec3 dirt = mix(vec3(0.27,0.22,0.16), vec3(0.45,0.38,0.28), fbm(w/12.+5.)) * (0.82+0.36*noise(w*2.4));
  dirt *= 0.86 + 0.14*smoothstep(0.2, 0.6, abs(sin(w.x*0.9 + fbm3(w/6.)*6.)));
  // rock seen from above: fractured slabs with lichen and gravel in the joints
  vec2 wq = w + vec2(fbm3(w/23.), fbm3(w/23.+40.))*16.;
  vec2 vb = voro(wq/16.), vs = voro(wq/5.);
  float macro = fbm(w/60.+3.);
  vec3 rk = mix(vec3(0.29,0.28,0.27), vec3(0.53,0.51,0.48), clamp(0.15 + 0.45*macro + 0.35*vb.y, 0., 1.));
  rk *= mix(0.62, 1., smoothstep(0., 0.08, vb.x)) * mix(0.84, 1., smoothstep(0., 0.07, vs.x));
  rk = mix(rk, vec3(0.42,0.43,0.32), smoothstep(.55,.78,fbm(w/14.+9.))*.35);
  rk *= 0.78+0.44*fbm(w/3.5);
  // scree where the cliff meets the grass
  float scree = smoothstep(0.15, 0.45, m.g) * (1. - smoothstep(0.55, 0.9, m.g));
  vec3 grav = mix(vec3(0.33,0.31,0.29), vec3(0.5,0.48,0.45), noise(w*3.1)) * (0.8 + 0.3*noise(w*0.7));
  float dm = clamp(m.b*(0.55+0.9*fbm(w/8.+3.)),0.,1.);
  vec3 c = mix(grass, dirt, dm);
  c = mix(c, grav, scree*0.7);
  c = mix(c, rk, rock);
  vec3 wat = vec3(0.07,0.11,0.12) + 0.06*pow(noise(vec2(w.x*.3, w.y*1.1)+3.), 3.);
  // muddy banks with pebbles at the waterline
  float bank = smoothstep(0.02,0.35,m.a)*(1.-smoothstep(0.35,0.7,m.a));
  c = mix(c, vec3(0.24,0.21,0.16)*(0.75+0.5*noise(w*2.2)), bank*0.8);
  c = mix(c, wat, smoothstep(0.35,0.75,m.a));
  c *= 0.62 + 0.62*dif;
  o = vec4(c,1.);
}`;

export const VS_FULL = `#version 300 es
layout(location=0) in vec2 a;
out vec2 vUV;
void main(){ vUV = a; gl_Position = vec4(a*2.-1., 0., 1.); }`;

export const VS_STRUCT = `#version 300 es
layout(location=0) in vec3 aPos; layout(location=1) in vec3 aNormal; layout(location=2) in float aPart; layout(location=3) in vec4 aColor;
uniform mat4 uVP;
out vec3 vW; out vec3 vN; out vec3 vC; out float vMat;
void main(){ vW = aPos; vN = aNormal; vC = aColor.rgb; vMat = aPart; gl_Position = uVP*vec4(aPos,1.); }`;

export const FS_STRUCT = `#version 300 es
precision highp float;
in vec3 vW; in vec3 vN; in vec3 vC; in float vMat; out vec4 o;
uniform sampler2D uDecal;
${NOISE}${LIGHT}
void main(){
  vec3 n = normalize(vN); vec3 c = vC;
  if (vMat < 0.5) {
    if (abs(n.z) > 0.6) {
      // flagstones: irregular slabs, worn and stained
      vec2 v = voro(vW.xy*0.45);
      float fa = 1. - smoothstep(0.12, 0.35, fwidth(vW.x*0.45) + fwidth(vW.y*0.45));
      c *= mix(0.97, (0.82 + 0.3*v.y) * mix(0.62, 1., smoothstep(0., 0.07, v.x)), fa);
      c *= 0.88 + 0.24*fbm3(vW.xy*1.7);
      c = mix(c, c*vec3(0.85,0.9,0.8), smoothstep(0.6,0.8,fbm3(vW.xy*0.15))*0.5);
    } else {
      // dressed ashlar in running bond, every course a little different
      vec2 t = normalize(vec2(-n.y, n.x)+1e-4);
      float u = dot(vW.xy, t);
      vec2 uv = vec2(u*0.46, vW.z*0.9);
      float row = floor(uv.y); uv.x += mod(row,2.)*0.5 + hash(vec2(row, 5.))*0.3;
      vec2 id = floor(uv), f = fract(uv);
      float chip = 0.04 + 0.05*noise(vW.xy*3.+vW.z*3.);
      float joint = smoothstep(0.,chip,f.x)*smoothstep(0.,chip,1.-f.x)*smoothstep(0.,chip*1.6,f.y)*smoothstep(0.,chip*1.6,1.-f.y);
      float hv = hash(id+row*7.);
      float fa = 1. - smoothstep(0.18, 0.45, fwidth(uv.y));
      c *= mix(0.92, (0.8+0.32*hv) * mix(0.55,1.,joint), fa);
      c *= mix(vec3(1.), vec3(1.04,1.0,0.94), step(0.7, hash(id+3.1)));     // the odd warmer stone
      c *= 0.88+0.24*fbm3(vec2(u, vW.z)*2.3);
      // rain streaks running down from the parapets, damp and moss at the foot
      c *= 1. - 0.22*smoothstep(0.5, 0.9, noise(vec2(u*0.9, vW.z*0.06)));
      c = mix(c, vec3(0.2,0.24,0.15), smoothstep(3.5, 0., vW.z - 0.5*noise(vec2(u*0.5, 1.)))*0.35*smoothstep(0.4,0.7,noise(vec2(u*0.35, 7.))));
    }
  } else if (vMat < 1.5) {
    // timber: planks with grain and iron-dark gaps
    float pl = dot(vW.xy, vec2(0.71,0.71))*2.2 + vW.z*0.2;
    float g = noise(vec2(pl*0.6, vW.z*7. + hash(vec2(floor(pl),1.))*20.));
    c *= (0.72+0.36*hash(vec2(floor(pl), 3.))) * (0.7+0.3*smoothstep(0.,0.1,fract(pl))) * (0.85 + 0.3*g);
  } else if (vMat > 2.5) {
    // slate: overlapping courses of small tiles
    vec2 t = normalize(vec2(-n.y, n.x)+1e-4);
    float u = dot(vW.xy, t)*2.2, row = floor(vW.z*2.6);
    float tile = fract(u + mod(row,2.)*0.5);
    float fs = 1. - smoothstep(0.2, 0.5, fwidth(vW.z*2.6));
    c *= mix(0.9, 1., 1.-fs) * mix(1., (0.78 + 0.3*hash(vec2(floor(u + mod(row,2.)*0.5), row))), fs) * (0.7 + 0.3*smoothstep(0., 0.15, fract(vW.z*2.6))) * (0.85+0.15*smoothstep(0.,0.08,tile)*smoothstep(0.,0.08,1.-tile));
  }
  if (n.z > 0.7 && vW.x > 0. && vW.y > 0. && vW.x < uWorld.x && vW.y < uWorld.y) { vec4 d = texture(uDecal, vW.xy/uWorld.xy); c = c*(1.-d.a) + d.rgb; }
  o = vec4(fogged(lighting(c, n, vW, 1.), vW.xy), 1.);
}`;

export const VS_DEPTH = `#version 300 es
layout(location=0) in vec3 aPos;
uniform mat4 uVP;
void main(){ gl_Position = uVP*vec4(aPos,1.); }`;
export const FS_DEPTH = `#version 300 es
precision highp float;
void main(){}`;

// instanced, lightly animated low-poly figures and vehicles
export const VS_UNIT = `#version 300 es
layout(location=0) in vec3 aPos; layout(location=1) in vec3 aNormal; layout(location=2) in float aPart; layout(location=3) in vec4 aColor;
layout(location=4) in vec4 iPosYaw; layout(location=5) in vec2 iSP; layout(location=6) in vec4 iColor; layout(location=7) in vec4 iAnim;
uniform mat4 uVP; uniform float uTime; uniform float uShadowPass; uniform vec3 uSun;
uniform vec4 uPivot; // hip z, shoulder x, shoulder z, swing
uniform float uRecoil;
out vec3 vW; out vec3 vN; out vec3 vC; out float vFlash;
vec2 rot(vec2 v, float a){ float c=cos(a), s=sin(a); return vec2(v.x*c - v.y*s, v.x*s + v.y*c); }
void main(){
  vec3 p = aPos; vec3 n = aNormal;
  float walk = iAnim.x, atk = iAnim.y, ph = iSP.y;
  if (aPart > 0.5) {
    if (aPart < 2.5) { float a = sin(ph + (aPart < 1.5 ? 0. : 3.1416))*0.75*walk; p.z -= uPivot.x; p.xz = rot(p.xz, a); p.z += uPivot.x; }
    else if (aPart < 3.5) { p.x -= uPivot.y; p.z -= uPivot.z; p.xz = rot(p.xz, -atk*uPivot.w); p.x += uPivot.y - atk*uRecoil; p.z += uPivot.z; }
    else if (aPart < 5.5) { p.y += sin(uTime*5. + p.x*3. + ph)*0.16*clamp(-p.x-0.2, 0., 1.); }
    else { p.xy = rot(p.xy, uTime*27.); }
  }
  p.z += abs(sin(ph))*0.07*walk;
  float tilt = iAnim.z*6.2832;
  if (tilt > 0.001) { p.xz = rot(p.xz, tilt); n.xz = rot(n.xz, tilt); }
  p *= iSP.x;
  p.xy = rot(p.xy, iPosYaw.w); n.xy = rot(n.xy, iPosYaw.w);
  vec3 w = iPosYaw.xyz + p;
  if (uShadowPass > 0.5) { w.xy -= uSun.xy/uSun.z*max(w.z - iPosYaw.z, 0.); w.z = iPosYaw.z + 0.07; }
  vW = w; vN = n; vC = aColor.rgb*iColor.rgb; vFlash = iColor.a;
  gl_Position = uVP*vec4(w,1.);
}`;

export const FS_UNIT = `#version 300 es
precision highp float;
in vec3 vW; in vec3 vN; in vec3 vC; in float vFlash; out vec4 o;
uniform float uShadowPass; uniform float uLift;
${LIGHT}
void main(){
  if (uShadowPass > 0.5) { o = vec4(0.,0.,0.,0.34); return; }
  vec3 n = normalize(vN);
  vec3 c = lighting(vC, n, vW, 1.);
  c += vC*uLift*(0.55+0.45*n.z);                   // keep figures readable at night
  c = mix(c, vec3(1.), vFlash*0.8);
  o = vec4(fogged(c, vW.xy), 1.);
}`;

// billboards (mode 0), streaks stretched along a world axis (1) and ground-hugging quads (2)
export const VS_PART = `#version 300 es
layout(location=0) in vec2 aCorner;
layout(location=1) in vec3 aPos; layout(location=2) in vec4 aSRS; layout(location=3) in vec4 aColor; layout(location=4) in vec2 aAM; layout(location=5) in vec3 aAxis;
uniform mat4 uVP; uniform vec2 uK; uniform float uZoom; uniform float uCols; uniform float uMinPx;
out vec2 vUV; out vec4 vColor; out float vAdd;
void main(){
  vec4 c0 = uVP*vec4(aPos,1.);
  float mn = uMinPx/uZoom;
  if (aAM.y < 0.5) {
    vec2 sz = max(aSRS.xy, vec2(mn));
    float c=cos(aSRS.z), s=sin(aSRS.z); vec2 q = aCorner*sz; q = vec2(q.x*c - q.y*s, q.x*s + q.y*c);
    gl_Position = c0 + vec4(q*uK, 0., 0.);
  } else if (aAM.y < 1.5) {
    vec4 c1 = uVP*vec4(aPos + aAxis,1.);
    vec2 d = (c1.xy - c0.xy)/uK; float len = length(d); vec2 dir = len > 1e-5 ? d/len : vec2(1.,0.); vec2 nr = vec2(-dir.y, dir.x);
    vec2 q = dir*aCorner.x*max(len, mn*2.) + nr*aCorner.y*max(aSRS.y, mn);
    gl_Position = (c0+c1)*0.5 + vec4(q*uK, 0., 0.);
  } else {
    float c=cos(aSRS.z), s=sin(aSRS.z); vec2 q = aCorner*aSRS.xy; q = vec2(q.x*c - q.y*s, q.x*s + q.y*c);
    gl_Position = uVP*vec4(aPos + vec3(q, 0.),1.);
  }
  gl_Position.z -= 0.0005;
  float col = mod(aSRS.w, uCols), row = floor(aSRS.w/uCols);
  vUV = (vec2(col,row) + 0.5 + aCorner*0.96)/uCols;
  vColor = aColor; vAdd = aAM.x;
}`;

export const FS_PART = `#version 300 es
precision highp float;
uniform sampler2D uAtlas; uniform vec3 uTint;
in vec2 vUV; in vec4 vColor; in float vAdd;
out vec4 o;
void main(){
  vec4 t = texture(uAtlas, vUV);
  float a = t.a*vColor.a;
  if (a < 0.003) discard;
  vec3 rgb = vColor.rgb * mix(uTint, vec3(1.), vAdd);
  o = vec4(rgb*a, a*(1.-vAdd));
}`;

// flat top-down sprite stamp, used to burn decals into the ground texture
export const VS_STAMP = `#version 300 es
layout(location=0) in vec2 aCorner;
layout(location=1) in vec4 aPSR; layout(location=2) in float aSprite; layout(location=3) in vec4 aColor;
uniform vec2 uWorld2; uniform float uCols;
out vec2 vUV; out vec4 vColor;
void main(){
  float c = cos(aPSR.w), s = sin(aPSR.w); vec2 q = aCorner*aPSR.z;
  vec2 p = aPSR.xy + vec2(q.x*c - q.y*s, q.x*s + q.y*c);
  float col = mod(aSprite, uCols), row = floor(aSprite/uCols);
  vUV = (vec2(col,row) + 0.5 + aCorner*0.97)/uCols; vColor = aColor;
  gl_Position = vec4(p/uWorld2*2.-1., 0., 1.);
}`;
export const FS_STAMP = `#version 300 es
precision highp float;
uniform sampler2D uAtlas;
in vec2 vUV; in vec4 vColor; out vec4 o;
void main(){ vec4 t = texture(uAtlas, vUV); o = vec4(t.rgb*vColor.rgb, t.a)*vColor.a; }`;

export const FS_BRIGHT = `#version 300 es
precision highp float;
uniform sampler2D uTex; in vec2 vUV; out vec4 o;
void main(){ vec3 c = texture(uTex, vUV).rgb; float l = max(c.r, max(c.g, c.b)); o = vec4(c*smoothstep(0.62, 0.95, l), 1.); }`;

export const FS_BLUR = `#version 300 es
precision highp float;
uniform sampler2D uTex; uniform vec2 uDir; in vec2 vUV; out vec4 o;
void main(){
  vec3 c = texture(uTex, vUV).rgb*0.227;
  c += (texture(uTex, vUV+uDir*1.385).rgb + texture(uTex, vUV-uDir*1.385).rgb)*0.316;
  c += (texture(uTex, vUV+uDir*3.231).rgb + texture(uTex, vUV-uDir*3.231).rgb)*0.07;
  o = vec4(c,1.);
}`;

export const FS_COMPOSITE = `#version 300 es
precision highp float;
uniform sampler2D uTex; uniform sampler2D uBloom; uniform float uBloomK; uniform float uFlash;
in vec2 vUV; out vec4 o;
void main(){
  vec3 c = texture(uTex, vUV).rgb + texture(uBloom, vUV).rgb*uBloomK;
  c = mix(c, c*c*(3.-2.*c), 0.22);                 // a touch more contrast
  vec2 q = vUV-0.5; c *= 1. - dot(q,q)*0.55;       // vignette
  c += uFlash;
  o = vec4(c,1.);
}`;
