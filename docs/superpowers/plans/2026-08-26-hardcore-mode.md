# Hardcore mode Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Čtvrtý herní režim — bez jména stanice, mapa pootočená o náhodný úhel, tři životy, hraje se dokud nedojdou.

**Architecture:** Rotace se řeší obalením `#tiles` a `#draw` do jednoho wrapperu `#map`, který se rotuje jako celek — kreslení i osy se rotují s mapou, takže převod px↔latlng zůstává beze změny. Plátno je `√2`× větší než výřez, aby pootočený čtverec nekoukal do rohů. Kola runu se derivují ze seedu přes `mulberry32`, takže server z jednoho čísla zrekonstruuje celý run a délku si spočítá sám.

**Tech Stack:** Vanilla ES moduly bez frameworku, Cloudflare Worker + D1, `node --test`. Zadání: `docs/superpowers/specs/2026-08-26-hardcore-mode-design.md`.

---

## Struktura souborů

**Nové**

| soubor | odpovědnost |
|---|---|
| `web/shared/hardcore.mjs` | konstanty režimu, derivace kola ze seedu, viewport s rotací, pravidla životů. Sdílí klient i server. |
| `src/api/hardcore.js` | POST (přepočet runu a zápis) + GET (žebříček přeživších) |
| `migrations/0002_hardcore.sql` | tabulka `hardcore` |
| `tests/hardcore.test.mjs` | testy pravidel, determinismu a rotovaného plátna |
| `web/fonts/nosifer-latin.woff2` | font nadpisů |

**Měněné**

| soubor | co se v něm mění |
|---|---|
| `web/tiles.mjs` | `vp.size` místo konstanty `VIEW_SIZE` |
| `web/index.html` | wrapper `#map`, `id` na popisek skóre |
| `web/board.mjs` | `mapPx`, rotace plátna, `getScreenCTM`, `straighten()`, přestup bez linek |
| `web/style.css` | `#map`, hardcore paleta, Nosifer, lebky, zrno |
| `web/app.mjs` | režim `hardcore`: intro, panel, životy, karty, odeslání runu |
| `web/shared/validate.mjs` | `span` u `validateRound`, `hardcore` v `MODES` |
| `src/api/guess.js` | `hardcore` v `MODES`, `span` u bounds |
| `src/index.js` | routa `/api/hardcore` |

---

### Task 1: Pravidla životů

**Files:**
- Create: `web/shared/hardcore.mjs`
- Test: `tests/hardcore.test.mjs`

- [ ] **Step 1: Napiš padající test**

Vytvoř `tests/hardcore.test.mjs`:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { nextLives, runLength, LIVES_MAX } from '../web/shared/hardcore.mjs';

test('nextLives: nad 100 m bere život', () => {
  assert.equal(nextLives(3, 140), 2);
  assert.equal(nextLives(1, 100.1), 0);
});

test('nextLives: pod 15 m vrací život, ale nejvýš na strop', () => {
  assert.equal(nextLives(1, 9), 2);
  assert.equal(nextLives(LIVES_MAX, 1), LIVES_MAX);
});

test('nextLives: mezi 15 a 100 m se nic neděje', () => {
  assert.equal(nextLives(2, 15), 2);
  assert.equal(nextLives(2, 60), 2);
  assert.equal(nextLives(2, 100), 2);
});

test('nextLives: propadlé kolo (null) bere život', () => {
  assert.equal(nextLives(3, null), 2);
});

test('runLength: fatální kolo se počítá', () => {
  // tři špatná kola = tři ztracené životy, umírá ve třetím
  assert.equal(runLength([200, 200, 200, 200, 200]), 3);
});

test('runLength: run bez smrti vrací délku pole', () => {
  assert.equal(runLength([50, 50, 50]), 3);
});

test('runLength: regenerace run prodlouží', () => {
  // -1, +1, -1, -1, -1 → smrt až v šestém kole
  assert.equal(runLength([200, 5, 200, 200, 200, 200, 200]), 6);
});
```

- [ ] **Step 2: Spusť test, ať vidíš, že padá**

Run: `npm test`
Expected: FAIL — `Cannot find module '.../web/shared/hardcore.mjs'`

- [ ] **Step 3: Napiš minimální implementaci**

Vytvoř `web/shared/hardcore.mjs`:

```js
// Hardcore: bez jména stanice, mapa pootočená, tři životy.
// Sdílený modul — server si z něj zrekonstruuje run, který klient odehrál.

export const LIVES_MAX = 3;
export const LOSE_M = 100;   // horší kolo bere život
export const GAIN_M = 15;    // lepší kolo život vrací

// d = průměrná odchylka kola v metrech; null = propadlé kolo (nestihl všechny úsečky)
export function nextLives(lives, d) {
  if (d === null || d > LOSE_M) return lives - 1;
  if (d < GAIN_M) return Math.min(LIVES_MAX, lives + 1);
  return lives;
}

// kolik kol hráč odehrál, než mu došly životy; fatální kolo se počítá
export function runLength(distances) {
  let lives = LIVES_MAX;
  for (let i = 0; i < distances.length; i++) {
    lives = nextLives(lives, distances[i]);
    if (lives <= 0) return i + 1;
  }
  return distances.length;
}
```

- [ ] **Step 4: Spusť testy**

Run: `npm test`
Expected: PASS, sedm nových testů projde, staré taky.

- [ ] **Step 5: Commit**

```bash
git add web/shared/hardcore.mjs tests/hardcore.test.mjs
git commit -m "feat(hardcore): pravidla životů"
```

---

### Task 2: Kola ze seedu a viewport s rotací

**Files:**
- Modify: `web/shared/hardcore.mjs`
- Test: `tests/hardcore.test.mjs`

- [ ] **Step 1: Napiš padající testy**

Přidej na konec `tests/hardcore.test.mjs` (a doplň importy v hlavičce souboru na
`import { nextLives, runLength, hardcoreRound, hardcoreViewport, LIVES_MAX, SPAN } from '../web/shared/hardcore.mjs';`,
plus `import { roundViewport, VIEW_SIZE } from '../web/shared/seed.mjs';`):

```js
const STATIONS = [
  { id: 'a', name: 'A', lines: ['A'], axes: [{ line: 'A', pts: [[50.08, 14.43], [50.081, 14.431]] }] },
  { id: 'b', name: 'B', lines: ['B'], axes: [{ line: 'B', pts: [[50.09, 14.44], [50.091, 14.441]] }] },
  { id: 'c', name: 'C', lines: ['C'], axes: [{ line: 'C', pts: [[50.10, 14.45], [50.101, 14.451]] }] },
];

test('hardcoreRound: stejný seed a index dá stejné kolo', () => {
  const a = hardcoreRound(12345, 7, STATIONS);
  const b = hardcoreRound(12345, 7, STATIONS);
  assert.equal(a.station.id, b.station.id);
  assert.equal(a.u, b.u);
  assert.equal(a.rot, b.rot);
});

test('hardcoreRound: jiný index dá jiné kolo', () => {
  const seen = new Set();
  for (let i = 0; i < 20; i++) seen.add(hardcoreRound(999, i, STATIONS).rot);
  assert.equal(seen.size, 20, 'rotace se nesmí opakovat mezi koly');
});

test('hardcoreRound: hodnoty leží v povolených mezích', () => {
  for (let i = 0; i < 200; i++) {
    const r = hardcoreRound(4242, i, STATIONS);
    assert.ok(STATIONS.includes(r.station));
    assert.ok(r.u >= 0.2 && r.u <= 0.8, `u = ${r.u}`);
    assert.ok(r.v >= 0.2 && r.v <= 0.8, `v = ${r.v}`);
    assert.ok(r.rot >= 0 && r.rot < 2 * Math.PI, `rot = ${r.rot}`);
  }
});

