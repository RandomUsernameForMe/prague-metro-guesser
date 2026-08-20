# Prague Metro Guesser Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Webová hra — hráč kreslí na letecký snímek čáru, kudy vede stanice pražského metra; týdenní výzva 10 stanic, veřejný leaderboard.

**Architecture:** Statický frontend (vanilla JS + SVG, dlaždice jako `<img>` mřížka) na Cloudflare Pages. API jako Pages Functions (`functions/api/*`) s D1. Ground truth `stations.json` vygenerovaný jednorázově z OSM Overpass. Sdílené ESM moduly (seed, scoring, geo) importuje klient, Functions i testy.

**Tech Stack:** Vanilla JS (ESM), Cloudflare Pages + Pages Functions + D1, node:test, wrangler. Žádný frontend framework, žádné runtime závislosti.

**Spec:** `docs/superpowers/specs/2026-08-20-prague-metro-guesser-design.md`

**Bezpečnostní zásada pro UI kód:** `innerHTML` jen se statickým, aplikací generovaným markupem (číselné souřadnice, texty z vlastního kódu). Jakákoli nedůvěryhodná data (přezdívky z API) se vkládají výhradně přes `textContent` / DOM metody.

**File structure:**

```
package.json
wrangler.toml
schema.sql
scripts/build-stations.mjs      # Overpass → web/stations.json (jednorázově)
web/                            # Pages output dir
  index.html
  style.css
  app.mjs                       # herní smyčka, UI stavy
  tiles.mjs                     # dlaždicová mřížka + px↔latlng
  stations.json                 # generovaný, commitnutý
  shared/geo.mjs                # projekce, lokální metry
  shared/seed.mjs               # ISO týden, PRNG, výběr 10 stanic, viewport
  shared/scoring.mjs            # vzorkování, symetrická vzdálenost, skóre
  shared/validate.mjs           # validace POST payloadu
functions/api/leaderboard.js    # GET
functions/api/score.js          # POST (přepočet skóre server-side)
tests/geo.test.mjs
tests/seed.test.mjs
tests/scoring.test.mjs
tests/validate.test.mjs
```

Poznámka k fér zobrazení: stage je čtverec `min(vw, vh)` uprostřed tmavého pozadí — všichni hráči vidí přesně stejný geografický výřez 600×600 m bez ohledu na poměr stran displeje.

---

### Task 1: Scaffold projektu

**Files:**
- Create: `package.json`, `wrangler.toml`, `schema.sql`
- Already exists: git repo, `.gitignore` (obsahuje `node_modules/`, `.superpowers/`)

- [ ] **Step 1: package.json**

```json
{
  "name": "prague-metro-guesser",
  "private": true,
  "type": "module",
  "scripts": {
    "test": "node --test tests/",
    "build:stations": "node scripts/build-stations.mjs",
    "dev": "wrangler pages dev web"
  },
  "devDependencies": {
    "wrangler": "^4"
  }
}
```

- [ ] **Step 2: wrangler.toml** (`database_id` se doplní v Tasku 9 po `d1 create`; lokálnímu dev to nevadí)

```toml
name = "prague-metro-guesser"
compatibility_date = "2026-08-01"
pages_build_output_dir = "web"

[[d1_databases]]
binding = "DB"
database_name = "metro-guesser"
database_id = "00000000-0000-0000-0000-000000000000"
```

- [ ] **Step 3: schema.sql**

```sql
CREATE TABLE IF NOT EXISTS scores (
  week TEXT NOT NULL,
  nick TEXT NOT NULL,
  score INTEGER NOT NULL,
  lines_json TEXT NOT NULL,
  ip_hash TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(week, nick)
);
CREATE INDEX IF NOT EXISTS idx_scores_week ON scores(week, score DESC);
```

- [ ] **Step 4: instalace + adresáře**

Run: `npm install && mkdir -p web/shared functions/api scripts tests`
Expected: wrangler nainstalován, bez chyb.

- [ ] **Step 5: Commit**

```bash
git add package.json package-lock.json wrangler.toml schema.sql
git commit -m "chore: scaffold project (pages + functions + d1)"
```

---

### Task 2: shared/geo.mjs

**Files:**
- Create: `web/shared/geo.mjs`
- Test: `tests/geo.test.mjs`

- [ ] **Step 1: Failing test**

```js
// tests/geo.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { toLocalMeters, lngToTileX, latToTileY } from '../web/shared/geo.mjs';

test('toLocalMeters: 0.001° lng na 50° s.š. ≈ 71.6 m východně', () => {
  const [x, y] = toLocalMeters(50.0, 14.401, { lat: 50.0, lng: 14.4 });
  assert.ok(Math.abs(x - 71.56) < 0.5, `x=${x}`);
  assert.ok(Math.abs(y) < 0.01);
});

test('toLocalMeters: 0.001° lat ≈ 110.6 m severně', () => {
  const [x, y] = toLocalMeters(50.001, 14.4, { lat: 50.0, lng: 14.4 });
  assert.ok(Math.abs(y - 110.57) < 0.5, `y=${y}`);
  assert.ok(Math.abs(x) < 0.01);
});

test('tile indexy pro centrum Prahy na z18', () => {
  assert.equal(Math.floor(lngToTileX(14.42, 18)), 141574);
  assert.equal(Math.floor(latToTileY(50.08, 18)), 88907);
});
```

- [ ] **Step 2: Ověř FAIL** — Run: `npm test`. Expected: FAIL (modul neexistuje).

- [ ] **Step 3: Implementace**

