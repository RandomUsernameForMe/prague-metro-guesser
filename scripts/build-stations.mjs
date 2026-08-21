// Jednorázově: Overpass → web/stations.json. Spustit: npm run build:stations
import { writeFileSync, readFileSync, existsSync } from 'node:fs';
import assert from 'node:assert/strict';
import { toLocalMeters, M_PER_DEG_LAT, mPerDegLng } from '../web/shared/geo.mjs';
import { samplePolyline } from '../web/shared/scoring.mjs';

const RADIUS = 150; // m — osa stanice = koleje do RADIUS od nodu stanice
const MIN_LEN = 40; // m — kratší úseky jsou pahýly ze štěpení ways na uzlech
const MAX_OFF = 30; // m — dál od hlavní koleje leží spojky, obratové a depo koleje
const BIN = 25;     // m — krok výsledné střední osy
const HALF = 90;    // m — osa jen v délce nástupiště; dál koleje zatáčejí a rovná úsečka je netrefí
const TRANSFERS = new Set(['Můstek', 'Muzeum', 'Florenc']);
const LINE_BY_COLOUR = { green: 'A', yellow: 'B', red: 'C' };
const QUERY = `[out:json][timeout:120];
(node(49.95,14.2,50.15,14.7)["railway"="station"]["station"="subway"];)->.s;
.s out body;
(way(49.95,14.2,50.15,14.7)["railway"="subway"][!"service"];);
out geom;`;

// OVERPASS_CACHE=soubor.json — Overpass často vrací 429/504, s cache jde ladit bez dotazů
const cache = process.env.OVERPASS_CACHE;
let data;
if (cache && existsSync(cache)) {
  data = JSON.parse(readFileSync(cache));
} else {
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
  data = await res.json();
  if (cache) writeFileSync(cache, JSON.stringify(data));
}

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
  // linku určí node, ke kterému se úsek nejvíc přiblíží — node stanice leží nad svými kolejemi,
  // kdežto koleje druhé linky míjí i 90 m daleko (Muzeum)
  const nodeDist = (pts, n) => Math.min(...pts.map(([lat, lng]) => distTo(lat, lng, n)));
  return axes.filter(a => a.length >= 2).map(pts => {
    const near = stationNodes.reduce((best, n) => (nodeDist(pts, n) < nodeDist(pts, best) ? n : best));
    return { line: LINE_BY_COLOUR[near.tags.colour], pts };
  });
}

const median = xs => [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)];
const polyLen = pts => pts.reduce((s, p, i) => (i ? s + Math.hypot(p[0] - pts[i - 1][0], p[1] - pts[i - 1][1]) : 0), 0);

// hlavní směr kolejí + počátek (PCA)
function frame(P) {
  const mx = P.reduce((s, p) => s + p[0], 0) / P.length;
  const my = P.reduce((s, p) => s + p[1], 0) / P.length;
  let sxx = 0, sxy = 0, syy = 0;
  for (const [x, y] of P) { sxx += (x - mx) ** 2; sxy += (x - mx) * (y - my); syy += (y - my) ** 2; }
  const th = 0.5 * Math.atan2(2 * sxy, sxx - syy);
  const ux = Math.cos(th), uy = Math.sin(th);
  return {
    along: p => (p[0] - mx) * ux + (p[1] - my) * uy,
    off: p => -(p[0] - mx) * uy + (p[1] - my) * ux,
    back: (a, o) => [mx + a * ux - o * uy, my + a * uy + o * ux],
  };
}

