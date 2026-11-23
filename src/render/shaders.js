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

// Lighting. Colours come in and go out in display space; the sums are done in linear light:
// a sky/ground ambient, the sun or moon with a soft shadow, up to six flash lights, and a specular
// lobe whose width and strength come from the material. The view direction is constant (the camera
// is orthographic), so the highlights cost almost nothing.
const LIGHT = `
uniform vec3 uSun; uniform vec3 uSunCol; uniform vec3 uAmb; uniform vec3 uView; uniform float uWet; uniform float uExposure;
uniform mat4 uShadowVP; uniform highp sampler2DShadow uShadow; uniform float uShadowOn; uniform float uShadowTexel;
uniform vec4 uLPos[6]; uniform vec3 uLCol[6];
float shadowAt(vec3 wp, float ndl){
  if (uShadowOn < .5) return 1.;
  vec4 sc = uShadowVP*vec4(wp,1.); vec3 p = sc.xyz*0.5+0.5;
  if (p.x<0.||p.x>1.||p.y<0.||p.y>1.||p.z>1.||p.z<0.) return 1.;
  float z = p.z - (0.0016 + 0.005*(1.-ndl)), e = uShadowTexel;
  return 0.25*(texture(uShadow, vec3(p.xy+vec2(-e, -0.4*e), z)) + texture(uShadow, vec3(p.xy+vec2(0.4*e, -e), z))
             + texture(uShadow, vec3(p.xy+vec2(e, 0.4*e), z)) + texture(uShadow, vec3(p.xy+vec2(-0.4*e, e), z)));
}
vec3 shade(vec3 albedo, vec3 n, vec3 wp, float rough, float spec, float ao){
  vec3 a = albedo*albedo;
  float ndl = max(dot(n,uSun),0.);
  float sh = shadowAt(wp, ndl);
  float gl = 1.-rough, pw = 6. + gl*gl*220., sk = spec*min((pw+8.)*0.011, 1.1);
  vec3 l = mix(uAmb*vec3(0.62,0.57,0.5), uAmb, n.z*0.5+0.5)*ao + uSunCol*ndl*mix(0.1, 1., sh);
  vec3 s = uSunCol*pow(max(dot(n, normalize(uSun+uView)),0.), pw)*sk*sh*step(1e-4, ndl);
  s += uAmb*spec*gl*0.35*pow(1.-max(dot(n,uView),0.), 3.);                 // the sky caught at grazing angles
  for (int i=0;i<6;i++){
    vec3 d = uLPos[i].xyz - wp; float r = uLPos[i].w; float att = max(0., 1. - dot(d,d)/(r*r)); att *= att;
    if (att <= 0.) continue;
    vec3 ld = normalize(d);
    l += uLCol[i]*att*(0.35+0.65*max(dot(n, ld),0.));
    s += uLCol[i]*att*pow(max(dot(n, normalize(ld+uView)),0.), pw)*sk;
  }
  vec3 c = (a*l + s)*uExposure;
  return sqrt(c/(1.+0.22*c));
}
uniform vec3 uFog; uniform vec4 uWorld; // world w,h and fade distances
vec3 fogged(vec3 c, vec2 wxy){
  vec2 o = max(max(-wxy, wxy - uWorld.xy), vec2(0.));
  return mix(c, uFog, smoothstep(uWorld.z, uWorld.w, length(o)));
}
`;

// Material lookup (see materials.js): layer L sampled at q metres along the surface.
const MATERIAL = `
uniform mediump sampler2DArray uMatA; uniform mediump sampler2DArray uMatB; uniform float uMatScale[16]; uniform vec3 uMatMean[16];
vec4 matA(float L, vec2 q, vec2 dx, vec2 dy){ float k = uMatScale[int(L)]; vec4 t = textureGrad(uMatA, vec3(q*k, L), dx*k, dy*k); return vec4(t.rgb/uMatMean[int(L)], t.a); }
vec4 matB(float L, vec2 q, vec2 dx, vec2 dy){ float k = uMatScale[int(L)]; return textureGrad(uMatB, vec3(q*k, L), dx*k, dy*k); }
`;

