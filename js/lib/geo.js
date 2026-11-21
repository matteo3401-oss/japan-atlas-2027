/* Small geodesy helpers. Coordinates are [lon, lat] in degrees. */

const R = 6371.0088; // mean Earth radius, km
const rad = (d) => (d * Math.PI) / 180;
const deg = (r) => (r * 180) / Math.PI;

export function haversineKm(a, b) {
  const dLat = rad(b[1] - a[1]);
  const dLon = rad(b[0] - a[0]);
  const s = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a[1])) * Math.cos(rad(b[1])) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(s)));
}

export function bearing(a, b) {
  const y = Math.sin(rad(b[0] - a[0])) * Math.cos(rad(b[1]));
  const x = Math.cos(rad(a[1])) * Math.sin(rad(b[1])) - Math.sin(rad(a[1])) * Math.cos(rad(b[1])) * Math.cos(rad(b[0] - a[0]));
  return (deg(Math.atan2(y, x)) + 360) % 360;
}

/** Great-circle arc between two points, as a continuous line (longitudes are
 *  unwrapped so the line never jumps across the antimeridian). */
export function greatCircle(a, b, n = 96) {
  const [l1, p1] = [rad(a[0]), rad(a[1])];
  const [l2, p2] = [rad(b[0]), rad(b[1])];
  const d = 2 * Math.asin(Math.sqrt(Math.sin((p2 - p1) / 2) ** 2 + Math.cos(p1) * Math.cos(p2) * Math.sin((l2 - l1) / 2) ** 2));
  const out = [];
  let prev = null;
  for (let i = 0; i <= n; i++) {
    const f = i / n;
    const A = Math.sin((1 - f) * d) / Math.sin(d);
    const B = Math.sin(f * d) / Math.sin(d);
    const x = A * Math.cos(p1) * Math.cos(l1) + B * Math.cos(p2) * Math.cos(l2);
    const y = A * Math.cos(p1) * Math.sin(l1) + B * Math.cos(p2) * Math.sin(l2);
    const z = A * Math.sin(p1) + B * Math.sin(p2);
    let lon = deg(Math.atan2(y, x));
    const lat = deg(Math.atan2(z, Math.sqrt(x * x + y * y)));
    if (prev !== null) {
      while (lon - prev > 180) lon -= 360;
      while (lon - prev < -180) lon += 360;
    }
    prev = lon;
    out.push([lon, lat]);
  }
  return out;
}

/** Pre-computes cumulative distance so a line can be sampled by fraction. */
export function measureLine(coords) {
  const cum = [0];
  for (let i = 1; i < coords.length; i++) cum.push(cum[i - 1] + haversineKm(coords[i - 1], coords[i]));
  return { coords, cum, length: cum[cum.length - 1] };
}

/** Point at fraction t (0..1) along a measured line. */
export function pointAt(line, t) {
  const { coords, cum, length } = line;
  if (coords.length === 1 || length === 0) return coords[0];
  const target = Math.max(0, Math.min(1, t)) * length;
  let lo = 0;
  let hi = cum.length - 1;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (cum[mid] <= target) lo = mid; else hi = mid;
  }
  const seg = cum[hi] - cum[lo] || 1;
  const f = (target - cum[lo]) / seg;
  return [coords[lo][0] + (coords[hi][0] - coords[lo][0]) * f, coords[lo][1] + (coords[hi][1] - coords[lo][1]) * f];
}

/** How far along a measured line (0..1) the point closest to `p` lies. */
export function fractionOf(line, p) {
  const { coords, cum, length } = line;
  if (coords.length < 2 || !length) return 0;
  const k = Math.cos(p[1] * Math.PI / 180);
  let best = Infinity, at = 0;
  for (let i = 1; i < coords.length; i++) {
    const ax = (coords[i - 1][0] - p[0]) * k, ay = coords[i - 1][1] - p[1], bx = (coords[i][0] - p[0]) * k, by = coords[i][1] - p[1];
    const ux = bx - ax, uy = by - ay, f = Math.max(0, Math.min(1, -(ax * ux + ay * uy) / (ux * ux + uy * uy || 1)));
    const d = (ax + ux * f) ** 2 + (ay + uy * f) ** 2;
    if (d < best) { best = d; at = cum[i - 1] + (cum[i] - cum[i - 1]) * f; }
  }
  return at / length;
}

export function boundsOf(points) {
  let w = Infinity, s = Infinity, e = -Infinity, n = -Infinity;
  for (const [x, y] of points) {
    if (x < w) w = x; if (x > e) e = x; if (y < s) s = y; if (y > n) n = y;
  }
  return [[w, s], [e, n]];
}

/** Shortest signed difference between two bearings, in degrees. */
export function angleDelta(from, to) {
  return ((to - from + 540) % 360) - 180;
}

export function formatKm(km) {
  if (km < 1) return `${Math.round(km * 1000 / 10) * 10} m`;
  if (km < 10) return `${km.toFixed(1)} km`;
  return `${Math.round(km)} km`;
}
