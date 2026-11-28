// The camera: a perspective view that looks down on a point on the ground, steeply from far off and
// ever lower as it closes in. World space is x east, y south, z up (metres).
//
// cam = { x, y, zoom, yaw, tilt?, z?, dpr?, ground? }
//   x, y    the ground point at the centre of the view (z: its height, 0 if absent)
//   zoom    pixels per metre at that point, in the same pixels as vw and vh. It is still the one number
//           that says how close the view is: the camera's distance is derived from it
//   yaw     heading, as before: with yaw 0 the view looks north (-y)
//   tilt    radians added to the pitch the zoom gives (0 if absent)
//   dpr     device pixels per CSS pixel, when zoom is in device pixels (the pitch follows the CSS zoom)
//   ground  optional (x, y) -> height: the camera is lifted clear of it, never left inside a mountain
//
// Everything is derived from those by `camState`; the functions below take the same arguments the
// old orthographic ones did, so a caller that only projects points need not know the difference.

export const DEFAULT_YAW = 1.2;        // viewer stands in the valley looking up it (east), the Hornburg on the right
export const FOV = 0.52;               // vertical field of view (radians, about 30 degrees): narrow, so far ranks do not shrink to nothing
export const PITCH_FAR = 0.98;         // radians below the horizon with the whole valley in view (about 56 degrees)
export const PITCH_NEAR = 0.34;        // and with a platoon filling the screen (about 19 degrees)
const ZOOM_FAR = 1.2, ZOOM_NEAR = 44;  // the CSS zooms between which the pitch eases from one to the other
const PITCH_MAX = 1.48, PITCH_MIN = 0.16;
const FAR_REACH = 4200;                // how far beyond the point of interest the view reaches (m)

/** The pitch (radians below the horizon) that goes with a zoom in CSS px per metre. */
export function pitchFor(zoom) {
  let t = Math.log(Math.max(zoom, 1e-3) / ZOOM_FAR) / Math.log(ZOOM_NEAR / ZOOM_FAR);
  t = t < 0 ? 0 : t > 1 ? 1 : t;
  t = t * t * (3 - 2 * t);
  return PITCH_FAR + (PITCH_NEAR - PITCH_FAR) * t;
}

/**
 * The camera's place and axes for this view: eye (ex, ey, ez), unit vectors right (rx, ry, 0), up (ux, uy, uz) and
 * forward (fx, fy, fz), the focal length `f` in pixels, the distance to the point of interest, the pitch in use, and
 * the near and far planes. Worked out once and kept on the camera until it or the viewport changes.
 */
export function camState(cam, vw, vh) {
  let q = cam._q;
  const tz = cam.z || 0, tilt = cam.tilt || 0;
  if (q && q.kx === cam.x && q.ky === cam.y && q.kzoom === cam.zoom && q.kyaw === cam.yaw && q.ktilt === tilt && q.kz === tz && q.kvw === vw && q.kvh === vh) return q;
  if (!q) {
    q = { ex: 0, ey: 0, ez: 0, rx: 0, ry: 0, ux: 0, uy: 0, uz: 0, fx: 0, fy: 0, fz: 0, f: 1, dist: 1, pitch: 0, near: 1, far: 2 };
    Object.defineProperty(cam, '_q', { value: q, enumerable: false, writable: true }); // (not copied by a spread of the camera)
  }
  q.kx = cam.x; q.ky = cam.y; q.kzoom = cam.zoom; q.kyaw = cam.yaw; q.ktilt = tilt; q.kz = tz; q.kvw = vw; q.kvh = vh;
  const c = Math.cos(cam.yaw), s = Math.sin(cam.yaw);
  const f = (vh / 2) / Math.tan(FOV / 2), dist = f / cam.zoom;
  let p = pitchFor(cam.zoom / (cam.dpr || 1)) + tilt;
  p = p < PITCH_MIN ? PITCH_MIN : p > PITCH_MAX ? PITCH_MAX : p;
  // screen right is (c, s); the view looks along (s, -c) over the ground
  let cp, sp, ex, ey, ez;
  for (let tries = 0; ; tries++) {
    cp = Math.cos(p); sp = Math.sin(p);
    ex = cam.x - s * cp * dist; ey = cam.y + c * cp * dist; ez = tz + sp * dist;
    if (!cam.ground || tries >= 28 || p >= PITCH_MAX) break;
    // the boom from the point of interest back to the eye must clear the ground, with the eye well above it
    let clear = ez > cam.ground(ex, ey) + Math.max(3, dist * 0.02);
    for (let u = 0.8; clear && u > 0.3; u -= 0.2) clear = tz + sp * dist * u > cam.ground(cam.x - s * cp * dist * u, cam.y + c * cp * dist * u) + 1;
    if (clear) break;
    p = Math.min(PITCH_MAX, p + 0.05);
  }
  q.ex = ex; q.ey = ey; q.ez = ez;
  q.rx = c; q.ry = s;
  q.fx = s * cp; q.fy = -c * cp; q.fz = -sp;
  q.ux = s * sp; q.uy = -c * sp; q.uz = cp;
  q.f = f; q.dist = dist; q.pitch = p;
  q.near = Math.max(0.4, Math.min(60, dist * 0.04)); q.far = dist + FAR_REACH;
  return q;
}

/**
 * World point -> screen pixels (same units as vw/vh and cam.zoom). out[2] is the scale there, in pixels per
 * metre: it is 0 for a point behind the camera, whose out[0] and out[1] are then far off screen.
 */