const NOISE_LITE = `
float hash(vec2 p){ p = fract(p*vec2(123.34,456.21)); p += dot(p,p+45.32); return fract(p.x*p.y); }
float noise(vec2 p){ vec2 i=floor(p), f=fract(p); f=f*f*(3.-2.*f); return mix(mix(hash(i),hash(i+vec2(1,0)),f.x), mix(hash(i+vec2(0,1)),hash(i+vec2(1,1)),f.x), f.y); }
float fbm3(vec2 p){ float s=0., a=.5; for(int i=0;i<3;i++){ s+=a*noise(p); p=p*2.07+11.; a*=.5; } return s/0.875; }
`;

export const VS_TERRAIN = `#version 300 es
layout(location=0) in vec3 aPos; layout(location=1) in vec3 aNormal;
uniform mat4 uVP;
out vec3 vW; out vec3 vN;
void main(){ vW = aPos; vN = aNormal; gl_Position = uVP*vec4(aPos,1.); }`;

export const FS_TERRAIN = `#version 300 es
precision highp float;
in vec3 vW; in vec3 vN; out vec4 o;
uniform sampler2D uAlbedo; uniform sampler2D uDecal; uniform sampler2D uHM; uniform vec4 uAlbRect; uniform float uTime;
${NOISE_LITE}${LIGHT}${MATERIAL}
void main(){
  vec3 n = normalize(vN);
  vec2 uv = (vW.xy - uAlbRect.xy)/uAlbRect.zw;
  vec3 c = texture(uAlbedo, uv).rgb;                  // broad colour, baked once from the masks
  vec4 m = texture(uHM, uv);                          // height, rock, dirt, water
  vec3 dpx = dFdx(vW), dpy = dFdy(vW);
  float steep = smoothstep(0.2, 0.5, 1.-n.z);
  // close-up detail from the material layers, blended by the same masks
  float wr = smoothstep(0.3, 0.7, m.g), wd = clamp(m.b*1.25, 0., 1.)*(1.-wr), wg = (1.-wr)*(1.-wd);
  vec4 A = vec4(0.), B = vec4(0.);
  if (wg > 0.02) { A += wg*matA(4., vW.xy, dpx.xy, dpy.xy); B += wg*matB(4., vW.xy, dpx.xy, dpy.xy); }
  if (wd > 0.02) { A += wd*matA(5., vW.xy, dpx.xy, dpy.xy); B += wd*matB(5., vW.xy, dpx.xy, dpy.xy); }
  if (wr > 0.02) { A += wr*matA(3., vW.xy, dpx.xy, dpy.xy); B += wr*matB(3., vW.xy, dpx.xy, dpy.xy); }
  float ws = max(1e-3, (wg > 0.02 ? wg : 0.) + (wd > 0.02 ? wd : 0.) + (wr > 0.02 ? wr : 0.));
  A /= ws; B /= ws;
  c *= mix(vec3(1.), A.rgb, 0.85);
  vec3 nd = normalize(n + vec3(B.xy*2.-1., 0.)*0.85);
  float rough = B.z, spec = B.w;
  // steep faces: the top-down texture smears, so texture them side-on as rock, from both horizontal axes
  if (steep > 0.01) {
    float wx = n.x*n.x, wy = n.y*n.y, wsum = wx + wy + 1e-4; wx /= wsum; wy /= wsum;
    vec4 a1 = matA(3., vW.yz, dpx.yz, dpy.yz), a2 = matA(3., vW.xz, dpx.xz, dpy.xz);
    vec4 b1 = matB(3., vW.yz, dpx.yz, dpy.yz), b2 = matB(3., vW.xz, dpx.xz, dpy.xz);
    // the same layer much larger gives the face its big fractures and hides the repeat
    vec3 big = wx*matA(3., vW.yz*0.21, dpx.yz*0.21, dpy.yz*0.21).rgb + wy*matA(3., vW.xz*0.21, dpx.xz*0.21, dpy.xz*0.21).rgb;
    vec3 rk = vec3(0.43,0.42,0.40) * (wx*a1.rgb + wy*a2.rgb) * mix(vec3(1.), big, 0.75);
    rk *= 0.86 + 0.28*noise(vW.xy*0.021 + vW.z*0.013);
    rk *= 1. - 0.25*smoothstep(0.55, 0.95, noise(vec2((vW.x + vW.y)*0.3, vW.z*0.012 + 3.)));   // rain streaks
    vec2 p1 = b1.xy*2.-1., p2 = b2.xy*2.-1.;
    vec3 ns = normalize(n + (vec3(0., p1.x, p1.y)*wx + vec3(p2.x, 0., p2.y)*wy)*0.9);
    c = mix(c, rk, steep*0.94); nd = normalize(mix(nd, ns, steep));
    rough = mix(rough, wx*b1.z + wy*b2.z, steep); spec = mix(spec, wx*b1.w + wy*b2.w, steep);
  }
  // a dusting of old snow on the high shelves of the mountain
  if (vW.z > 100.) {
    float snow = smoothstep(175., 230., vW.z + (fbm3(vW.xy*0.015)-.5)*70.) * smoothstep(0.6, 0.85, n.z) * smoothstep(0.35, 0.6, fbm3(vW.xy*0.05));
    c = mix(c, vec3(0.72,0.74,0.78)*(0.85+0.2*noise(vW.xy*0.4)), snow*0.75);
    rough = mix(rough, 0.6, snow); nd = normalize(mix(nd, n, snow*0.7));
  }
  // rain soaks level ground: darker and glossier
  float wet = uWet*smoothstep(0.5, 0.9, n.z)*(0.4 + 0.6*wd);
  c *= 1. - 0.22*wet; rough = mix(rough, rough*0.45, wet); spec = mix(spec, max(spec, 0.5), wet);
  // water: a dark, moving surface that catches what light there is
  if (m.a > 0.3) {
    float w = smoothstep(0.3, 0.7, m.a);
    float r1 = noise(vec2(vW.x*0.5, vW.y*1.6 - uTime*1.7)), r2 = noise(vec2(vW.x*1.3 + uTime*0.6, vW.y*0.7));
    vec3 wc = vec3(0.08,0.11,0.12) + uFog*1.2;
    c = mix(c, wc, w*0.88);
    nd = normalize(mix(nd, vec3((r1-.5)*0.5, (r2-.5)*0.5, 1.), w));
    rough = mix(rough, 0.1, w); spec = mix(spec, 1., w);
  }
  if (vW.x > 0. && vW.y > 0. && vW.x < uWorld.x && vW.y < uWorld.y) { vec4 d = texture(uDecal, vW.xy/uWorld.xy); c = c*(1.-d.a) + d.rgb; rough = mix(rough, 0.85, d.a); }
  o = vec4(fogged(shade(c, nd, vW, rough, spec, 1.), vW.xy), 1.);
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
out vec3 vW; out vec3 vN; out vec3 vC; flat out float vMat;
void main(){ vW = aPos; vN = aNormal; vC = aColor.rgb; vMat = aColor.a*255.; gl_Position = uVP*vec4(aPos,1.); }`;