test('hardcoreViewport: stejný střed jako jinde, ale větší plátno a úhel', () => {
  const round = hardcoreRound(7, 0, STATIONS);
  const plain = roundViewport(round);
  const hc = hardcoreViewport(round);
  assert.equal(hc.lat, plain.lat);
  assert.equal(hc.lng, plain.lng);
  assert.equal(hc.size, VIEW_SIZE * SPAN);
  assert.equal(hc.rot, round.rot);
});
```

- [ ] **Step 2: Spusť testy, ať vidíš, že padají**

Run: `npm test`
Expected: FAIL — `hardcoreRound is not a function`

- [ ] **Step 3: Doplň implementaci**

V `web/shared/hardcore.mjs` přidej import na první řádek souboru (nad komentář
zůstane hlavička, import patří hned za ni) a nové exporty za `LIVES_MAX`:

```js
import { mulberry32, roundViewport, VIEW_SIZE } from './seed.mjs';
```

```js
export const SPAN = Math.SQRT2;  // plátno vs. výřez, ať pootočený čtverec nekouká do rohů
export const MAX_ROUNDS = 500;   // strop na velikost payloadu při odeslání runu

const GOLDEN = 0x9e3779b1;

// i-té kolo runu. Každé kolo se seeduje zvlášť, aby server uměl odvodit
// libovolné kolo bez iterace přes ta předchozí.
export function hardcoreRound(seed, i, stations) {
  const rng = mulberry32((seed + Math.imul(i + 1, GOLDEN)) | 0);
  rng(); // první hodnota po skoku v seedu koreluje se sousedy — zahoď ji
  const station = stations[Math.floor(rng() * stations.length)];
  return { station, u: 0.2 + rng() * 0.6, v: 0.2 + rng() * 0.6, rot: rng() * 2 * Math.PI };
}

// viewport kola: střed jako jinde, ale větší plátno a úhel navíc
export function hardcoreViewport(round) {
  return { ...roundViewport(round), size: VIEW_SIZE * SPAN, rot: round.rot };
}
```

- [ ] **Step 4: Spusť testy**

Run: `npm test`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add web/shared/hardcore.mjs tests/hardcore.test.mjs
git commit -m "feat(hardcore): kola ze seedu a viewport s rotací"
```

---

### Task 3: Dlaždice umí jiné plátno než 600 m

**Files:**
- Modify: `web/tiles.mjs:13-32`, `web/tiles.mjs:63-73`
- Test: `tests/hardcore.test.mjs`

Dnes `tiles.mjs` počítá s konstantou `VIEW_SIZE`. Rotované plátno je `849 m`, ale
`vp.size` už ve viewportu je — stačí ho začít číst.

- [ ] **Step 1: Napiš padající test**

Přidej na konec `tests/hardcore.test.mjs` (a doplň import
`import { pxToLatLng, latLngToPx } from '../web/tiles.mjs';`):

```js
test('px↔latlng na rotovaném plátně: bod tam a zpátky', () => {
  const vp = { lat: 50.08, lng: 14.43, size: VIEW_SIZE * SPAN };
  const [lat, lng] = pxToLatLng(120, 700, vp, 849);
  const [x, y] = latLngToPx(lat, lng, vp, 849);
  assert.ok(Math.abs(x - 120) < 0.001, `x = ${x}`);
  assert.ok(Math.abs(y - 700) < 0.001, `y = ${y}`);
});

test('px↔latlng: roh plátna leží dál než půlka výřezu', () => {
  const vp = { lat: 50.08, lng: 14.43, size: VIEW_SIZE * SPAN };
  const [lat] = pxToLatLng(0, 0, vp, 849);
  const north = (lat - vp.lat) * 111320;
  assert.ok(north > VIEW_SIZE / 2, `roh je ${north} m od středu, čekáme přes 300`);
});
```

- [ ] **Step 2: Spusť testy, ať vidíš, že padají**

Run: `npm test`
Expected: FAIL — druhý test spadne, `pxToLatLng` počítá s 600 m místo 849.

- [ ] **Step 3: Přepiš tiles.mjs na vp.size**

V `web/tiles.mjs` uprav `layout` (řádky 13–19) — přidej `span` a použij ho místo `VIEW_SIZE`:

```js
export function layout(vp, sizePx) {
  const span = vp.size ?? VIEW_SIZE;   // hardcore kreslí na větší plátno, ať rotace nekouká do rohů
  const halfLng = (span / 2) / mPerDegLng(vp.lat);
  const halfLat = (span / 2) / M_PER_DEG_LAT;
```

A oba převody na konci souboru (řádky 63–73):

```js
export function pxToLatLng(px, py, vp, sizePx) {
  const span = vp.size ?? VIEW_SIZE;
  const east = (px / sizePx - 0.5) * span;
  const north = (0.5 - py / sizePx) * span;
  return [vp.lat + north / M_PER_DEG_LAT, vp.lng + east / mPerDegLng(vp.lat)];
}

export function latLngToPx(lat, lng, vp, sizePx) {
  const span = vp.size ?? VIEW_SIZE;
  const east = (lng - vp.lng) * mPerDegLng(vp.lat);
  const north = (lat - vp.lat) * M_PER_DEG_LAT;
  return [((east / span) + 0.5) * sizePx, (0.5 - north / span) * sizePx];
}
```

- [ ] **Step 4: Spusť testy**

Run: `npm test`
Expected: PASS — projdou i staré `tests/geo.test.mjs` a `tests/seed.test.mjs`.

- [ ] **Step 5: Commit**

```bash
git add web/tiles.mjs tests/hardcore.test.mjs
git commit -m "feat(hardcore): dlaždice čtou velikost plátna z viewportu"
```

---

### Task 4: Bounds na serveru pustí rohy plátna

**Files:**
- Modify: `web/shared/validate.mjs:7`, `web/shared/validate.mjs:13-26`
- Test: `tests/hardcore.test.mjs`

Bez toho by hardcore kola tiše propadala na chybu `bounds` a nezalogovala se —
`fetch` v `logGuess` chybu polyká.

- [ ] **Step 1: Napiš padající test**

Přidej na konec `tests/hardcore.test.mjs` (a doplň import
`import { validateRound } from '../web/shared/validate.mjs';`):

```js
test('validateRound: bod v rohu plátna projde jen se span', () => {
  const station = STATIONS[0];
  const round = { station, u: 0.5, v: 0.5 };
  const vp = roundViewport(round);
  // 380 m na sever od středu výřezu — mimo 600m čtverec, uvnitř 849m plátna
  const far = vp.lat + 380 / 111320;
  const segments = [[[far, vp.lng], [far + 0.0005, vp.lng]]];

  assert.equal(validateRound(segments, round).ok, false, 'bez span musí spadnout');
  assert.equal(validateRound(segments, round).error, 'bounds');
  assert.equal(validateRound(segments, round, { span: VIEW_SIZE * SPAN }).ok, true);
});
```

- [ ] **Step 2: Spusť test, ať vidíš, že padá**

Run: `npm test`
Expected: FAIL — třetí assert, `validateRound` `span` zatím ignoruje.

- [ ] **Step 3: Přidej span do validateRound**

V `web/shared/validate.mjs` uprav hlavičku funkce a bounds check:

```js
// segments = úsečky jednoho kola, jedna na každou linku stanice: [[[lat,lng],[lat,lng]], ...]
// round: {station, u, v}; allowPartial = propadlé kolo, hráč nemusel stihnout všechny úsečky
// span = hrana plátna v metrech; hardcore rotuje, takže se kreslí i mimo 600m výřez
export function validateRound(segments, round, { allowPartial = false, span = VIEW_SIZE } = {}) {
```

```js
      const [x, y] = toLocalMeters(p[0], p[1], vp);
      if (Math.abs(x) > span / 2 + MARGIN || Math.abs(y) > span / 2 + MARGIN) return { ok: false, error: 'bounds' };
```

A ve stejném souboru na řádku 7 přidej režim do seznamu pro hlášení chyb:

```js
const MODES = ['weekly', 'warmup', 'casual', 'duel', 'hardcore'];
```

- [ ] **Step 4: Spusť testy**

Run: `npm test`
Expected: PASS — projde i `tests/validate.test.mjs`, default `span` je pořád 600.

- [ ] **Step 5: Commit**

```bash
git add web/shared/validate.mjs tests/hardcore.test.mjs
git commit -m "feat(hardcore): validace pustí tahy z rohů rotovaného plátna"
```

---

### Task 5: Rotující plátno v board.mjs

**Files:**
- Modify: `web/index.html:41-42`
- Modify: `web/board.mjs` (importy, `sizePx`/`mapPx`, kreslení, `setRound`, `resize`, `straighten`, `buildTransfer`)
- Modify: `web/style.css:119-121`

