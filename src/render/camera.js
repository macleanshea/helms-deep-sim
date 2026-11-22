// Isometric camera: an orthographic view pitched down at a fixed angle that can yaw
// around the vertical axis. World space is x east, y south, z up (metres).
//
// cam = { x, y, zoom, yaw }: the ground point at screen centre, pixels per metre, heading.

export const PITCH = 0.84;                 // radians below the horizon (~48 deg)
export const SIN_P = Math.sin(PITCH), COS_P = Math.cos(PITCH);
export const DEFAULT_YAW = Math.PI / 4;    // viewer stands south-west of the wall, looking north-east

/** World point -> screen pixels (same units as vw/vh and cam.zoom). */
export function toScreen(cam, vw, vh, x, y, z, out) {
  const c = Math.cos(cam.yaw), s = Math.sin(cam.yaw), dx = x - cam.x, dy = y - cam.y;
  out[0] = vw / 2 + (c * dx + s * dy) * cam.zoom;
  out[1] = vh / 2 + ((-s * dx + c * dy) * SIN_P - z * COS_P) * cam.zoom;
  return out;
}

/** Screen pixel -> the world point at height z under it. */
export function toGround(cam, vw, vh, sx, sy, z, out) {
  const c = Math.cos(cam.yaw), s = Math.sin(cam.yaw);
  const rx = (sx - vw / 2) / cam.zoom, ry = ((sy - vh / 2) / cam.zoom + z * COS_P) / SIN_P;
  out[0] = cam.x + c * rx - s * ry;
  out[1] = cam.y + s * rx + c * ry;
  return out;
}

/** Screen pixel -> first surface under it (walks the view ray down through the height function). */
export function pick(cam, vw, vh, sx, sy, heightFn, out) {
  for (let z = 64; z >= -3; z -= 0.5) {
    toGround(cam, vw, vh, sx, sy, z, out);
    const h = heightFn(out[0], out[1]);
    if (h >= z) { out[2] = h; toGround(cam, vw, vh, sx, sy, Math.min(h, z + 0.5), out); return out; }
  }
  toGround(cam, vw, vh, sx, sy, 0, out); out[2] = 0;
  return out;
}

/** Column-major view-projection matrix for WebGL. */
export function viewMatrix(cam, vw, vh, sinP = SIN_P, cosP = COS_P, out = new Float32Array(16)) {
  const c = Math.cos(cam.yaw), s = Math.sin(cam.yaw);
  const kx = (2 * cam.zoom) / vw, ky = (2 * cam.zoom) / vh, kz = 1 / 2600;
  // rx = c*dx + s*dy ; ry = -s*dx + c*dy
  // clip.x = rx*kx ; clip.y = -(ry*sinP - z*cosP)*ky ; clip.z = -(ry*cosP + z*sinP)*kz
  out[0] = c * kx;  out[4] = s * kx;   out[8] = 0;           out[12] = -(c * cam.x + s * cam.y) * kx;
  out[1] = s * sinP * ky; out[5] = -c * sinP * ky; out[9] = cosP * ky; out[13] = (-s * cam.x + c * cam.y) * sinP * ky;
  out[2] = s * cosP * kz; out[6] = -c * cosP * kz; out[10] = -sinP * kz; out[14] = (-s * cam.x + c * cam.y) * cosP * kz;
  out[3] = 0; out[7] = 0; out[11] = 0; out[15] = 1;
  return out;
}