```js
// web/shared/geo.mjs
// ponytail: equirect aproximace kolem počátku — na výřezu 600 m chyba < 1 m
export const M_PER_DEG_LAT = 110574;
export function mPerDegLng(lat) { return 111320 * Math.cos(lat * Math.PI / 180); }

export function toLocalMeters(lat, lng, origin) {
  return [(lng - origin.lng) * mPerDegLng(origin.lat), (lat - origin.lat) * M_PER_DEG_LAT];
}

export function lngToTileX(lng, z) { return ((lng + 180) / 360) * 2 ** z; }
export function latToTileY(lat, z) {
  const r = (lat * Math.PI) / 180;
  return ((1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2) * 2 ** z;
}
```

- [ ] **Step 4: Ověř PASS** — Run: `npm test`. Expected: 3 pass.

- [ ] **Step 5: Commit** — `git add web/shared/geo.mjs tests/geo.test.mjs && git commit -m "feat: geo helpers (local meters, tile indices)"`

---

### Task 3: shared/seed.mjs — týdenní výzva

**Files:**
- Create: `web/shared/seed.mjs`
- Test: `tests/seed.test.mjs`

- [ ] **Step 1: Failing test**

```js
// tests/seed.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isoWeek, weeklyChallenge, roundViewport, VIEW_SIZE } from '../web/shared/seed.mjs';

// fixture: 14 stanic, 3 přestupní
const fx = [];
for (let i = 0; i < 11; i++) fx.push({ id: `s${i}`, name: `Stanice ${i}`, lat: 50 + i * 0.01, lng: 14.4, isTransfer: false, axes: [] });
for (const n of ['Můstek', 'Muzeum', 'Florenc']) fx.push({ id: n, name: n, lat: 50.08, lng: 14.43, isTransfer: true, axes: [] });

test('isoWeek: známé hodnoty (UTC)', () => {
  assert.equal(isoWeek(new Date(Date.UTC(2026, 7, 20))), '2026-34');
  assert.equal(isoWeek(new Date(Date.UTC(2026, 0, 1))), '2026-01');
  assert.equal(isoWeek(new Date(Date.UTC(2027, 0, 1))), '2026-53');
});

test('weeklyChallenge: deterministické, 10 kol, unikátní stanice', () => {
  const a = weeklyChallenge('2026-34', fx);
  const b = weeklyChallenge('2026-34', fx);
  assert.equal(a.length, 10);
  assert.deepEqual(a.map(r => r.station.id), b.map(r => r.station.id));
  assert.deepEqual(a.map(r => [r.u, r.v]), b.map(r => [r.u, r.v]));
  assert.equal(new Set(a.map(r => r.station.id)).size, 10);
});

test('weeklyChallenge: jiný týden → jiný výběr/pořadí', () => {
  const ids = w => weeklyChallenge(w, fx).map(r => r.station.id).join(',');
  assert.notEqual(ids('2026-34'), ids('2026-35'));
});

test('weeklyChallenge: vždy ≥1 přestupní, u/v v [0.15,0.85]', () => {
  for (let w = 1; w <= 52; w++) {
    const ch = weeklyChallenge(`2026-${String(w).padStart(2, '0')}`, fx);
    assert.ok(ch.some(r => r.station.isTransfer), `týden ${w} bez přestupní`);
    for (const r of ch) {
      assert.ok(r.u >= 0.15 && r.u <= 0.85 && r.v >= 0.15 && r.v <= 0.85);
    }
  }
});

test('roundViewport: u=0.15 → střed 210 m východně od stanice', () => {
  const st = { lat: 50.0, lng: 14.4 };
  const vp = roundViewport({ station: st, u: 0.15, v: 0.5 });
  assert.ok(Math.abs((vp.lng - st.lng) * 111320 * Math.cos(Math.PI * 50 / 180) - 210) < 1);
  assert.ok(Math.abs(vp.lat - st.lat) < 1e-9);
  assert.equal(VIEW_SIZE, 600);
});
```

- [ ] **Step 2: Ověř FAIL** — `npm test`. Expected: seed testy FAIL.

- [ ] **Step 3: Implementace**

```js
// web/shared/seed.mjs
import { M_PER_DEG_LAT, mPerDegLng } from './geo.mjs';

export const VIEW_SIZE = 600; // metry, čtvercový výřez

export function isoWeek(date) {
  const d = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
  const day = d.getUTCDay() || 7;
  d.setUTCDate(d.getUTCDate() + 4 - day);
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  const week = Math.ceil(((d - yearStart) / 86400000 + 1) / 7);
  return `${d.getUTCFullYear()}-${String(week).padStart(2, '0')}`;
}

function strHash(str) { // xmur3
  let h = 1779033703 ^ str.length;
  for (let i = 0; i < str.length; i++) {
    h = Math.imul(h ^ str.charCodeAt(i), 3432918353);
    h = (h << 13) | (h >>> 19);
  }
  h = Math.imul(h ^ (h >>> 16), 2246822507);
  h = Math.imul(h ^ (h >>> 13), 3266489909);
  return (h ^= h >>> 16) >>> 0;
}

export function mulberry32(a) {
  return function () {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function weeklyChallenge(week, stations) {
  const rng = mulberry32(strHash(week));
  const transfers = stations.filter(s => s.isTransfer);
  const chosen = [transfers[Math.floor(rng() * transfers.length)]];
  const rest = stations.filter(s => s.id !== chosen[0].id);
  while (chosen.length < 10) chosen.push(rest.splice(Math.floor(rng() * rest.length), 1)[0]);
  for (let i = chosen.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [chosen[i], chosen[j]] = [chosen[j], chosen[i]];
  }
  return chosen.map(station => ({ station, u: 0.15 + rng() * 0.7, v: 0.15 + rng() * 0.7 }));
}

// u = zlomek zleva, v = zlomek shora, kde ve výřezu leží stanice
export function roundViewport(round) {
  const { station, u, v } = round;
  return {
    lat: station.lat + ((v - 0.5) * VIEW_SIZE) / M_PER_DEG_LAT,
    lng: station.lng + ((0.5 - u) * VIEW_SIZE) / mPerDegLng(station.lat),
    size: VIEW_SIZE,
  };
}
```