Tohle je jádro rotace. `#tiles` a `#draw` se obalí do `#map`, který se rotuje jako
celek — tím pádem hráč kreslí v souřadnicích plátna a **žádný převod se nemění**.

- [ ] **Step 1: Obal mapu wrapperem**

V `web/index.html` nahraď řádky 41–42:

```html
      <div id="tiles"></div>
      <svg id="draw"></svg>
```

za:

```html
      <!-- #tiles a #draw rotují jako jeden kus (hardcore), proto ten wrapper:
           hráč pak kreslí rovnou v souřadnicích plátna a převod px↔latlng se nemění -->
      <div id="map">
        <div id="tiles"></div>
        <svg id="draw"></svg>
      </div>
```

Ve stejném souboru přidej `id` popisku skóre (řádek 78), bude ho přepínat JS:

```html
          <span class="label" id="score-label">skóre</span>
```

- [ ] **Step 2: Uprav CSS pro wrapper**

V `web/style.css` nahraď řádky 119–121:

```css
#tiles { position: absolute; inset: 0; }
#tiles img { transition: opacity 0.35s var(--ease); }
#draw { position: absolute; inset: 0; width: 100%; height: 100%; cursor: crosshair; }
```

za:

```css
/* Plátno bývá větší než stage (hardcore rotuje) — rozměr a posun mu dopočítá
   board.mjs, protože závisí na vp.size. Proto ne inset: 0, ale left/top/šířka:
   inset je zkratka, která by JS nastavené left a top přepsala zpátky na nulu. */
#map { position: absolute; left: 0; top: 0; width: 100%; height: 100%; }
#tiles { position: absolute; inset: 0; }
#tiles img { transition: opacity 0.35s var(--ease); }
#draw { position: absolute; inset: 0; width: 100%; height: 100%; cursor: crosshair; }
```

- [ ] **Step 3: Přepiš board.mjs na plátno**

V `web/board.mjs` uprav importy (řádek 3) a element cache (řádek 6):

```js
import { renderTiles, prefetchTiles, pxToLatLng, latLngToPx } from './tiles.mjs';
import { VIEW_SIZE } from './shared/seed.mjs';
```

```js
const stage = $('stage'), mapEl = $('map'), tilesEl = $('tiles'), svg = $('draw'),
  overlay = $('overlay'), hintEl = $('hint');
```

Nahraď řádek 24–26:

```js
export const sizePx = () => stage.clientWidth;
export const count = () => segs.length;
export const segments = () => segs.map(seg => seg.map(([x, y]) => pxToLatLng(x, y, viewport, sizePx())));
```

za:

```js
export const sizePx = () => stage.clientWidth;
// plátno je o SPAN větší než výřez, kreslí se v jeho px — ne v px stage
const mapPx = () => sizePx() * ((viewport?.size ?? VIEW_SIZE) / VIEW_SIZE);
export const count = () => segs.length;
export const segments = () => segs.map(seg => seg.map(([x, y]) => pxToLatLng(x, y, viewport, mapPx())));

// rozměr, posun a úhel plátna; animate = narovnání po dohraném kole
const STRAIGHTEN_MS = 600;
function placeMap(rot, animate = false) {
  const px = mapPx(), off = (sizePx() - px) / 2;
  mapEl.style.width = mapEl.style.height = `${px}px`;
  mapEl.style.left = mapEl.style.top = `${off}px`;
  mapEl.style.transition = animate ? `rotate ${STRAIGHTEN_MS}ms var(--ease)` : 'none';
  mapEl.style.rotate = `${rot}rad`;
}
```

- [ ] **Step 4: Ber souřadnice kliku přes matici, ne offsetX**

V `web/board.mjs` nahraď obsluhy ukazatele (řádky 96–119) — `offsetX` na
pootočeném rodiči lže, `getScreenCTM` je správně vždycky:

```js
// offsetX by na pootočeném plátně lhal — matice SVG je správně při jakékoli transformaci
const localPoint = e => {
  const p = new DOMPoint(e.clientX, e.clientY).matrixTransform(svg.getScreenCTM().inverse());
  return [p.x, p.y];
};

svg.addEventListener('pointerdown', e => {
  // revealed = kolo dohráno; při prohlížení osy je overlay schovaný, ale kreslit se nesmí
  if (!overlay.hidden || revealed) return;
  hideHint(true);
  svg.setPointerCapture(e.pointerId);
  const p = localPoint(e);
  if (anchor) { commitSegment(anchor, p); anchor = cursor = null; }  // druhý klik dokončí úsečku
  else { anchor = p; cursor = p; pressing = true; }
  redraw();
});
svg.addEventListener('pointermove', e => {
  if (!anchor) return;
  cursor = localPoint(e);
  redraw();
});
svg.addEventListener('pointerup', () => {
  // tah = hotová úsečka; pouhé kliknutí nechá začátek viset a čeká na druhý klik
  if (pressing && anchor && cursor && Math.hypot(cursor[0] - anchor[0], cursor[1] - anchor[1]) > 10) {
    commitSegment(anchor, cursor);
    anchor = cursor = null;
  }
  pressing = false;
  redraw();
});
```

- [ ] **Step 5: Postav plátno v setRound a resize**

V `web/board.mjs` nahraď `setRound` (řádky 131–141):

```js
// vp: {lat,lng,size,rot} střed a plátno výřezu; req: kolik úseček kolo chce; lines: linky stanice
export function setRound(vp, req, lines = []) {
  viewport = vp;
  required = req;
  extra = () => '';
  revealed = false;
  segs = []; anchor = cursor = null;
  lastSize = sizePx();
  placeMap(vp.rot ?? 0);
  buildTransfer(lines);
  renderTiles(tilesEl, vp, mapPx());
  redraw();
}

// hardcore: po potvrzení se plátno i s kresbou a osami narovná na sever.
// Souřadnice se nepřepočítávají — všechny žijí v prostoru plátna.
// Vrací, o kolik ms se má odložit odhalení osy.
export function straighten() {
  revealed = true;              // během narovnání se už nesmí kreslit
  if (!viewport?.rot) return 0;
  placeMap(0, true);
  viewport = { ...viewport, rot: 0 };
  return STRAIGHTEN_MS;
}
```

A v obsluze `resize` (řádky 150–160) nahraď tělo `setTimeout`:

```js
    const size = sizePx();
    if (!viewport || !size || !lastSize || size === lastSize) return;
    const k = size / lastSize;
    const scale = ([x, y]) => [x * k, y * k];
    segs = segs.map(seg => seg.map(scale));
    if (anchor) anchor = scale(anchor);
    if (cursor) cursor = scale(cursor);
    lastSize = size;
    placeMap(viewport.rot ?? 0);
    renderTiles(tilesEl, viewport, mapPx());
    redraw();
```

- [ ] **Step 6: Osy a soupeřova čára taky v px plátna**

V `web/board.mjs` nahraď `sizePx()` uvnitř `axesMarkup` (řádek 179) a
`rivalMarkup` (řádek 189) za `mapPx()`:

```js
  const pts = axis.pts.map(([lat, lng]) => latLngToPx(lat, lng, viewport, mapPx()).join(',')).join(' ');
```

```js
  const [[x1, y1], [x2, y2]] = seg.map(([lat, lng]) => latLngToPx(lat, lng, viewport, mapPx()));
```

A v `prefetch` (řádek 163):

```js
export function prefetch(vp) { prefetchTiles(vp, sizePx() * ((vp.size ?? VIEW_SIZE) / VIEW_SIZE)); }
```

- [ ] **Step 7: Přestup umí i prázdné linky**

V `web/board.mjs` nahraď `buildTransfer` (řádky 54–81):

