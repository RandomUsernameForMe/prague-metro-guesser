import { toLocalMeters } from './geo.mjs';

const STEP = 5; // m

export function samplePolyline(pts, step = STEP) {
  const out = [pts[0]];
  for (let i = 1; i < pts.length; i++) {
    const [ax, ay] = pts[i - 1], [bx, by] = pts[i];
    const len = Math.hypot(bx - ax, by - ay);
    for (let d = step; d < len; d += step) out.push([ax + ((bx - ax) * d) / len, ay + ((by - ay) * d) / len]);
    out.push([bx, by]);
  }
  return out;
}

function distToSeg([px, py], [ax, ay], [bx, by]) {
  const dx = bx - ax, dy = by - ay;
  const l2 = dx * dx + dy * dy;
  if (!l2) return Math.hypot(px - ax, py - ay);
  const t = Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / l2));
  return Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
}

function minDistToPolyline(p, poly) {
  if (poly.length === 1) return Math.hypot(p[0] - poly[0][0], p[1] - poly[0][1]);
  let min = Infinity;
  for (let i = 1; i < poly.length; i++) min = Math.min(min, distToSeg(p, poly[i - 1], poly[i]));
  return min;
}

function meanMinDist(from, to) {
  const samples = samplePolyline(from);
  return samples.reduce((s, p) => s + minDistToPolyline(p, to), 0) / samples.length;
}

// symetrická: průměr obou směrů — tečka u osy nevyhraje
export function symmetricDistance(player, axis) {
  return (meanMinDist(player, axis) + meanMinDist(axis, player)) / 2;
}

// playerLatLng: [[lat,lng],...], station: {lat,lng,axes:[[[lat,lng],...],...]}
export function scoreRound(playerLatLng, station) {
  const toM = pts => pts.map(([lat, lng]) => toLocalMeters(lat, lng, station));
  const player = toM(playerLatLng);
  const d = Math.min(...station.axes.map(axis => symmetricDistance(player, toM(axis))));
  return { d, score: Math.round(1000 * Math.exp(-d / 85)) };
}