- [ ] **Step 4: Ověř PASS** — `npm test`. Expected: vše pass. Pozn.: pokud `2027-01-01` nevyjde `2026-53`, ověř výpočet ISO 8601 ručně (`date -u +%G-%V -d 2027-01-01` na Linuxu) a oprav očekávání v testu jen s doloženým výpočtem.

- [ ] **Step 5: Commit** — `git add web/shared/seed.mjs tests/seed.test.mjs && git commit -m "feat: deterministic weekly challenge (seeded pick, >=1 transfer)"`

---

### Task 4: shared/scoring.mjs

**Files:**
- Create: `web/shared/scoring.mjs`
- Test: `tests/scoring.test.mjs`

- [ ] **Step 1: Failing test**

```js
// tests/scoring.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { samplePolyline, symmetricDistance, scoreRound } from '../web/shared/scoring.mjs';
import { M_PER_DEG_LAT } from '../web/shared/geo.mjs';

test('samplePolyline: 100m úsečka po 5 m → 21 bodů', () => {
  const pts = samplePolyline([[0, 0], [100, 0]], 5);
  assert.equal(pts.length, 21);
  assert.deepEqual(pts[0], [0, 0]);
  assert.deepEqual(pts.at(-1), [100, 0]);
});

test('symmetricDistance: rovnoběžky 20 m od sebe → 20', () => {
  const a = [[0, 0], [100, 0]];
  const b = [[0, 20], [100, 20]];
  assert.ok(Math.abs(symmetricDistance(a, b) - 20) < 0.1);
});

test('symmetricDistance: tečka na ose nevyhraje (asymetrie potrestána)', () => {
  const axis = [[0, 0], [300, 0]];
  const dot = [[150, 0], [151, 0]];
  const full = [[0, 0], [300, 0]];
  assert.ok(symmetricDistance(dot, axis) > 30);
  assert.ok(symmetricDistance(full, axis) < 0.01);
});

test('scoreRound: přesná shoda ≈ 1000, 85 m ≈ 368, bere nejbližší osu', () => {
  const st = {
    lat: 50, lng: 14.4,
    axes: [
      [[50, 14.4], [50 + 200 / M_PER_DEG_LAT, 14.4]],                         // osa přes stanici, 200 m k severu
      [[50 + 5000 / M_PER_DEG_LAT, 14.4], [50 + 5200 / M_PER_DEG_LAT, 14.4]], // vzdálená osa
    ],
  };
  const exact = scoreRound(st.axes[0], st);
  assert.ok(exact.score >= 995, `score=${exact.score}`);
  const shifted = st.axes[0].map(([lat, lng]) => [lat, lng + 85 / (111320 * Math.cos(Math.PI * 50 / 180))]);
  const off = scoreRound(shifted, st);
  assert.ok(Math.abs(off.score - 368) <= 8, `score=${off.score}`);
  assert.ok(Math.abs(off.d - 85) < 1.5);
});
```

- [ ] **Step 2: Ověř FAIL** — `npm test`.

- [ ] **Step 3: Implementace**

```js
// web/shared/scoring.mjs
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
```

- [ ] **Step 4: Ověř PASS** — `npm test`.

- [ ] **Step 5: Commit** — `git add web/shared/scoring.mjs tests/scoring.test.mjs && git commit -m "feat: scoring (symmetric mean distance, exp decay)"`

---

### Task 5: build skript → web/stations.json

**Files:**
- Create: `scripts/build-stations.mjs`
- Create (generovaný): `web/stations.json`

- [ ] **Step 1: Skript** (validace vestavěná — assert při generování; samostatný unit test netřeba, výstup je commitnutý artefakt)

```js
// scripts/build-stations.mjs
// Jednorázově: Overpass → web/stations.json. Spustit: npm run build:stations
import { writeFileSync } from 'node:fs';
import assert from 'node:assert/strict';
import { toLocalMeters } from '../web/shared/geo.mjs';

const RADIUS = 150; // m — osa stanice = koleje do RADIUS od nodu stanice
const TRANSFERS = new Set(['Můstek', 'Muzeum', 'Florenc']);
const QUERY = `[out:json][timeout:120];
(node(49.95,14.2,50.15,14.7)["railway"="station"]["station"="subway"];)->.s;
.s out body;
(way(49.95,14.2,50.15,14.7)["railway"="subway"][!"service"];);
out geom;`;

const res = await fetch('https://overpass-api.de/api/interpreter', {
  method: 'POST',
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

// ponytail: clipping po vrcholech (bez interpolace hranice) — track ways mají husté nody, stačí
function clipAxes(stationNodes, way) {
  const axes = [];
  let run = [];
  for (const g of way.geometry) {
    const inRange = stationNodes.some(n => {
      const [x, y] = toLocalMeters(g.lat, g.lon, { lat: n.lat, lng: n.lon });
      return Math.hypot(x, y) <= RADIUS;
    });
    if (inRange) run.push([g.lat, g.lon]);
    else if (run.length) { axes.push(run); run = []; }
  }
  if (run.length) axes.push(run);
  return axes.filter(a => a.length >= 2);
}

const stations = [...byName.entries()].map(([name, ns]) => {
  const lat = ns.reduce((s, n) => s + n.lat, 0) / ns.length;
  const lng = ns.reduce((s, n) => s + n.lon, 0) / ns.length;
  const axes = ways.flatMap(w => clipAxes(ns, w));
  return { id: String(ns[0].id), name, lat, lng, isTransfer: TRANSFERS.has(name), axes };
}).sort((a, b) => a.name.localeCompare(b.name, 'cs'));

// validace
assert.ok(stations.length >= 55 && stations.length <= 62, `počet stanic: ${stations.length}`);
for (const s of stations) assert.ok(s.axes.length >= 1, `${s.name}: žádná osa`);
for (const t of TRANSFERS) {
  const s = stations.find(x => x.name === t);
  assert.ok(s, `chybí přestupní ${t}`);
  assert.ok(s.isTransfer && s.axes.length >= 2, `${t}: axes=${s.axes.length}`);
}
assert.equal(stations.filter(s => s.isTransfer).length, 3);

writeFileSync('web/stations.json', JSON.stringify(stations));
console.log(`OK: ${stations.length} stanic → web/stations.json`);
```