```js
function buildTransfer(lines) {
  countEl = null;
  transferEl.replaceChildren();
  if (required < 2) return paintTransfer();
  // hardcore posílá prázdné lines — že jde o přestup, se přiznat musí, ale které linky ne
  const tint = i => (lines[i] ? `var(--${lines[i].toLowerCase()})` : 'var(--hairline)');
  transferEl.style.setProperty('--l1', tint(0));
  transferEl.style.setProperty('--l2', tint(1));

  const badges = document.createElement('span');
  badges.className = 'transfer-badges';
  for (const l of lines) {
    const b = document.createElement('span');
    b.className = `badge ${l}`;
    b.textContent = l;
    badges.append(b);
  }
  const head = document.createElement('strong');
  head.textContent = `Přestup — ${required} úsečky!`;
  const text = document.createElement('span');
  text.className = 'transfer-text';
  text.append(head);
  if (lines.length > 1) {
    const sub = document.createElement('small');
    sub.textContent = `jednu pro ${lines[0]}, druhou pro ${lines[1]}`;
    text.append(sub);
  }

  countEl = document.createElement('span');
  countEl.className = 'transfer-count';
  transferEl.replaceChildren(badges, text, countEl);
  paintTransfer();
}
```

- [ ] **Step 8: Ověř, že se nic nerozbilo**

Run: `npm test`
Expected: PASS

Run: `npm run dev` a v prohlížeči odehraj jedno kolo casual režimu.
Expected: mapa vypadá jako dřív, kreslení sedí na snímek, po potvrzení najede osa
přesně po kolejích. (Rotace zatím nikde není — jen se ověřuje, že refaktor nic
neposunul.)

- [ ] **Step 9: Commit**

```bash
git add web/index.html web/board.mjs web/style.css
git commit -m "refactor(board): kreslení a dlaždice v jednom rotovatelném plátně"
```

---

### Task 6: Font, paleta a lebky

**Files:**
- Create: `web/fonts/nosifer-latin.woff2`
- Modify: `web/style.css`

- [ ] **Step 1: Stáhni Nosifer**

```bash
cd "$(git rev-parse --show-toplevel)"
URL=$(curl -sL -H 'User-Agent: Mozilla/5.0 (Macintosh) AppleWebKit/537.36 Chrome/120 Safari/537.36' \
  'https://fonts.googleapis.com/css2?family=Nosifer&display=swap' | grep -o 'https://[^)]*\.woff2' | head -1)
echo "$URL"
curl -sL "$URL" -o web/fonts/nosifer-latin.woff2
ls -l web/fonts/nosifer-latin.woff2
```

Expected: soubor má zhruba 15–30 kB. Když je prázdný nebo `URL` nic nevypsalo,
stáhni woff2 ručně z <https://fonts.google.com/specimen/Nosifer> (licence SIL OFL)
a ulož ho pod stejným jménem.

- [ ] **Step 2: Zaregistruj font**

V `web/style.css` přidej za poslední `@font-face` (za řádek 38):

```css
/* Nosifer (SIL Open Font License) — jen hardcore nadpisy. Latin only, proto se
   sází výhradně na řetězce bez diakritiky, které si řídí kód (HARDCORE, ???,
   číslo kol, KONEC, +1/-1). Zbytek vět jede v Archivu, s háčky. */
@font-face {
  font-family: 'Nosifer';
  font-style: normal;
  font-weight: 400;
  font-display: swap;
  src: url(fonts/nosifer-latin.woff2) format('woff2');
  unicode-range: U+0000-00FF;
}
```

- [ ] **Step 3: Přidej hardcore paletu a výzdobu**

V `web/style.css` přidej na konec souboru:

```css
/* ---------- hardcore: šedý svět, jediná barva je krev ---------- */
/* Ortofoto zůstává barevné schválně — greyscale by hráči ubral informaci
   a režim by se tím ztížil nad rámec zadání. Šedne jen UI a kulisa. */
:root { --blood: #c1121f; --bone: #e8e4dc; }

/* Paleta se přepisuje proměnnými, ne filter: grayscale() na panelu — filtr by
   založil containing block a rozbil backdrop-filter matného skla.
   Platí i za hry: data-mode nastavuje úvod a startHardcore ho nepřepisuje. */
body[data-mode='hardcore'] {
  --mode: #6b7075; --on-mode: #fff;
  --accent: #6b7075; --on-accent: #fff;
  --a: var(--bone); --b: var(--bone); --c: var(--bone);
  --draw: var(--blood);
  --concrete: #0c0d0e; --alu: #17191b; --alu-hi: #202325;
  --hairline: #33383c; --muted: #8b8f93;
}
/* fotka obkladu je kulisa, ne podklad ke hraní */
body[data-mode='hardcore'] #bg div { filter: grayscale(1) brightness(0.35); }
/* urgentní odpočet musí zůstat krvavý, i když --c zbělelo */
body[data-mode='hardcore'] .clock.urgent strong { color: var(--blood); }
body[data-mode='hardcore'] #timebar.urgent span { background: var(--blood); }

.hc-type { font-family: Nosifer, Anton, sans-serif; letter-spacing: 0.02em; }
#station-name.hc-type { font-size: clamp(26px, 3vw, 38px); line-height: 1.3; }
.card h2.hc-type { line-height: 1.35; }
.card .big.hc-type { font-size: 52px; line-height: 1.3; color: var(--bone); }

/* zrno a scanline — přes panel a karty, vědomě ne přes snímek */
body[data-mode='hardcore'] #panel {
  background-image:
    url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='120' height='120'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='.9' numOctaves='3'/%3E%3C/filter%3E%3Crect width='120' height='120' filter='url(%23n)' opacity='.25'/%3E%3C/svg%3E"),
    repeating-linear-gradient(0deg, rgba(0, 0, 0, 0.25) 0 1px, transparent 1px 3px);
}
body[data-mode='hardcore'] .card::after {
  content: ''; position: absolute; inset: 0; pointer-events: none;
  background:
    url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='120' height='120'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='.9' numOctaves='3'/%3E%3C/filter%3E%3Crect width='120' height='120' filter='url(%23n)' opacity='.25'/%3E%3C/svg%3E"),
    repeating-linear-gradient(0deg, rgba(0, 0, 0, 0.22) 0 1px, transparent 1px 3px);
  opacity: 0.55;
}

/* velká lebka jako vodoznak v pozadí panelu */
body[data-mode='hardcore'] #panel::after {
  content: ''; position: absolute; right: -40px; bottom: -30px;
  width: 300px; height: 300px; pointer-events: none; z-index: 0;
  opacity: 0.05;
  background: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='none' stroke='%23ffffff' stroke-width='1.4'%3E%3Cpath d='M12 2c-4.4 0-8 3.4-8 7.6 0 2.6 1.3 4.6 3 5.8V19a1 1 0 0 0 1 1h8a1 1 0 0 0 1-1v-3.6c1.7-1.2 3-3.2 3-5.8C20 5.4 16.4 2 12 2Z'/%3E%3Ccircle cx='9' cy='10' r='1.7' fill='%23ffffff'/%3E%3Ccircle cx='15' cy='10' r='1.7' fill='%23ffffff'/%3E%3Cpath d='M12 13v2M9.5 20v-2.6M14.5 20v-2.6'/%3E%3C/svg%3E") center/contain no-repeat;
}
body[data-mode='hardcore'] #panel > * { position: relative; z-index: 1; }

/* tři lebky místo teček průběhu */
body[data-mode='hardcore'] .progress { gap: 12px; padding: 4px 0; }
body[data-mode='hardcore'] .progress li { flex: none; height: auto; background: none; }
body[data-mode='hardcore'] .progress li::after { content: none; }
.progress li.life svg { width: 30px; height: 30px; color: var(--bone); }
.progress li.life.lost svg { color: #3a3e41; }
.progress li.just-lost { animation: skull-shake 0.5s var(--ease); }
@keyframes skull-shake {
  25% { transform: translateX(-4px) rotate(-9deg); }
  75% { transform: translateX(4px) rotate(9deg); }
}

/* poznámka o životě na výsledkové kartě */
.life-note { font: 600 15px/1 Archivo, sans-serif; letter-spacing: 0.1em; text-transform: uppercase; }
.life-note .hc-type { font-size: 22px; margin-right: 6px; vertical-align: -2px; }
.life-note.lost { color: var(--blood); }
.life-note.gained { color: var(--bone); }

/* vstup do režimu: lebka v rohu úvodní karty, mimo řadu tabů */
.card { position: relative; }
.skull {
  position: absolute; top: 10px; right: 10px;
  width: 38px; height: 38px; display: grid; place-items: center;
  border: 1px solid var(--hairline); background: #101315; color: #6b7075;
  cursor: pointer;
  transition: color 0.2s var(--ease), border-color 0.2s var(--ease), background 0.2s var(--ease);
}
.skull svg { width: 22px; height: 22px; }
.skull:hover { color: #e8e4dc; border-color: #6b7075; }
.skull.on { color: #e8e4dc; border-color: #6b7075; background: #1b1e20; }
```