// The fortress. Each face is textured from whichever axis it faces most squarely, in world space, so
// courses of masonry run level and line up from one piece of wall to the next.
export const FS_STRUCT = `#version 300 es
precision highp float;
in vec3 vW; in vec3 vN; in vec3 vC; flat in float vMat; out vec4 o;
uniform sampler2D uDecal;
${NOISE_LITE}${LIGHT}${MATERIAL}
void main(){
  vec3 n = normalize(vN); vec3 c = vC;
  float id = floor(vMat + 0.5);
  if (id == 16.) { o = vec4(c, 1.); return; }
  float L = id > 16.5 ? 7. : id;
  vec3 an = abs(n), dpx = dFdx(vW), dpy = dFdy(vW);
  bool top = an.z > (L == 8. ? 0.96 : 0.6);
  vec2 q, qx, qy; vec3 T, Bt; float u;
  if (top) { q = vW.xy; qx = dpx.xy; qy = dpy.xy; T = vec3(1.,0.,0.); Bt = vec3(0.,1.,0.); u = vW.x + vW.y; if (L == 1.) L = 2.; }
  else if (an.x > an.y) { q = vW.yz; qx = dpx.yz; qy = dpy.yz; T = vec3(0.,1.,0.); Bt = vec3(0.,0.,1.); u = vW.y; }
  else { q = vW.xz; qx = dpx.xz; qy = dpy.xz; T = vec3(1.,0.,0.); Bt = vec3(0.,0.,1.); u = vW.x; }
  if (id > 16.5) { q = q.yx; qx = qx.yx; qy = qy.yx; vec3 t = T; T = Bt; Bt = t; }
  vec4 A = matA(L, q, qx, qy), B = matB(L, q, qx, qy);
  c *= A.rgb;
  vec2 bn = B.xy*2.-1.;
  n = normalize(n + (T*bn.x + Bt*bn.y)*0.9);
  float rough = B.z, spec = B.w;
  if (L < 2.5) {
    c *= 0.9 + 0.2*fbm3(vec2(u, vW.z)*0.11 + 3.);                       // broad weathering hides the repeat
    if (!top) {
      // rain streaks running down from the parapets, damp and moss at the foot
      c *= 1. - 0.2*smoothstep(0.5, 0.9, noise(vec2(u*0.9, vW.z*0.06)));
      c = mix(c, vec3(0.2,0.24,0.15), smoothstep(3.5, 0., vW.z - 0.5*noise(vec2(u*0.5, 1.)))*0.35*smoothstep(0.4, 0.7, noise(vec2(u*0.35, 7.))));
    }
    float wet = uWet*(top ? 1. : 0.35);
    c *= 1. - 0.2*wet; rough = mix(rough, rough*0.45, wet); spec = mix(spec, max(spec, 0.45), wet);
  }
  if (vN.z > 0.7 && vW.x > 0. && vW.y > 0. && vW.x < uWorld.x && vW.y < uWorld.y) { vec4 d = texture(uDecal, vW.xy/uWorld.xy); c = c*(1.-d.a) + d.rgb; }
  o = vec4(fogged(shade(c, n, vW, rough, spec, 1.), vW.xy), 1.);
}`;

