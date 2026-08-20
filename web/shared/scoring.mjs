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

const scoreFromDistance = d => Math.round(1000 * Math.exp(-d / 85));

// všechna pořadí prvků (pro 1–2 linky triviální, víc jich v Praze není)
function permutations(items) {
  if (items.length <= 1) return [items];
  return items.flatMap((it, i) =>
    permutations([...items.slice(0, i), ...items.slice(i + 1)]).map(rest => [it, ...rest]));
}

// segments: [[[lat,lng],[lat,lng]], ...] — jedna úsečka na linku stanice
// station: {lat, lng, lines: ['A','B'], axes: [{line, pts}]}
export function scoreRound(segments, station) {
  const toM = pts => pts.map(([lat, lng]) => toLocalMeters(lat, lng, station));
  const segs = segments.map(toM);
  const axesOf = line => station.axes.filter(a => a.line === line).map(a => toM(a.pts));

  // hráč nemusí vědět, která úsečka patří které lince — vezmi pro něj nejlepší přiřazení
  let best = null;
  for (const order of permutations(station.lines)) {
    const perLine = order.map((line, i) => ({
      line,
      d: Math.min(...axesOf(line).map(axis => symmetricDistance(segs[i], axis))),
    }));
    const d = perLine.reduce((s, r) => s + r.d, 0) / perLine.length;
    if (!best || d < best.d) best = { d, perLine };
  }
  return { d: best.d, score: scoreFromDistance(best.d), perLine: best.perLine };
}