- [ ] **Step 4: Ověř, že se nic nerozbilo**

Run: `npm run dev`, otevři aplikaci a projdi taby standard/duel/casual.
Expected: vypadá to přesně jako dřív — všechna nová pravidla visí na
`body[data-mode='hardcore']`, který zatím nikdo nenastavuje. `.card { position:
relative }` nic neposune.

- [ ] **Step 5: Commit**

```bash
git add web/fonts/nosifer-latin.woff2 web/style.css
git commit -m "feat(hardcore): font Nosifer, šedá paleta, lebky a zrno"
```

---

### Task 7: Vstup do režimu a rozehrání

**Files:**
- Modify: `web/app.mjs` (importy, stav, `ICON`, `vp`, `updateTask`, `paintPanel`, `startHardcore`, `showIntro`)

- [ ] **Step 1: Importy, stav a ikona lebky**

V `web/app.mjs` přidej k importům (za řádek 4):

```js
import { hardcoreRound, hardcoreViewport, nextLives, LIVES_MAX, MAX_ROUNDS } from './shared/hardcore.mjs';
```

Za deklaraci `let lines = [];` (řádek 29) přidej stav runu:

```js
// hardcore: seed určuje celý run, hcRun se na konci pošle serveru k přepočtu
let hcSeed = 0, hcRun = [], lives = LIVES_MAX, lostThisRound = false;
const hcBestKey = 'pmg-hc-best';
```

Do objektu `ICON` (za řádek 44) přidej lebku:

```js
  skull: svg('<path d="M12 2c-4.4 0-8 3.4-8 7.6 0 2.6 1.3 4.6 3 5.8V19a1 1 0 0 0 1 1h8a1 1 0 0 0 1-1v-3.6'
    + 'c1.7-1.2 3-3.2 3-5.8C20 5.4 16.4 2 12 2Z"/><circle cx="9" cy="10" r="1.7" fill="currentColor" stroke="none"/>'
    + '<circle cx="15" cy="10" r="1.7" fill="currentColor" stroke="none"/>'
    + '<path d="M12 13v2"/><path d="M9.5 20v-2.6"/><path d="M14.5 20v-2.6"/>'),
```

- [ ] **Step 2: Viewport kola podle režimu**

V `web/app.mjs` nahraď řádek 34:

```js
const vp = () => (mode === 'hardcore'
  ? hardcoreViewport(rounds[roundIdx])   // větší plátno + náhodný úhel
  : roundViewport(rounds[roundIdx]));
```

- [ ] **Step 3: Popisek kola**

V `web/app.mjs` nahraď v `updateTask` výpočet `where` a `task` (řádky 59–65):

```js
  const st = rounds[roundIdx].station;
  const hc = mode === 'hardcore';
  const where = mode === 'casual' ? 'casual mode'
    : hc ? `hardcore · kolo ${roundIdx + 1}`
      : `${mode === 'warmup' ? 'rozehřátí' : 'kolo'} ${roundIdx + 1} z ${rounds.length}`;
  const task = st.lines.length > 1
    ? (hc
      // v hardcore se přiznává jen počet úseček, linky ne
      ? `nakresli 2 úsečky (${board.count()}/2)`
      : `přestup ${st.lines.join('+')} · nakresli ${st.lines.length} úsečky (${board.count()}/${st.lines.length})`)
    : 'nakresli osu nástupiště jednou úsečkou';
  $('round-label').textContent = `${where} · ${task}`;
```

- [ ] **Step 4: Panel bez jména, se třemi lebkami**

V `web/app.mjs` nahraď celou funkci `paintPanel` (řádky 68–90):

```js
// tři lebky místo teček průběhu; zhaslá = ztracený život
const skullRow = () => Array.from({ length: LIVES_MAX }, (_, i) => {
  const li = document.createElement('li');
  const alive = i < lives;
  li.className = `life${alive ? '' : ' lost'}${!alive && lostThisRound && i === lives ? ' just-lost' : ''}`;
  li.append(...parseHtml(ICON.skull));
  return li;
});

function paintPanel() {
  const st = rounds[roundIdx].station;
  const hc = mode === 'hardcore';
  if (!hc) {
    document.documentElement.style.setProperty('--accent', `var(--${st.lines[0].toLowerCase()})`);
    document.documentElement.style.setProperty('--on-accent', st.lines[0] === 'B' ? '#1a1400' : '#fff');
  }
  setBackdrop(hc ? null : st.name); // fotka podle stanice by ji v hardcore prozradila
  $('station-name').textContent = hc ? '???' : st.name;
  $('station-name').classList.toggle('hc-type', hc);
  $('line-badges').replaceChildren(...(hc ? [] : st.lines.map(l => {
    const b = document.createElement('span');
    b.className = `badge ${l}`;
    b.textContent = l;
    return b;
  })));
  updateTask();
  $('progress').replaceChildren(...(hc ? skullRow()
    : mode !== 'casual'
      ? Array.from({ length: rounds.length }, (_, i) => {
        const li = document.createElement('li');
        if (i < roundIdx) li.className = 'done';
        else if (i === roundIdx) li.className = 'now';
        return li;
      })
      : []));
  // v hardcore nejsou body, jediné číslo je počet odehraných kol
  $('score-label').textContent = hc ? 'kola' : 'skóre';
  if (hc) $('score-value').textContent = String(roundIdx + 1);
  $('home').hidden = mode === 'weekly';
}
```

- [ ] **Step 5: Rozehrání runu**

V `web/app.mjs` přidej za funkci `startWeekly` (za řádek 427):

```js
// hardcore: seed si losuje klient, server z něj celý run zrekonstruuje
function startHardcore() {
  mode = 'hardcore';
  hcSeed = (Math.random() * 2 ** 32) >>> 0;
  hcRun = []; lives = LIVES_MAX; lostThisRound = false;
  roundIdx = 0; totalScore = 0;
  rounds = [hardcoreRound(hcSeed, 0, stations)];
  startRound();
}
```

- [ ] **Step 6: Lebka v rohu úvodní karty**

V `web/app.mjs` uprav popisky režimů (řádky 474–478) — přidej hardcore:

```js
const TAB_META = {
  standard: `${ROUNDS} stanic · na čas · zápis do žebříčku`,
  duel: '1v1 · stejná kola · kdo je blíž',
  casual: 'bez času · bez konce · bez zápisu',
  hardcore: '3 životy · mapa pootočená · bez jména stanice',
};
```

Nahraď `step2` (řádky 487–489) trojicí funkcí pro kroky tutoriálu:

```js
// mezi režimy se liší text kroků — casual nemá odpočet, hardcore nemá jméno stanice
// jak se kreslí říká hint v prvním kole (board.maybeShowHint), tady se to neopakuje
const step1 = tab => (tab === 'hardcore'
  ? 'Dostaneš letecký snímek 600 × 600 m — pootočený o náhodný úhel.<br><span>Která stanice to je, se nedozvíš.</span>'
  : 'Dostaneš letecký snímek 600 × 600 m a jméno stanice.<br><span>Stanice je někde uvnitř, ale pod zemí ji nevidíš.</span>');
const step2 = tab => (tab === 'casual'
  ? 'Nakresli úsečku, kudy vede nástupiště.'
  : `Za ${SECONDS.single} sekund nakresli úsečku, kudy vede nástupiště.`);
const step3 = tab => (tab === 'hardcore'
  ? 'Potvrdíš, mapa se narovná a uvidíš skutečnou osu.<br><span>Odchylka nad 100 m bere život, pod 15 m ho vrací. Máš tři.</span>'
  : 'Potvrdíš a uvidíš skutečnou osu kolejí.<br><span>Čím blíž jsi trefil, tím víc bodů — max 1000 za kolo.</span>');
```

V `introCta` (řádek 492) přidej hned za první řádek těla funkce:

```js
  if (tab === 'hardcore') return `
    <button class="btn btn-primary" id="hc-play">Hrát hardcore</button>
    <button class="btn btn-outline" id="hc-lb">Žebříček přeživších</button>`;
```