export const VS_DEPTH = `#version 300 es
layout(location=0) in vec3 aPos;
uniform mat4 uVP;
void main(){ gl_Position = uVP*vec4(aPos,1.); }`;
export const FS_DEPTH = `#version 300 es
precision highp float;
void main(){}`;

// Instanced figures, vehicles and props, animated in the vertex shader by "part":
//   1/2 thighs and 7/8 shins (walk cycle with a knee), 3 weapon arm and 10 forearm (strike / recoil),
//   4 free arm (swings with the stride), 5 banner, 6 main rotor, 9 tail rotor.
export const VS_UNIT = `#version 300 es
layout(location=0) in vec3 aPos; layout(location=1) in vec3 aNormal; layout(location=2) in float aPart; layout(location=3) in vec4 aColor;
layout(location=4) in vec4 iPosYaw; layout(location=5) in vec2 iSP; layout(location=6) in vec4 iColor; layout(location=7) in vec4 iAnim;
uniform mat4 uVP; uniform float uTime; uniform float uShadowPass; uniform vec3 uSun;
uniform vec4 uPivot;  // hip z, shoulder x, shoulder z, swing
uniform vec4 uPivot2; // knee z, rotor x, elbow (or tail rotor) x and z
uniform float uRecoil; uniform float uLegX; // fore-and-aft offset of the leg pivots on four-legged creatures
out vec3 vW; out vec3 vN; out vec3 vC; out float vFlash; out vec3 vO; out vec3 vNo; flat out float vMat; flat out vec2 vYaw;
vec2 rot(vec2 v, float a){ float c=cos(a), s=sin(a); return vec2(v.x*c - v.y*s, v.x*s + v.y*c); }
void main(){
  vec3 p = aPos; vec3 n = aNormal;
  float walk = iAnim.x, atk = iAnim.y, ph = iSP.y;
  if (aPart > 0.5) {
    bool shin = aPart > 6.5 && aPart < 8.5;
    if (aPart < 2.5 || shin) {
      float lp = ph + ((aPart < 1.5 || (aPart > 6.5 && aPart < 7.5)) ? 0. : 3.1416);
      if (shin) { float b = max(0., cos(lp))*0.95*walk; p.z -= uPivot2.x; p.xz = rot(p.xz, -b); n.xz = rot(n.xz, -b); p.z += uPivot2.x; }
      float lx = uLegX*sign(aPos.x), a = sin(lp)*0.62*walk; p.x -= lx; p.z -= uPivot.x; p.xz = rot(p.xz, a); n.xz = rot(n.xz, a); p.x += lx; p.z += uPivot.x;
    }
    else if (aPart < 3.5 || aPart > 9.5) {
      if (aPart > 9.5) { float e = -atk*uPivot.w*0.45; p.x -= uPivot2.z; p.z -= uPivot2.w; p.xz = rot(p.xz, e); n.xz = rot(n.xz, e); p.x += uPivot2.z; p.z += uPivot2.w; }
      float a = -atk*uPivot.w; p.x -= uPivot.y; p.z -= uPivot.z; p.xz = rot(p.xz, a); n.xz = rot(n.xz, a); p.x += uPivot.y - atk*uRecoil; p.z += uPivot.z;
    }
    else if (aPart < 4.5) { float a = -sin(ph)*0.5*walk; p.z -= uPivot.z; p.xz = rot(p.xz, a); n.xz = rot(n.xz, a); p.z += uPivot.z; }
    else if (aPart < 5.5) { p.y += sin(uTime*5. + p.x*3. + ph)*0.16*clamp(-p.x-0.2, 0., 1.); }
    else if (aPart < 6.5) { p.x -= uPivot2.y; p.xy = rot(p.xy, uTime*27.); n.xy = rot(n.xy, uTime*27.); p.x += uPivot2.y; }
    else { p.x -= uPivot2.z; p.z -= uPivot2.w; p.xz = rot(p.xz, uTime*41.); n.xz = rot(n.xz, uTime*41.); p.x += uPivot2.z; p.z += uPivot2.w; }
  }
  p.z += abs(sin(ph))*0.07*walk;
  float tilt = iAnim.z*6.2832;
  if (tilt > 0.001) { p.xz = rot(p.xz, tilt); n.xz = rot(n.xz, tilt); }
  p *= iSP.x;
  float cy = cos(iPosYaw.w), sy = sin(iPosYaw.w);
  p.xy = vec2(p.x*cy - p.y*sy, p.x*sy + p.y*cy); n.xy = vec2(n.x*cy - n.y*sy, n.x*sy + n.y*cy);
  vec3 w = iPosYaw.xyz + p;
  if (uShadowPass > 0.5) { w.xy -= uSun.xy/uSun.z*max(w.z - iPosYaw.z, 0.); w.z = iPosYaw.z + 0.07; }
  vW = w; vN = n; vC = aColor.rgb*iColor.rgb; vFlash = iColor.a; vO = aPos; vNo = aNormal; vMat = aColor.a*255.; vYaw = vec2(cy, sy);
  gl_Position = uVP*vec4(w,1.);
}`;

