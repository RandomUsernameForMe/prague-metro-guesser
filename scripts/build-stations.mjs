// Jednorázově: Overpass → web/stations.json. Spustit: npm run build:stations
import { writeFileSync } from 'node:fs';
import assert from 'node:assert/strict';
import { toLocalMeters } from '../web/shared/geo.mjs';

const RADIUS = 150; // m — osa stanice = koleje do RADIUS od nodu stanice
const TRANSFERS = new Set(['Můstek', 'Muzeum', 'Florenc']);
const LINE_BY_COLOUR = { green: 'A', yellow: 'B', red: 'C' };
const QUERY = `[out:json][timeout:120];
(node(49.95,14.2,50.15,14.7)["railway"="station"]["station"="subway"];)->.s;
.s out body;
(way(49.95,14.2,50.15,14.7)["railway"="subway"][!"service"];);
out geom;`;

const res = await fetch('https://overpass-api.de/api/interpreter', {
  method: 'POST',
  // Overpass vrací 406 na výchozí UA Node fetche
  headers: {
    'content-type': 'application/x-www-form-urlencoded',
    'user-agent': 'prague-metro-guesser/1.0 (one-off build script)',
  },
  body: 'data=' + encodeURIComponent(QUERY),
});
assert.ok(res.ok, `Overpass HTTP ${res.status}`);
const data = await res.json();

const nodes = data.elements.filter(e => e.type === 'node');
const ways = data.elements.filter(e => e.type === 'way');
console.log(`${nodes.length} station nodes, ${ways.length} track ways`);

// merge nody stejného jména (přestupní stanice mívají node per linka)
const byName = new Map();
for (const n of nodes) {
  const name = n.tags.name;
  if (!byName.has(name)) byName.set(name, []);
  byName.get(name).push(n);
}

const distTo = (lat, lng, n) => Math.hypot(...toLocalMeters(lat, lng, { lat: n.lat, lng: n.lon }));

// ponytail: clipping po vrcholech (bez interpolace hranice) — track ways mají husté nody, stačí
function clipAxes(stationNodes, way) {
  const axes = [];
  let run = [];
  for (const g of way.geometry) {
    if (stationNodes.some(n => distTo(g.lat, g.lon, n) <= RADIUS)) run.push([g.lat, g.lon]);
    else if (run.length) { axes.push(run); run = []; }
  }
  if (run.length) axes.push(run);
  // linku osy určí nejbližší node stanice — u přestupních má každá linka vlastní node
  return axes.filter(a => a.length >= 2).map(pts => {
    const mid = pts[Math.floor(pts.length / 2)];
    const near = stationNodes.reduce((best, n) =>
      distTo(mid[0], mid[1], n) < distTo(mid[0], mid[1], best) ? n : best);
    return { line: LINE_BY_COLOUR[near.tags.colour], pts };
  });
}

const stations = [...byName.entries()].map(([name, ns]) => {
  const lat = ns.reduce((s, n) => s + n.lat, 0) / ns.length;
  const lng = ns.reduce((s, n) => s + n.lon, 0) / ns.length;
  const axes = ways.flatMap(w => clipAxes(ns, w));
  const lines = [...new Set(ns.map(n => LINE_BY_COLOUR[n.tags.colour]))].sort();
  return { id: String(ns[0].id), name, lat, lng, lines, isTransfer: TRANSFERS.has(name), axes };
}).sort((a, b) => a.name.localeCompare(b.name, 'cs'));

// validace
assert.ok(stations.length >= 55 && stations.length <= 62, `počet stanic: ${stations.length}`);
for (const s of stations) {
  assert.ok(s.axes.length >= 1, `${s.name}: žádná osa`);
  assert.ok(s.lines.length >= 1 && s.lines.every(l => 'ABC'.includes(l)), `${s.name}: linky=${s.lines}`);
  // každá linka stanice musí mít vlastní osu — hráč za ni kreslí samostatnou úsečku
  for (const l of s.lines) {
    assert.ok(s.axes.some(a => a.line === l), `${s.name}: linka ${l} bez osy`);
  }
}
for (const t of TRANSFERS) {
  const s = stations.find(x => x.name === t);
  assert.ok(s, `chybí přestupní ${t}`);
  assert.ok(s.isTransfer && s.lines.length === 2, `${t}: linky=${s.lines}`);
}
assert.equal(stations.filter(s => s.isTransfer).length, 3);

writeFileSync('web/stations.json', JSON.stringify(stations));
console.log(`OK: ${stations.length} stanic → web/stations.json`);