V `showIntro` nahraď šablonu karty a její zadrátování (řádky 522–557):

```js
  showCard(`
    <button class="skull ${introTab === 'hardcore' ? 'on' : ''}" id="go-hc"
      aria-label="Hardcore mode" title="Hardcore">${ICON.skull}</button>
    <p class="label">pražské metro · týden ${week}</p>
    <h2>Metro Guesser</h2>
    <div class="tabs" role="tablist" aria-label="režim hry">
      ${tabBtn('standard', 'Standard')}${tabBtn('duel', 'Duel')}${tabBtn('casual', 'Casual')}
    </div>
    <ol class="steps">
      <li><b>1</b><div>${step1(tab)}</div></li>
      <li><b>2</b><div>${step2(tab)}</div></li>
      <li><b>3</b><div>${step3(tab)}</div></li>
    </ol>
    <div class="cta">${introCta(tab, played)}</div>
  `, card => {
    if (switching) card.style.animation = 'none';
    $('go-hc').onclick = () => showIntro('hardcore');
    card.querySelectorAll('.tab').forEach(t => {
      t.onclick = () => showIntro(t.dataset.tab);
      t.onkeydown = e => {
        const dir = { ArrowLeft: -1, ArrowRight: 1 }[e.key];
        if (!dir) return;
        const next = TABS[(TABS.indexOf(introTab) + dir + TABS.length) % TABS.length];
        showIntro(next);
        $(`tab-${next}`).focus();
      };
    });
    if (tab === 'hardcore') {
      $('hc-play').onclick = startHardcore;
      $('hc-lb').onclick = () => showSurvivors();
    } else if (tab === 'casual') $('casual').onclick = startCasual;
    else if (tab === 'duel') {
      $('duel-find').onclick = () => askNick(findOpponent);
      $('duel-host').onclick = () => askNick(hostDuel);
    } else {
      $('warmup').onclick = startWarmup;
      if (played) {
        card.querySelector('#played-nick').textContent = played;
        $('lb').onclick = () => showLeaderboard(played);
      } else $('play').onclick = startWeekly;
    }
  });
```

`tabBtn` vyhodnocuje `aria-selected="${id === introTab}"`, takže při
`introTab === 'hardcore'` je automaticky nevybraný žádný tab — nic dalšího netřeba.

`showSurvivors` vznikne v Tasku 9; do té doby bude tlačítko žebříčku házet
`ReferenceError`. To je v pořádku, Task 8 na něj nesahá.

- [ ] **Step 7: Kolo předej boardu bez linek**

V `web/app.mjs` uprav `startRound` (řádek 128):

```js
  // hardcore nesmí prozradit linky ani pruhem o přestupu
  board.setRound(vp(), required(), mode === 'hardcore' ? [] : rounds[roundIdx].station.lines);
```

A o pár řádků níž nahraď natažení dlaždic dalšího kola (řádky 135–136) — v
hardcore další kolo v `rounds` ještě není, dá se ale odvodit ze seedu:

```js
  // snímek dalšího kola natáhni dopředu, ať je přepnutí okamžité
  if (mode === 'hardcore') board.prefetch(hardcoreViewport(hardcoreRound(hcSeed, roundIdx + 1, stations)));
  else {
    const next = rounds[roundIdx + 1];
    if (next) board.prefetch(roundViewport(next));
  }
```

- [ ] **Step 8: Ověř ručně**

Run: `npm run dev`
Expected:
- na úvodní kartě je vpravo nahoře šedá lebka,
- klik na ni zšedne celou obrazovku a ukáže hardcore kroky,
- „Hrát hardcore" rozehraje kolo: v panelu `???`, žádné odznaky, tři bílé lebky,
  popisek `kola` místo `skóre`, **mapa je pootočená** a kreslení sedí na snímek,
- klik na tab Standard vrátí barvy zpátky.

Potvrzení kola zatím spadne na chybějící logice životů — to je Task 8.

- [ ] **Step 9: Commit**

```bash
git add web/app.mjs
git commit -m "feat(hardcore): vstup lebkou, rozehrání a šedý panel bez jména"
```

---

### Task 8: Životy, výsledková karta a konec runu

**Files:**
- Modify: `web/app.mjs` (`startRound`, `finishRound`, `forfeitRound`, `showResultCard`, `renderResult`, `nextLabel`, `advance`, `endRun`)

- [ ] **Step 1: Narovnání plátna před odhalením osy**

V `web/app.mjs` nahraď `showResultCard` (řádek 175):

```js
// hardcore: nejdřív se plátno narovná na sever, teprve pak najede osa
function reveal(station) {
  const wait = board.straighten();
  setTimeout(() => board.revealAxes(station.axes), wait);
  return wait;
}

// reveal osy ještě chvíli běží — kartu ukaž až po něm
const showResultCard = (wait, ...args) => setTimeout(() => renderResult(...args), 1200 + wait);
```

- [ ] **Step 2: Životy ve finishRound**

V `web/app.mjs` nahraď `finishRound` (řádky 143–159):

```js
// poznámka o životě na výsledkové kartě; Nosifer umí jen ASCII, proto ta znaménka zvlášť
const LIFE_NOTE = {
  lost: '<p class="life-note lost"><span class="hc-type">-1</span>život</p>',
  gained: '<p class="life-note gained"><span class="hc-type">+1</span>život</p>',
  held: '<p class="life-note">držíš se</p>',
};
let lifeNote = '';

// timedOut: vypršel čas — co je nakresleno se počítá, neúplné kolo propadá za 0
function finishRound(timedOut) {
  board.timerStop();
  const station = rounds[roundIdx].station;
  const segments = board.segments();
  if (timedOut && segments.length < required()) return forfeitRound(station, segments);

  const { d, score, perLine } = scoreRound(segments, station);
  logGuess({ station, segments, timedOut, forfeited: false });
  if (mode === 'weekly') { lines.push(segments); }
  if (mode === 'hardcore') { hcRun.push(segments); takeLife(d); }
  if (mode !== 'casual' && mode !== 'hardcore') { totalScore += score; setScore(totalScore); }
  board.hideHint(true);
  const wait = reveal(station);
  const detail = perLine.length > 1
    ? perLine.map(r => `linka ${r.line}: ${Math.round(r.d)} m`).join(' · ')
    : `odchylka ${Math.round(d)} m od skutečné osy`;
  const big = mode === 'hardcore' ? `${Math.round(d)} m` : `+${score}`;
  showResultCard(wait, station, big, timedOut ? `čas vypršel · ${detail}` : detail, segments);
}

// d = průměrná odchylka, null = propadlé kolo; přepočítá životy a text na kartě
function takeLife(d) {
  const before = lives;
  lives = nextLives(lives, d);
  lostThisRound = lives < before;
  lifeNote = LIFE_NOTE[lives < before ? 'lost' : lives > before ? 'gained' : 'held'];
}
```

- [ ] **Step 3: Životy ve forfeitRound**

V `web/app.mjs` nahraď `forfeitRound` (řádky 162–172):

```js
// vypršel čas a chybí úsečka → 0 bodů, ale osu ukaž (hráč se má co naučit)
function forfeitRound(station, segments) {
  // i rozkreslené úsečky jsou data — hráč začal a nestihl
  logGuess({ station, segments, timedOut: true, forfeited: true });
  if (mode === 'weekly') lines.push(null);
  if (mode === 'hardcore') { hcRun.push(null); takeLife(null); }
  board.hideHint(true);
  board.clear();
  const wait = reveal(station);
  showResultCard(wait, station, mode === 'hardcore' ? '—' : '0', required() > 1
    ? 'Čas vypršel — u přestupní stanice musíš stihnout obě úsečky.'
    : 'Čas vypršel — nestihl jsi nakreslit úsečku.', null);
}
```

- [ ] **Step 4: Výsledková karta**

V `web/app.mjs` nahraď `renderResult` (řádky 177–196):