export const FS_UNIT = `#version 300 es
precision highp float;
in vec3 vW; in vec3 vN; in vec3 vC; in float vFlash; in vec3 vO; in vec3 vNo; flat in float vMat; flat in vec2 vYaw; out vec4 o;
uniform float uShadowPass; uniform float uLift; uniform float uMatOn;
${LIGHT}${MATERIAL}
void main(){
  if (uShadowPass > 0.5) { o = vec4(0.,0.,0.,0.34); return; }
  vec3 n = normalize(vN), c = vC;
  float id = floor(vMat + 0.5), rough = 0.8, spec = 0.12;
  if (id == 16.) { o = vec4(mix(c*1.4, vec3(1.), vFlash*0.8), 1.); return; }
  if (uMatOn > 0.5) {
    // textured in the model's own space, so the pattern stays put on a moving limb
    float L = id > 16.5 ? 7. : id;
    vec3 an = abs(vNo), dpx = dFdx(vO), dpy = dFdy(vO);
    vec2 q, qx, qy; vec3 T, Bt;
    if (an.z > an.x && an.z > an.y) { q = vO.xy; qx = dpx.xy; qy = dpy.xy; T = vec3(1.,0.,0.); Bt = vec3(0.,1.,0.); }
    else if (an.x > an.y) { q = vO.yz; qx = dpx.yz; qy = dpy.yz; T = vec3(0.,1.,0.); Bt = vec3(0.,0.,1.); }
    else { q = vO.xz; qx = dpx.xz; qy = dpy.xz; T = vec3(1.,0.,0.); Bt = vec3(0.,0.,1.); }
    if (id > 16.5) { q = q.yx; qx = qx.yx; qy = qy.yx; vec3 t = T; T = Bt; Bt = t; }
    vec4 A = matA(L, q, qx, qy), B = matB(L, q, qx, qy);
    c *= A.rgb;
    vec2 bn = B.xy*2.-1.; vec3 d = T*bn.x + Bt*bn.y;
    d.xy = vec2(d.x*vYaw.x - d.y*vYaw.y, d.x*vYaw.y + d.y*vYaw.x);
    n = normalize(n + d*0.8); rough = B.z; spec = B.w;
  }
  vec3 col = shade(c, n, vW, rough, spec, 1.);
  col += vC*uLift*(0.55+0.45*n.z);                   // keep figures readable at night
  col = mix(col, vec3(1.), vFlash*0.8);
  o = vec4(fogged(col, vW.xy), 1.);
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