- [ ] **Step 2: Spusť** — Run: `npm run build:stations`
Expected: `OK: 5X stanic → web/stations.json`. Pokud assert na přestupní stanici selže (osy druhé linky dál než 150 m od nodů), zvyš `RADIUS` na 200 a spusť znovu — jiné zásahy nedělej.

- [ ] **Step 3: Sanity check dat**

Run: `node -e "import('node:fs').then(fs=>{const s=JSON.parse(fs.readFileSync('web/stations.json'));console.log(s.length, s.filter(x=>x.isTransfer).map(x=>x.name), s[0].name, s[0].axes.length)})"`
Expected: ~58 stanic, `['Florenc','Muzeum','Můstek']` (abecedně), první stanice má jméno a ≥1 osu.

- [ ] **Step 4: Commit** — `git add scripts/build-stations.mjs web/stations.json && git commit -m "feat: ground truth build script + generated stations.json"`

---

### Task 6: API — validace + Pages Functions

**Files:**
- Create: `web/shared/validate.mjs`
- Create: `functions/api/score.js`, `functions/api/leaderboard.js`
- Test: `tests/validate.test.mjs`

- [ ] **Step 1: Failing test validace**

```js
// tests/validate.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validateSubmission } from '../web/shared/validate.mjs';
import { weeklyChallenge, roundViewport } from '../web/shared/seed.mjs';

const fx = [];
for (let i = 0; i < 11; i++) fx.push({ id: `s${i}`, name: `S${i}`, lat: 50 + i * 0.01, lng: 14.4, isTransfer: false, axes: [[[50 + i * 0.01, 14.399], [50 + i * 0.01, 14.401]]] });
for (const n of ['Můstek', 'Muzeum', 'Florenc']) fx.push({ id: n, name: n, lat: 50.08, lng: 14.43, isTransfer: true, axes: [[[50.079, 14.43], [50.081, 14.43]]] });

const week = '2026-34';
const rounds = weeklyChallenge(week, fx);
// validní tah: 2 body poblíž středu výřezu každého kola
const goodLines = rounds.map(r => {
  const vp = roundViewport(r);
  return [[vp.lat - 0.0005, vp.lng], [vp.lat + 0.0005, vp.lng]];
});

test('validní payload projde', () => {
  const r = validateSubmission({ week, nick: 'Tomáš_1', lines: goodLines }, rounds, week);
  assert.equal(r.ok, true);
});

test('špatný nick / týden / počet kol / počet bodů / bod mimo výřez → chyba', () => {
  const bad = [
    [{ week, nick: 'ab', lines: goodLines }, /nick/],
    [{ week: '2026-33', nick: 'Hráč', lines: goodLines }, /week/],
    [{ week, nick: 'Hráč', lines: goodLines.slice(0, 9) }, /lines/],
    [{ week, nick: 'Hráč', lines: goodLines.map((l, i) => (i === 0 ? [l[0]] : l)) }, /points/],
    [{ week, nick: 'Hráč', lines: goodLines.map((l, i) => (i === 0 ? Array(201).fill(l[0]) : l)) }, /points/],
    [{ week, nick: 'Hráč', lines: goodLines.map((l, i) => (i === 0 ? [[50.5, 14.4], l[1]] : l)) }, /bounds/],
  ];
  for (const [payload, re] of bad) {
    const r = validateSubmission(payload, rounds, week);
    assert.equal(r.ok, false, `mělo selhat: ${re}`);
    assert.match(r.error, re);
  }
});
```

- [ ] **Step 2: Ověř FAIL** — `npm test`.

- [ ] **Step 3: Implementace validate.mjs**

```js
// web/shared/validate.mjs
import { roundViewport, VIEW_SIZE } from './seed.mjs';
import { toLocalMeters } from './geo.mjs';

const NICK_RE = /^[\p{L}\p{N} _-]{3,16}$/u;
const MARGIN = 5; // m tolerance na hraně výřezu

// body: {week, nick, lines}; rounds: výstup weeklyChallenge; currentWeek: isoWeek(now)
export function validateSubmission(body, rounds, currentWeek) {
  if (!body || typeof body !== 'object') return { ok: false, error: 'body' };
  if (typeof body.nick !== 'string' || !NICK_RE.test(body.nick)) return { ok: false, error: 'nick' };
  if (body.week !== currentWeek) return { ok: false, error: 'week' };
  if (!Array.isArray(body.lines) || body.lines.length !== rounds.length) return { ok: false, error: 'lines' };
  for (let i = 0; i < rounds.length; i++) {
    const line = body.lines[i];
    if (!Array.isArray(line) || line.length < 2 || line.length > 200) return { ok: false, error: `points round ${i}` };
    const vp = roundViewport(rounds[i]);
    for (const p of line) {
      if (!Array.isArray(p) || p.length !== 2 || !p.every(Number.isFinite)) return { ok: false, error: `points round ${i}` };
      const [x, y] = toLocalMeters(p[0], p[1], vp);
      if (Math.abs(x) > VIEW_SIZE / 2 + MARGIN || Math.abs(y) > VIEW_SIZE / 2 + MARGIN) return { ok: false, error: `bounds round ${i}` };
    }
  }
  return { ok: true };
}
```