```js
function renderResult(station, big, detail, segments) {
  const where = mode === 'weekly' ? `kolo ${roundIdx + 1} z ${rounds.length}`
    : mode === 'warmup' ? `rozehřátí ${roundIdx + 1} z ${rounds.length}`
      : mode === 'hardcore' ? `hardcore · kolo ${roundIdx + 1}` : 'casual';
  showCard(`
    <p class="label">${where}</p>
    <h2></h2>
    <div class="big">${big}</div>
    ${mode === 'hardcore' ? lifeNote : ''}
    <p>${detail}</p>
    <button class="btn btn-primary" id="next">${nextLabel()}</button>
    <button class="btn btn-outline" id="report">${ICON.warn}Stanice je zadaná špatně</button>
    <button class="link-btn" id="peek">prohlédnout mapu →</button>
    ${mode === 'casual' ? '<button class="link-btn" id="back">← zpět na začátek</button>' : ''}
  `, card => {
    card.querySelector('h2').textContent = station.name; // po odpovědi už není co tajit
    $('next').onclick = advance;
    if (mode === 'casual') $('back').onclick = () => showIntro();
    $('report').onclick = () => showReportCard({ station, big, detail, segments });
    $('peek').onclick = () => peekMap(() => renderResult(station, big, detail, segments));
  });
}
```

- [ ] **Step 5: Popisek tlačítka a postup dál**

V `web/app.mjs` nahraď `nextLabel` a `advance` (řádky 287–296):

```js
const nextLabel = () =>
  mode === 'casual' ? 'Další stanice'
    : mode === 'hardcore' ? (lives <= 0 ? 'Konec runu' : 'Další kolo')
      : roundIdx + 1 < rounds.length ? 'Další kolo'
        : mode === 'warmup' ? 'Vyhodnocení rozehřátí' : 'Vyhodnocení';

function advance() {
  if (mode === 'casual') { rounds = [randomRound()]; roundIdx = 0; startRound(); return; }
  if (mode === 'hardcore') {
    // MAX_ROUNDS je strop payloadu při odeslání runu, ne herní pravidlo
    if (lives <= 0 || rounds.length >= MAX_ROUNDS) return endRun();
    rounds.push(hardcoreRound(hcSeed, ++roundIdx, stations));
    startRound();
    return;
  }
  roundIdx++;
  roundIdx < rounds.length ? startRound() : (mode === 'warmup' ? finishWarmup() : finish());
}
```

- [ ] **Step 6: Karta konce runu**

V `web/app.mjs` přidej za `startHardcore`:

```js
const kola = n => (n === 1 ? 'kolo' : n < 5 ? 'kola' : 'kol');

function endRun() {
  const played = rounds.length;   // fatální kolo se počítá
  const best = Math.max(Number(localStorage.getItem(hcBestKey) || 0), played);
  localStorage.setItem(hcBestKey, String(best));
  showCard(`
    <p class="label">hardcore · konec</p>
    <h2 class="hc-type">KONEC</h2>
    <div class="big hc-type">${played}</div>
    <p>Přežil jsi ${played} ${kola(played)}. Tvůj rekord je ${best}.</p>
    <input id="nick" maxlength="16" placeholder="přezdívka (3–16 znaků)">
    <p class="error" id="submit-err"></p>
    <button class="btn btn-primary" id="submit">Zapsat mezi přeživší</button>
    <button class="btn btn-outline" id="again">Hrát znovu</button>
    <button class="link-btn" id="back">← zpět na začátek</button>
  `, () => {
    $('nick').value = localStorage.getItem('pmg-nick') ?? '';
    $('submit').onclick = submitRun;
    $('again').onclick = startHardcore;
    $('back').onclick = () => showIntro();
  });
}
```

`submitRun` a `showSurvivors` vzniknou v Tasku 9.

- [ ] **Step 7: Ověř ručně**

Run: `npm run dev`, rozehraj hardcore a schválně kresli daleko od nástupiště.
Expected:
- po potvrzení se mapa **narovná na sever** i s tvojí čárou, teprve pak najede osa,
- karta ukáže metry místo bodů a pod tím krvavé `-1 život`,
- v panelu zhasne jedna lebka a otřese se,
- po třech ztrátách se tlačítko jmenuje „Konec runu" a vede na kartu KONEC
  s číslem a rekordem,
- kolo blíž než 15 m vrátí život (nejvýš na tři).

Tlačítko „Zapsat mezi přeživší" zatím spadne — Task 9.

- [ ] **Step 8: Commit**

```bash
git add web/app.mjs
git commit -m "feat(hardcore): životy, narovnání mapy a konec runu"
```

---

### Task 9: Server — přepočet runu a žebříček

**Files:**
- Create: `migrations/0002_hardcore.sql`
- Create: `src/api/hardcore.js`
- Modify: `src/index.js:1-25`
- Modify: `src/api/guess.js`

- [ ] **Step 1: Migrace**

Vytvoř `migrations/0002_hardcore.sql`:

```sql
-- hardcore: jeden řádek na hráče, drží jeho nejdelší run (all-time, ne po týdnech)
CREATE TABLE IF NOT EXISTS hardcore (
  nick TEXT NOT NULL UNIQUE,
  rounds INTEGER NOT NULL,      -- kolik kol přežil; počítá server z run_json, ne klient
  seed INTEGER NOT NULL,        -- z něj se dají kola runu zrekonstruovat
  run_json TEXT NOT NULL,       -- úsečky po kolech; null = propadlé kolo
  ip_hash TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_hardcore_rounds ON hardcore(rounds DESC);
CREATE INDEX IF NOT EXISTS idx_hardcore_ip ON hardcore(ip_hash, created_at);
```

- [ ] **Step 2: Endpoint**

Vytvoř `src/api/hardcore.js`:

```js
import stations from '../../web/stations.json';
import { VIEW_SIZE } from '../../web/shared/seed.mjs';
import { scoreRound } from '../../web/shared/scoring.mjs';
import { validateRound } from '../../web/shared/validate.mjs';
import { hardcoreRound, nextLives, LIVES_MAX, MAX_ROUNDS, SPAN } from '../../web/shared/hardcore.mjs';
import { ipHash } from '../hash.js';

const json = (obj, status = 200) =>
  new Response(JSON.stringify(obj), { status, headers: { 'content-type': 'application/json' } });

const NICK_RE = /^[\p{L}\p{N} _-]{3,16}$/u;
const SPAN_M = VIEW_SIZE * SPAN; // hardcore rotuje, tahy sahají až do rohů plátna

export async function onRequestGet({ env }) {
  const { results } = await env.DB.prepare(
    'SELECT nick, rounds FROM hardcore ORDER BY rounds DESC, created_at ASC LIMIT 100'
  ).all();
  return json({ entries: results });
}

export async function onRequestPost({ request, env }) {
  const b = await request.json().catch(() => null);
  if (!b || typeof b !== 'object') return json({ error: 'body' }, 400);
  if (typeof b.nick !== 'string' || !NICK_RE.test(b.nick)) return json({ error: 'nick' }, 400);
  if (!Number.isInteger(b.seed) || b.seed < 0 || b.seed > 0xffffffff) return json({ error: 'seed' }, 400);
  if (!Array.isArray(b.rounds) || !b.rounds.length || b.rounds.length > MAX_ROUNDS) {
    return json({ error: 'rounds' }, 400);
  }

  // Délku runu počítá server ze seedu a odeslaných úseček — číslo od klienta neexistuje.
  // Kola za smrtí se zahodí, i kdyby je klient poslal.
  let lives = LIVES_MAX, played = 0;
  for (const segments of b.rounds) {
    const round = hardcoreRound(b.seed, played, stations);
    let d = null;
    if (segments !== null) {
      const v = validateRound(segments, round, { span: SPAN_M });
      if (!v.ok) return json({ error: `${v.error} round ${played}` }, 400);
      d = scoreRound(segments, round.station).d;
    }
    lives = nextLives(lives, d);
    played++;
    if (lives <= 0) break;
  }

  const ip = await ipHash(request.headers.get('cf-connecting-ip'), env);
  const { cnt } = await env.DB.prepare(
    "SELECT COUNT(*) AS cnt FROM hardcore WHERE ip_hash = ? AND created_at > datetime('now','-1 hour')"
  ).bind(ip).first();
  if (cnt >= 10) return json({ error: 'rate limit' }, 429);

  // žebříček je all-time, takže se zapisuje jen lepší run než ten uložený
  await env.DB.prepare(
    `INSERT INTO hardcore (nick, rounds, seed, run_json, ip_hash) VALUES (?, ?, ?, ?, ?)
     ON CONFLICT(nick) DO UPDATE SET
       rounds = excluded.rounds, seed = excluded.seed, run_json = excluded.run_json,
       ip_hash = excluded.ip_hash, created_at = datetime('now')
     WHERE excluded.rounds > hardcore.rounds`
  ).bind(b.nick, played, b.seed, JSON.stringify(b.rounds), ip).run();

  return json({ rounds: played });
}
```