export function toScreen(cam, vw, vh, x, y, z, out) {
  const q = camState(cam, vw, vh), dx = x - q.ex, dy = y - q.ey, dz = z - q.ez;
  const w = dx * q.fx + dy * q.fy + dz * q.fz;
  if (w < q.near * 0.5) { out[0] = -1e6; out[1] = -1e6; out[2] = 0; return out; }
  const k = q.f / w;
  out[0] = vw / 2 + (dx * q.rx + dy * q.ry) * k;
  out[1] = vh / 2 - (dx * q.ux + dy * q.uy + dz * q.uz) * k;
  out[2] = k;
  return out;
}

/**
 * Screen pixel -> the world point at height z under it. A pixel above the horizon has no such point: it gets
 * the point on that bearing at the limit of the view, so a drag or a zoom toward the sky still behaves.
 */
export function toGround(cam, vw, vh, sx, sy, z, out) {
  const q = camState(cam, vw, vh), a = sx - vw / 2, b = vh / 2 - sy;
  const dx = q.fx * q.f + q.rx * a + q.ux * b, dy = q.fy * q.f + q.ry * a + q.uy * b, dz = q.fz * q.f + q.uz * b;
  let t = dz < -1e-6 ? (z - q.ez) / dz : Infinity;
  const reach = q.far / Math.hypot(dx, dy, dz);
  if (!(t > 0) || t > reach) t = reach;
  out[0] = q.ex + dx * t; out[1] = q.ey + dy * t;
  return out;
}

/** Screen pixel -> first surface under it: out = [x, y, height]. Walks the view ray until it meets the height function. */
export function pick(cam, vw, vh, sx, sy, heightFn, out) {
  const q = camState(cam, vw, vh), a = sx - vw / 2, b = vh / 2 - sy;
  let dx = q.fx * q.f + q.rx * a + q.ux * b, dy = q.fy * q.f + q.ry * a + q.uy * b, dz = q.fz * q.f + q.uz * b;
  const l = Math.hypot(dx, dy, dz); dx /= l; dy /= l; dz /= l;
  const ex = q.ex, ey = q.ey, ez = q.ez, far = q.far;
  let t = q.near, last = t;
  for (let k = 0; k < 4000 && t < far; k++) {
    const x = ex + dx * t, y = ey + dy * t, z = ez + dz * t, h = heightFn(x, y);
    if (z <= h) {
      // between `last` (above the ground) and `t` (under it): close in by halving
      let lo = last, hi = t;
      for (let j = 0; j < 14; j++) { const m = (lo + hi) / 2; if (ez + dz * m <= heightFn(ex + dx * m, ey + dy * m)) hi = m; else lo = m; }
      out[0] = ex + dx * hi; out[1] = ey + dy * hi; out[2] = heightFn(out[0], out[1]);
      return out;
    }
    last = t;
    // long strides while high above the ground, short ones near it (walls and cliffs are steep)
    t += Math.max(0.25, Math.min(40, (z - h) * 0.35));
  }
  toGround(cam, vw, vh, sx, sy, 0, out); out[2] = 0;
  return out;
}

/** Column-major view-projection matrix for WebGL (perspective). */
export function viewProj(cam, vw, vh, out = new Float32Array(16)) {
  const q = camState(cam, vw, vh), kx = q.f / (vw / 2), ky = q.f / (vh / 2);
  const A = (q.far + q.near) / (q.far - q.near), B = (-2 * q.far * q.near) / (q.far - q.near);
  const er = q.ex * q.rx + q.ey * q.ry, eu = q.ex * q.ux + q.ey * q.uy + q.ez * q.uz, ef = q.ex * q.fx + q.ey * q.fy + q.ez * q.fz;
  out[0] = q.rx * kx; out[4] = q.ry * kx; out[8] = 0;          out[12] = -er * kx;
  out[1] = q.ux * ky; out[5] = q.uy * ky; out[9] = q.uz * ky;  out[13] = -eu * ky;
  out[2] = q.fx * A;  out[6] = q.fy * A;  out[10] = q.fz * A;  out[14] = -ef * A + B;
  out[3] = q.fx;      out[7] = q.fy;      out[11] = q.fz;      out[15] = -ef;
  return out;
}

/**
 * Column-major orthographic matrix looking down at a fixed pitch (sinP, cosP): the minimap's picture of the
 * ground is drawn with it, straight down. cam = { x, y, zoom, yaw }.
 */
export function orthoMatrix(cam, vw, vh, sinP, cosP, out = new Float32Array(16)) {
  const c = Math.cos(cam.yaw), s = Math.sin(cam.yaw);
  const kx = (2 * cam.zoom) / vw, ky = (2 * cam.zoom) / vh, kz = 1 / 2600;
  out[0] = c * kx;  out[4] = s * kx;   out[8] = 0;           out[12] = -(c * cam.x + s * cam.y) * kx;
  out[1] = s * sinP * ky; out[5] = -c * sinP * ky; out[9] = cosP * ky; out[13] = (-s * cam.x + c * cam.y) * sinP * ky;
  out[2] = s * cosP * kz; out[6] = -c * cosP * kz; out[10] = -sinP * kz; out[14] = (-s * cam.x + c * cam.y) * cosP * kz;
  out[3] = 0; out[7] = 0; out[11] = 0; out[15] = 1;
  return out;
}