- [ ] **Step 4: Ověř PASS** — `npm test`.

- [ ] **Step 5: Pages Functions**

```js
// functions/api/score.js
import stations from '../../web/stations.json';
import { isoWeek, weeklyChallenge } from '../../web/shared/seed.mjs';
import { scoreRound } from '../../web/shared/scoring.mjs';
import { validateSubmission } from '../../web/shared/validate.mjs';

const json = (obj, status = 200) =>
  new Response(JSON.stringify(obj), { status, headers: { 'content-type': 'application/json' } });

async function sha256(s) {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s));
  return [...new Uint8Array(buf)].map(b => b.toString(16).padStart(2, '0')).join('');
}

export async function onRequestPost({ request, env }) {
  const body = await request.json().catch(() => null);
  const week = isoWeek(new Date());
  const rounds = weeklyChallenge(week, stations);
  const v = validateSubmission(body, rounds, week);
  if (!v.ok) return json({ error: v.error }, 400);

  const ipHash = await sha256(request.headers.get('cf-connecting-ip') || '');
  const { cnt } = await env.DB.prepare(
    "SELECT COUNT(*) AS cnt FROM scores WHERE ip_hash = ? AND created_at > datetime('now','-1 hour')"
  ).bind(ipHash).first();
  if (cnt >= 10) return json({ error: 'rate limit' }, 429);

  // skóre počítá server — číslo od klienta se ignoruje
  const score = rounds.reduce((sum, r, i) => sum + scoreRound(body.lines[i], r.station).score, 0);

  try {
    await env.DB.prepare(
      'INSERT INTO scores (week, nick, score, lines_json, ip_hash) VALUES (?, ?, ?, ?, ?)'
    ).bind(week, body.nick, score, JSON.stringify(body.lines), ipHash).run();
  } catch (e) {
    if (String(e).includes('UNIQUE')) return json({ error: 'nick už tento týden hrál' }, 409);
    throw e;
  }
  return json({ score, week });
}
```

```js
// functions/api/leaderboard.js
const json = (obj, status = 200) =>
  new Response(JSON.stringify(obj), { status, headers: { 'content-type': 'application/json' } });

export async function onRequestGet({ request, env }) {
  const week = new URL(request.url).searchParams.get('week');
  if (!/^\d{4}-\d{2}$/.test(week || '')) return json({ error: 'week' }, 400);
  const { results } = await env.DB.prepare(
    'SELECT nick, score FROM scores WHERE week = ? ORDER BY score DESC, created_at ASC LIMIT 100'
  ).bind(week).all();
  return json({ week, entries: results });
}
```

- [ ] **Step 6: Lokální D1 + smoke test**

```bash
npx wrangler d1 execute metro-guesser --local --file schema.sql
npx wrangler pages dev web &
sleep 5
curl -s "http://localhost:8788/api/leaderboard?week=2026-34"
curl -s -X POST http://localhost:8788/api/score -H 'content-type: application/json' -d '{}'
```
Expected: první curl `{"week":"2026-34","entries":[]}`, druhý `{"error":"nick"}` (HTTP 400). Pak dev server zabij.

- [ ] **Step 7: Commit** — `git add web/shared/validate.mjs functions tests/validate.test.mjs && git commit -m "feat: score + leaderboard API with server-side recompute"`

---

### Task 7: Dlaždice + kostra UI

**Files:**
- Create: `web/tiles.mjs`, `web/index.html`, `web/style.css`

- [ ] **Step 1: Ověř zdroj dlaždic** (URL ČÚZK se může lišit)

```bash
curl -s -o /dev/null -w "%{http_code} %{content_type}\n" "https://ags.cuzk.gov.cz/arcgis1/rest/services/ORTOFOTO/MapServer/tile/18/88907/141574"
curl -s -o /dev/null -w "%{http_code} %{content_type}\n" "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/18/88907/141574"
```
Expected: `200 image/...` aspoň u jednoho. Pokud ČÚZK 404: zkus varianty `.../arcgis2/...` a `https://ags.cuzk.gov.cz/arcgis/rest/services/ORTOFOTO_WM/MapServer/tile/{z}/{y}/{x}`; funkční URL zapiš do `SOURCES[0]` níže. Pokud žádná ČÚZK varianta nefunguje, nech v `SOURCES` jen Esri a pokračuj.

- [ ] **Step 2: tiles.mjs**

```js
// web/tiles.mjs
import { lngToTileX, latToTileY, mPerDegLng, M_PER_DEG_LAT } from './shared/geo.mjs';
import { VIEW_SIZE } from './shared/seed.mjs';

const Z = 18, TILE = 256;
const SOURCES = [
  (z, x, y) => `https://ags.cuzk.gov.cz/arcgis1/rest/services/ORTOFOTO/MapServer/tile/${z}/${y}/${x}`,
  (z, x, y) => `https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/${z}/${y}/${x}`,
];
let srcIdx = 0;

// vp: {lat,lng} střed výřezu; sizePx: px hrana čtvercového stage
export function renderTiles(container, vp, sizePx) {
  const halfLng = (VIEW_SIZE / 2) / mPerDegLng(vp.lat);
  const halfLat = (VIEW_SIZE / 2) / M_PER_DEG_LAT;
  const xW = lngToTileX(vp.lng - halfLng, Z) * TILE;
  const xE = lngToTileX(vp.lng + halfLng, Z) * TILE;
  const yN = latToTileY(vp.lat + halfLat, Z) * TILE;
  const yS = latToTileY(vp.lat - halfLat, Z) * TILE;
  const scaleX = sizePx / (xE - xW), scaleY = sizePx / (yS - yN);
  container.textContent = '';
  for (let tx = Math.floor(xW / TILE); tx * TILE < xE; tx++) {
    for (let ty = Math.floor(yN / TILE); ty * TILE < yS; ty++) {
      const img = new Image();
      img.src = SOURCES[srcIdx](Z, tx, ty);
      img.onerror = () => {
        if (srcIdx === 0) { srcIdx = 1; renderTiles(container, vp, sizePx); }
      };
      img.draggable = false;
      img.style.cssText = `position:absolute;left:${(tx * TILE - xW) * scaleX}px;top:${(ty * TILE - yN) * scaleY}px;width:${TILE * scaleX + 0.5}px;height:${TILE * scaleY + 0.5}px;`;
      container.appendChild(img);
    }
  }
}