- [ ] **Step 3: Routa**

V `src/index.js` přidej import za řádek 3:

```js
import * as hardcore from './api/hardcore.js';
```

a routu do `ROUTES`:

```js
  '/api/hardcore': { GET: hardcore.onRequestGet, POST: hardcore.onRequestPost },
```

- [ ] **Step 4: Logování kol hardcore**

V `src/api/guess.js` uprav importy a bounds. Přidej k importům:

```js
import { isoWeek, VIEW_SIZE } from '../../web/shared/seed.mjs';
import { SPAN } from '../../web/shared/hardcore.mjs';
```

(řádek s `import { isoWeek } ...` se tím nahradí)

Rozšiř `MODES`:

```js
const MODES = new Set(['weekly', 'warmup', 'casual', 'hardcore']);
```

A nahraď volání `validateRound`:

```js
  // úsečky musí ležet uvnitř výřezu, který si klient nárokuje — jinak je přepočet skóre nesmysl
  // hardcore kreslí do pootočeného plátna, tam sahají tahy až do rohů
  const span = b.mode === 'hardcore' ? VIEW_SIZE * SPAN : VIEW_SIZE;
  const v = validateRound(b.segments, { station, u: b.u, v: b.v }, { allowPartial: b.forfeited, span });
```

- [ ] **Step 5: Pusť migraci lokálně a ověř endpoint**

```bash
npm run migrate:local
npm test
```
Expected: migrace projde, testy projdou.

```bash
npm run dev
```
V druhém terminálu:

```bash
curl -s http://localhost:8787/api/hardcore
```
Expected: `{"entries":[]}`

```bash
curl -s -X POST http://localhost:8787/api/hardcore \
  -H 'content-type: application/json' \
  -d '{"nick":"test","seed":1,"rounds":[null,null,null]}'
```
Expected: `{"rounds":3}` — tři propadlá kola vezmou tři životy.

```bash
curl -s http://localhost:8787/api/hardcore
```
Expected: `{"entries":[{"nick":"test","rounds":3}]}`

- [ ] **Step 6: Commit**

```bash
git add migrations/0002_hardcore.sql src/api/hardcore.js src/index.js src/api/guess.js
git commit -m "feat(hardcore): server přepočítá run a vede žebříček přeživších"
```

---

### Task 10: Odeslání runu a žebříček přeživších

**Files:**
- Modify: `web/app.mjs` (`showLeaderboard`, `submitRun`, `showSurvivors`)

- [ ] **Step 1: Vytáhni vykreslení žebříčku do sdílené funkce**

V `web/app.mjs` nahraď tělo `showLeaderboard` od `const box = $('lb-list');` dolů
(řádky 374–397) tímhle a přidej nad `showLeaderboard` pomocnou funkci:

```js
// jeden seznam pro oba žebříčky; nick je nedůvěryhodný → jen textContent
function boardList(entries, me, valueOf) {
  const ol = document.createElement('ol');
  ol.className = 'board';
  entries.forEach((e, i) => {
    const li = document.createElement('li');
    if (e.nick === me) li.className = 'me';
    const rank = document.createElement('span');
    rank.className = 'rank';
    rank.textContent = `${i + 1}.`;
    const nick = document.createElement('span');
    nick.textContent = e.nick;
    const value = document.createElement('span');
    value.textContent = valueOf(e);
    li.append(rank, nick, value);
    ol.appendChild(li);
  });
  return ol;
}

// naplní box seznamem, nebo hláškou; fetch je jediný zdroj chyb
async function fillBoard(box, url, me, valueOf, empty) {
  try {
    const { entries } = await (await fetch(url)).json();
    if (!entries.length) { box.firstElementChild.textContent = empty; return; }
    box.replaceChildren(boardList(entries, me, valueOf));
  } catch {
    box.firstElementChild.textContent = 'Žebříček se nepodařilo načíst.';
  }
}
```

a v `showLeaderboard` poslední část nahraď za:

```js
  fillBoard($('lb-list'), `/api/leaderboard?week=${week}`, me,
    e => `${e.score.toLocaleString('cs')} b.`,
    'Tenhle týden zatím nikdo nehrál. Jsi první!');
}
```

- [ ] **Step 2: Odeslání runu a žebříček přeživších**

V `web/app.mjs` přidej za `endRun`:

```js
async function submitRun() {
  const nick = $('nick').value.trim();
  $('submit-err').textContent = '';
  $('submit').disabled = true;
  try {
    const res = await fetch('/api/hardcore', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ nick, seed: hcSeed, rounds: hcRun }),
    });
    const data = await res.json();
    if (!res.ok) {
      $('submit-err').textContent = data.error === 'nick'
        ? 'Neplatná přezdívka (3–16 znaků)'
        : data.error === 'rate limit' ? 'Moc runů za sebou — zkus to za chvíli.' : data.error;
      $('submit').disabled = false;
      return;
    }
    localStorage.setItem('pmg-nick', nick);
    showSurvivors(nick);
  } catch {
    $('submit-err').textContent = 'Odeslání selhalo — zkus znovu';
    $('submit').disabled = false;
  }
}

function showSurvivors(me) {
  showCard(`
    <p class="label">hardcore</p>
    <h2 class="hc-type">SURVIVORS</h2>
    <div id="lb-list"><p>Načítám…</p></div>
    <button class="btn btn-primary" id="again">Hrát hardcore</button>
    <button class="link-btn" id="back">← zpět na začátek</button>
  `, () => {
    $('again').onclick = startHardcore;
    $('back').onclick = () => showIntro();
  });
  fillBoard($('lb-list'), '/api/hardcore', me,
    e => `${e.rounds} ${kola(e.rounds)}`,
    'Zatím nikdo nepřežil. Buď první!');
}
```

- [ ] **Step 3: Ověř celý průchod**

Run: `npm run dev`
Expected:
- odehraj hardcore run až do smrti, zapiš se přezdívkou,
- karta se přepne na žebříček `SURVIVORS` s tvým řádkem zvýrazněným,
- „Žebříček přeživších" z úvodní karty ukáže totéž,
- týdenní žebříček (Standard → Žebříček) pořád funguje a ukazuje body.

Run: `npm test`
Expected: PASS

- [ ] **Step 4: Commit**

```bash
git add web/app.mjs
git commit -m "feat(hardcore): odeslání runu a žebříček přeživších"
```

---

### Task 11: Závěrečné ověření

**Files:** žádné změny, pokud se nic nenajde

- [ ] **Step 1: Testy a smoke**

```bash
npm test
npm run smoke
```
Expected: obojí projde — duel se rotace ani plátna nedotklo, ale `board.setRound`
se měnil, takže to chce potvrdit.

- [ ] **Step 2: Regrese ostatních režimů**

Run: `npm run dev` a projdi:
- Standard: rozehřátí, odchylka sedí, žebříček se načte,
- Duel: přes dvě okna, kola běží, soupeřova čára se kreslí na správném místě,
- Casual: kolo, prohlédnutí mapy, hlášení chybné stanice se zakreslením opravy.

Expected: všechno jako před změnou. Zvlášť hlídej **hlášení chybné stanice v
hardcore** — po narovnání se osa kreslí do nepootočené mapy, takže oprava musí
sedět.

- [ ] **Step 3: Mobil**

Run: `npm run dev`, v prohlížeči zapni simulaci telefonu a otoč ho na výšku i šířku.
Expected: plátno se po `resize` přepočítá, kresba drží na místě, pootočená mapa
zůstane pootočená.

- [ ] **Step 4: Nasazení**

```bash
npm run migrate      # ostrá D1 — tabulka hardcore
npm run deploy
```

Po nasazení otevři web a ověř, že se stáhl Nosifer (DevTools → Network → `nosifer-latin.woff2`, status 200)
a že hardcore run projde až po zápis do žebříčku.

Nasazení je ruční, `git push` samo nic nedeployuje — viz `DEPLOY.md`.