// OSM mapuje každou kolej zvlášť a ways štěpí na uzlech; hráč kreslí jednu úsečku,
// takže koleje jedné linky slož do jedné střední osy
function mergeAxes(axes, station) {
  const toM = pts => pts.map(([lat, lng]) => toLocalMeters(lat, lng, station));
  const long = axes.map(a => toM(a.pts)).filter(pts => polyLen(pts) >= MIN_LEN);
  const use = long.length ? long : axes.map(a => toM(a.pts));
  // nejdelší úsek je jistě skutečná kolej — ta udá směr i polohu, ostatní se k ní jen měří
  const seed = samplePolyline(use.reduce((a, b) => (polyLen(a) >= polyLen(b) ? a : b)));
  const f = frame(seed);
  const binOf = p => Math.floor(f.along(p) / BIN);
  const seedOff = new Map();
  for (const p of seed) {
    if (!seedOff.has(binOf(p))) seedOff.set(binOf(p), []);
    seedOff.get(binOf(p)).push(f.off(p));
  }
  // v každém pruhu 25 m průměruj koleje do MAX_OFF od hlavní; spojky a depo tím vypadnou
  const bins = new Map();
  for (const p of use.flatMap(pts => samplePolyline(pts))) {
    const s = seedOff.get(binOf(p));
    if (!s || Math.abs(f.off(p) - median(s)) > MAX_OFF) continue;
    if (!bins.has(binOf(p))) bins.set(binOf(p), []);
    bins.get(binOf(p)).push(f.off(p));
  }
  const kept = [...bins.entries()]
    .map(([k, offs]) => ({ k, o: offs.reduce((s, o) => s + o, 0) / offs.length }))
    .sort((a, b) => a.k - b.k);
  const mid = ((kept[0].k + kept.at(-1).k + 1) / 2) * BIN;
  const near = kept.filter(b => Math.abs((b.k + 0.5) * BIN - mid) <= HALF);
  const band = near.length >= 2 ? near : kept;
  // hráč kreslí úsečku, takže i osa je úsečka: středy pruhů proloží přímka (least squares),
  // jinak osa kopíruje oblouk koleje a v mapě je vidět zakřivená
  const A = band.map(b => (b.k + 0.5) * BIN);
  const ma = A.reduce((s, a) => s + a, 0) / A.length;
  const mo = band.reduce((s, b) => s + b.o, 0) / band.length;
  const den = A.reduce((s, a) => s + (a - ma) ** 2, 0);
  const slope = den ? band.reduce((s, b, i) => s + (A[i] - ma) * (b.o - mo), 0) / den : 0;
  const at = a => f.back(a, mo + slope * (a - ma));
  const pts = [at(Math.min(...A)), at(Math.max(...A))];
  return pts.map(([x, y]) => [
    station.lat + y / M_PER_DEG_LAT,
    station.lng + x / mPerDegLng(station.lat),
  ]);
}

const stations = [...byName.entries()].map(([name, ns]) => {
  const lat = ns.reduce((s, n) => s + n.lat, 0) / ns.length;
  const lng = ns.reduce((s, n) => s + n.lon, 0) / ns.length;
  const raw = ways.flatMap(w => clipAxes(ns, w));
  const lines = [...new Set(ns.map(n => LINE_BY_COLOUR[n.tags.colour]))].sort();
  const station = { id: String(ns[0].id), name, lat, lng, lines, isTransfer: TRANSFERS.has(name) };
  station.axes = lines.map(line => ({
    line,
    pts: mergeAxes(raw.filter(a => a.line === line), station),
  }));
  return station;
}).sort((a, b) => a.name.localeCompare(b.name, 'cs'));

// validace
assert.ok(stations.length >= 55 && stations.length <= 62, `počet stanic: ${stations.length}`);
for (const s of stations) {
  assert.ok(s.lines.length >= 1 && s.lines.every(l => 'ABC'.includes(l)), `${s.name}: linky=${s.lines}`);
  // právě jedna osa na linku — hráč za linku kreslí jedinou úsečku
  assert.equal(s.axes.length, s.lines.length, `${s.name}: os=${s.axes.length}, linek=${s.lines.length}`);
  for (const a of s.axes) {
    assert.equal(a.pts.length, 2, `${s.name}/${a.line}: osa má ${a.pts.length} bodů`);
    const m = a.pts.map(([lat, lng]) => toLocalMeters(lat, lng, s));
    const len = polyLen(m);
    // rezerva nad 2×HALF: délka je v projekci na hlavní směr, sklon úsečku prodlouží
    assert.ok(len >= 60 && len <= 2 * HALF + 60, `${s.name}/${a.line}: osa ${len.toFixed(0)} m`);
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