// ponytail: px↔latlng přes equirect, dlaždice přes mercator — rozdíl na 600 m < 1 px
export function pxToLatLng(px, py, vp, sizePx) {
  const east = (px / sizePx - 0.5) * VIEW_SIZE;
  const north = (0.5 - py / sizePx) * VIEW_SIZE;
  return [vp.lat + north / M_PER_DEG_LAT, vp.lng + east / mPerDegLng(vp.lat)];
}

export function latLngToPx(lat, lng, vp, sizePx) {
  const east = (lng - vp.lng) * mPerDegLng(vp.lat);
  const north = (lat - vp.lat) * M_PER_DEG_LAT;
  return [((east / VIEW_SIZE) + 0.5) * sizePx, (0.5 - north / VIEW_SIZE) * sizePx];
}
```

- [ ] **Step 3: index.html**

```html
<!DOCTYPE html>
<html lang="cs">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Metro Guesser — kde vede pražské metro?</title>
  <link rel="stylesheet" href="style.css">
</head>
<body>
  <main id="stage">
    <div id="tiles"></div>
    <svg id="draw"></svg>
    <header id="hud">
      <strong id="hud-station">…</strong>
      <span id="hud-round"></span>
      <span id="hud-score"></span>
    </header>
    <div id="controls">
      <button id="clear" class="btn-ghost">Smazat</button>
      <button id="confirm" class="btn-primary" disabled>Potvrdit</button>
    </div>
    <div id="overlay" hidden></div>
    <footer id="attribution">snímky © ČÚZK / Esri · data © přispěvatelé OpenStreetMap</footer>
  </main>
  <script type="module" src="app.mjs"></script>
</body>
</html>
```

- [ ] **Step 4: style.css**

```css
:root {
  --bg: #0d1117; --panel: rgba(13, 17, 23, 0.82); --text: #e6edf3;
  --muted: #8b949e; --accent: #2ea8ff; --line: #ff3b5c; --truth: #2bd97e;
}
* { margin: 0; box-sizing: border-box; }
body {
  background: var(--bg); color: var(--text);
  font: 16px/1.5 system-ui, -apple-system, sans-serif;
  display: grid; place-items: center; min-height: 100dvh;
}
#stage {
  position: relative; width: min(100vw, 100dvh); height: min(100vw, 100dvh);
  overflow: hidden; touch-action: none;
}
#tiles { position: absolute; inset: 0; }
#draw { position: absolute; inset: 0; width: 100%; height: 100%; cursor: crosshair; }
#hud {
  position: absolute; top: 12px; left: 50%; transform: translateX(-50%);
  display: flex; gap: 14px; align-items: baseline; white-space: nowrap;
  background: var(--panel); backdrop-filter: blur(8px);
  padding: 10px 20px; border-radius: 999px; font-size: 15px;
}
#hud strong { font-size: 18px; }
#hud span { color: var(--muted); }
#controls { position: absolute; right: 16px; bottom: 40px; display: flex; gap: 10px; }
button {
  font: inherit; border: 0; border-radius: 999px; padding: 12px 24px; cursor: pointer;
}
.btn-primary { background: var(--accent); color: #fff; font-weight: 600; }
.btn-primary:disabled { opacity: 0.4; cursor: default; }
.btn-ghost { background: var(--panel); color: var(--text); backdrop-filter: blur(8px); }
#overlay {
  position: absolute; inset: 0; display: grid; place-items: center;
  background: rgba(13, 17, 23, 0.7); backdrop-filter: blur(4px); z-index: 10;
}
#overlay[hidden] { display: none; }
.panel {
  background: var(--panel); border: 1px solid #30363d; border-radius: 16px;
  padding: 28px 32px; max-width: 420px; width: 90%; max-height: 80%; overflow-y: auto;
  text-align: center; display: grid; gap: 14px;
}
.panel h2 { font-size: 22px; }
.panel .big { font-size: 40px; font-weight: 700; color: var(--accent); }
.panel .muted { color: var(--muted); }
.panel input {
  font: inherit; padding: 10px 14px; border-radius: 8px; border: 1px solid #30363d;
  background: var(--bg); color: var(--text); text-align: center;
}
.panel ol { text-align: left; padding-left: 28px; }
.panel li { padding: 2px 0; }
.panel li.me { color: var(--accent); font-weight: 700; }
.error { color: var(--line); font-size: 14px; }
#attribution {
  position: absolute; left: 8px; bottom: 6px; font-size: 10px; color: var(--muted);
  text-shadow: 0 0 4px #000;
}
```

- [ ] **Step 5: Vizuální kontrola dlaždic** — dočasně na konec `index.html` před `</body>` přidej (a `app.mjs` script tag dočasně zakomentuj, soubor ještě neexistuje):

```html
<script type="module">
  import { renderTiles } from './tiles.mjs';
  const stage = document.getElementById('stage');
  renderTiles(document.getElementById('tiles'), { lat: 50.0755, lng: 14.4303 }, stage.clientWidth);
</script>
```
Run: `npx wrangler pages dev web`, otevři http://localhost:8788 (nebo Playwright MCP screenshot). Expected: ostrý letecký snímek centra Prahy vyplňuje čtverec, bez děr. Pak testovací `<script>` blok smaž a `app.mjs` tag vrať.

- [ ] **Step 6: Commit** — `git add web/tiles.mjs web/index.html web/style.css && git commit -m "feat: tile grid rendering + UI shell (full-bleed layout)"`

---

### Task 8: app.mjs — herní smyčka, kreslení, reveal, trénink

**Files:**
- Create: `web/app.mjs`

Bezpečnost: `innerHTML`/`insertAdjacentHTML` níže dostávají výhradně statické šablony a čísla generovaná aplikací. Přezdívky z API (nedůvěryhodné) se vkládají jen přes `textContent`.

- [ ] **Step 1: Implementace**

```js
// web/app.mjs
import { isoWeek, weeklyChallenge, roundViewport } from './shared/seed.mjs';
import { scoreRound } from './shared/scoring.mjs';
import { renderTiles, pxToLatLng, latLngToPx } from './tiles.mjs';

const $ = id => document.getElementById(id);
const stage = $('stage'), tilesEl = $('tiles'), svg = $('draw'), overlay = $('overlay');

const stations = await (await fetch('stations.json')).json();
const week = isoWeek(new Date());
const playedKey = `pmg-played-${week}`;

let mode = 'weekly'; // 'weekly' | 'training'
let rounds = [], roundIdx = 0, totalScore = 0;
let drawn = [], drawing = false; // drawn: [[px,py],...] v px stage
let lines = []; // tahy pro odeslání, [[lat,lng],...] per kolo

const sizePx = () => stage.clientWidth;
const vp = () => roundViewport(rounds[roundIdx]);

// ---------- kreslení ----------
function redraw(extra = '') {
  const pts = drawn.map(p => p.join(',')).join(' ');
  // jen číselné souřadnice z kliků — žádná externí data
  svg.innerHTML =
    (drawn.length
      ? `<polyline points="${pts}" fill="none" stroke="var(--line)" stroke-width="4" stroke-linecap="round" stroke-linejoin="round"/>` +
        drawn.map(([x, y]) => `<circle cx="${x}" cy="${y}" r="5" fill="var(--line)"/>`).join('')
      : '') + extra;
  $('confirm').disabled = drawn.length < 2;
}

svg.addEventListener('pointerdown', e => {
  if (!overlay.hidden) return;
  drawing = true;
  svg.setPointerCapture(e.pointerId);
  drawn.push([e.offsetX, e.offsetY]);
  redraw();
});
svg.addEventListener('pointermove', e => {
  if (!drawing) return;
  const [lx, ly] = drawn.at(-1);
  if (Math.hypot(e.offsetX - lx, e.offsetY - ly) > 12 && drawn.length < 200) {
    drawn.push([e.offsetX, e.offsetY]);
    redraw();
  }
});
svg.addEventListener('pointerup', () => { drawing = false; });

$('clear').onclick = () => { drawn = []; redraw(); };

// ---------- kola ----------
function startRound() {
  drawn = []; redraw();
  renderTiles(tilesEl, vp(), sizePx());
  $('hud-station').textContent = rounds[roundIdx].station.name;
  $('hud-round').textContent = mode === 'weekly' ? `${roundIdx + 1}/${rounds.length}` : 'trénink';
  $('hud-score').textContent = mode === 'weekly' ? `${totalScore} b.` : '';
  overlay.hidden = true;
}

$('confirm').onclick = () => {
  const s = sizePx();
  const line = drawn.map(([x, y]) => pxToLatLng(x, y, vp(), s));
  const { d, score } = scoreRound(line, rounds[roundIdx].station);
  if (mode === 'weekly') { lines.push(line); totalScore += score; }
  // reveal skutečných os (souřadnice = čísla z vlastních dat)
  const axesSvg = rounds[roundIdx].station.axes.map(axis => {
    const pts = axis.map(([lat, lng]) => latLngToPx(lat, lng, vp(), s).join(',')).join(' ');
    return `<polyline points="${pts}" fill="none" stroke="var(--truth)" stroke-width="5" stroke-linecap="round" stroke-dasharray="1000" stroke-dashoffset="1000" style="animation: reveal 1s forwards"/>`;
  }).join('');
  redraw(axesSvg + `<style>@keyframes reveal { to { stroke-dashoffset: 0; } }</style>`);
  $('hud-score').textContent = mode === 'weekly' ? `${totalScore} b.` : '';
  setTimeout(() => showPanel(`
    <h2>${rounds[roundIdx].station.name}</h2>
    <div class="big">+${score}</div>
    <p class="muted">průměrná odchylka ${Math.round(d)} m</p>
    <button class="btn-primary" id="next">${nextLabel()}</button>
  `, () => { $('next').onclick = advance; }), 1200);
};

const nextLabel = () =>
  mode === 'training' ? 'Další stanice' : roundIdx + 1 < rounds.length ? 'Další kolo' : 'Vyhodnocení';

function advance() {
  if (mode === 'training') { rounds = [randomRound()]; roundIdx = 0; startRound(); return; }
  roundIdx++;
  roundIdx < rounds.length ? startRound() : finish();
}

// ---------- konec + odeslání ----------
function finish() {
  showPanel(`
    <h2>Hotovo!</h2>
    <div class="big">${totalScore} b.</div>
    <p>z ${rounds.length * 1000} možných</p>
    <input id="nick" maxlength="16" placeholder="přezdívka (3–16 znaků)">
    <p class="error" id="submit-err"></p>
    <button class="btn-primary" id="submit">Zapsat na leaderboard</button>
    <button class="btn-ghost" id="skip">Přeskočit</button>
  `, () => {
    $('submit').onclick = submitScore;
    $('skip').onclick = () => showLeaderboard();
  });
}

async function submitScore() {
  const nick = $('nick').value.trim();
  $('submit-err').textContent = '';
  try {
    const res = await fetch('/api/score', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ week, nick, lines }),
    });
    const data = await res.json();
    if (!res.ok) {
      $('submit-err').textContent = data.error === 'nick' ? 'Neplatná přezdívka (3–16 znaků)' : data.error;
      return;
    }
    localStorage.setItem(playedKey, nick);
    showLeaderboard(nick);
  } catch {
    $('submit-err').textContent = 'Odeslání selhalo — zkus znovu';
  }
}

async function showLeaderboard(me) {
  showPanel(`
    <h2>Týden ${week}</h2>
    <div id="lb-list"><p class="muted">Načítám…</p></div>
    <button class="btn-ghost" id="train">Trénink</button>
  `, () => { $('train').onclick = startTraining; });
  const box = $('lb-list');
  try {
    const { entries } = await (await fetch(`/api/leaderboard?week=${week}`)).json();
    if (!entries.length) { box.firstElementChild.textContent = 'Tenhle týden zatím nikdo nehrál. Jsi první!'; return; }
    const ol = document.createElement('ol');
    for (const e of entries) {
      const li = document.createElement('li');
      li.textContent = `${e.nick} — ${e.score} b.`; // nick je nedůvěryhodný → jen textContent
      if (e.nick === me) li.className = 'me';
      ol.appendChild(li);
    }
    box.replaceChildren(ol);
  } catch {
    box.firstElementChild.textContent = 'Leaderboard se nepodařilo načíst.';
  }
}

// ---------- režimy ----------
function randomRound() {
  const station = stations[Math.floor(Math.random() * stations.length)];
  return { station, u: 0.15 + Math.random() * 0.7, v: 0.15 + Math.random() * 0.7 };
}

function startTraining() {
  mode = 'training';
  rounds = [randomRound()]; roundIdx = 0;
  startRound();
}

function startWeekly() {
  mode = 'weekly';
  rounds = weeklyChallenge(week, stations);
  roundIdx = 0; totalScore = 0; lines = [];
  startRound();
}

// ---------- helpers ----------
function showPanel(staticHtml, wire) {
  overlay.innerHTML = `<div class="panel">${staticHtml}</div>`; // jen statické šablony výše
  overlay.hidden = false;
  wire?.();
}

// ---------- start ----------
renderTiles(tilesEl, { lat: 50.0755, lng: 14.4303 }, sizePx());
if (localStorage.getItem(playedKey)) {
  showPanel(`
    <h2>Metro Guesser</h2>
    <p>Týdenní výzvu ${week} už jsi odehrál.</p>
    <button class="btn-primary" id="lb">Leaderboard</button>
    <button class="btn-ghost" id="train">Trénink</button>
  `, () => {
    $('lb').onclick = () => showLeaderboard(localStorage.getItem(playedKey));
    $('train').onclick = startTraining;
  });
} else {
  showPanel(`
    <h2>Metro Guesser</h2>
    <p>Uvidíš letecký snímek a jméno stanice metra. Nakresli čárou, kudy pod zemí vede. 10 stanic, jeden pokus týdně.</p>
    <button class="btn-primary" id="play">Hrát týdenní výzvu</button>
    <button class="btn-ghost" id="train">Trénink</button>
  `, () => {
    $('play').onclick = startWeekly;
    $('train').onclick = startTraining;
  });
}
```

- [ ] **Step 2: Testy stále zelené** — `npm test`. Expected: pass (app.mjs je browser-only, unit se netestuje).

- [ ] **Step 3: Manuální průchod hrou**

Run: `npx wrangler pages dev web`, otevři http://localhost:8788 (Playwright MCP nebo ručně). Ověř:
1. Intro panel → „Hrát týdenní výzvu" → snímek + HUD se jménem stanice, 1/10.
2. Klikáním/tahem nakresli čáru (≥2 body) → Potvrdit aktivní → zelený reveal osy + panel s body kola.
3. Projdi všech 10 kol → panel s celkovým skóre a polem pro přezdívku.
4. Zapiš skóre → leaderboard, tvůj nick zvýrazněný. Reload → panel „už jsi odehrál".
5. Trénink: náhodné stanice, bez zápisu.
6. Mobilní šířka (DevTools): kreslení tahem funguje, HUD nepřetéká.

- [ ] **Step 4: Commit** — `git add web/app.mjs && git commit -m "feat: game loop (draw, reveal, weekly + training modes, leaderboard)"`

---

### Task 9: Nasazení

**Files:**
- Modify: `wrangler.toml` (database_id)

- [ ] **Step 1: D1 produkce**

```bash
npx wrangler d1 create metro-guesser
```
Expected: výstup obsahuje `database_id = "..."` — zkopíruj do `wrangler.toml` místo placeholderu.

```bash
npx wrangler d1 execute metro-guesser --remote --file schema.sql
```

- [ ] **Step 2: Deploy**

```bash
npx wrangler pages deploy
```
Expected: URL `https://prague-metro-guesser.pages.dev`. (První spuštění se zeptá na vytvoření Pages projektu — potvrď.)

- [ ] **Step 3: Produkční smoke test**

```bash
curl -s "https://prague-metro-guesser.pages.dev/api/leaderboard?week=$(date -u +%G)-$(date -u +%V)"
```
Expected: `{"week":"...","entries":[...]}`. Pak ručně (nebo Playwright) odehraj pár kol na produkční URL — dlaždice se načítají, reveal a zápis skóre fungují.

- [ ] **Step 4: Commit** — `git add wrangler.toml && git commit -m "chore: production d1 database id"`

---

## Mimo scope

- Hard mode (bez jména stanice), účty, historie — v2 dle specu.
- Sdílení výsledku, OG obrázky.
