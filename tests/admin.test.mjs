import { test } from 'node:test';
import assert from 'node:assert/strict';
import { esc, int, fix1, pct, secs, den, page } from '../src/admin/layout.js';
import { heatmapLines, axisLines, parseSegments } from '../src/admin/heatmap-geom.js';

// note z hlášení je jediný neověřený uživatelský vstup, co teče do admin stránky
test('esc: uživatelský vstup neuteče z HTML', () => {
  assert.equal(esc('<script>alert(1)</script>'), '&lt;script&gt;alert(1)&lt;/script&gt;');
  assert.equal(esc('AT&T "x"'), 'AT&amp;T &quot;x&quot;');
  assert.equal(esc(null), 'null'); // nespadne na nezadané hodnotě
});

test('page: název stránky prochází escapováním', () => {
  assert.ok(page('a<b>', '/admin/', '').includes('<title>a&lt;b&gt; ·'));
});

test('page: aktivní položka v liště je právě jedna', () => {
  const html = page('Statistiky', '/admin/stats', '');
  // pozor: samotné `aria-current` je i v CSS selektoru, hledáme jen atribut v odkazu
  assert.equal(html.match(/aria-current="page"/g).length, 1);
  assert.ok(html.includes('<a href="/admin/stats" aria-current="page">'));
});

// prázdná databáze je normální stav: agregace vrací nuly a NULLy
test('formátování: prázdná tabulka nedělí nulou ani nevrátí NaN', () => {
  assert.equal(pct(0, 0), '—');
  assert.equal(int(null), '—');
  assert.equal(fix1(null), '—');
  assert.equal(secs(null), '—');
  for (const out of [pct(0, 0), int(null), fix1(null), secs(null)]) {
    assert.doesNotMatch(out, /NaN|Infinity|undefined/);
  }
});

test('formátování: běžné hodnoty', () => {
  assert.equal(pct(11, 100), '11 %');
  assert.equal(int(485.6), '486');
  assert.equal(fix1(198.76), '198,8'); // desetinná čárka, ne tečka
  assert.equal(secs(4681), '4,7 s');
  assert.equal(den('2026-08-21'), '21. 8.');
});

// ---------- mapa tipů (/admin/heatmap) ----------

const HM_STATION = {
  id: 'x', name: 'Zkušební', lat: 50, lng: 14.4, lines: ['A'],
  axes: [{ line: 'A', pts: [[50.0005, 14.4], [49.9995, 14.4]] }],
};
const SIZE = 640;
const row = segs => ({ segments_json: JSON.stringify(segs) });

test('heatmapLines: tip přes střed stanice padne doprostřed rámu', () => {
  const { lines, outside } = heatmapLines([row([[[50, 14.4], [50.0005, 14.4]]])], HM_STATION, SIZE);
  assert.equal(outside, 0);
  assert.equal(lines.length, 1);
  const [[x1, y1], [, y2]] = lines[0];
  assert.equal(Math.round(x1), SIZE / 2);
  assert.equal(Math.round(y1), SIZE / 2);
  assert.ok(y2 < y1, 'sever je nahoře, takže druhý bod má menší y');
});

test('heatmapLines: tipy z různých výřezů se skládají do jednoho rámu', () => {
  // dva hráči viděli stanici jinak posunutou, ale úsečky jsou v lat/lng
  const { lines } = heatmapLines(
    [row([[[50, 14.4], [50.0005, 14.4]]]), row([[[50, 14.4], [50.0005, 14.4]]])], HM_STATION, SIZE);
  assert.equal(lines.length, 2);
  assert.deepEqual(lines[0], lines[1]);
});

test('heatmapLines: úsečka mimo výřez se nekreslí, ale spočítá', () => {
  // 400 m na sever je za hranou 600m rámu vystředěného na stanici
  const { lines, outside } = heatmapLines([row([[[50.0036, 14.4], [50.0037, 14.4]]])], HM_STATION, SIZE);
  assert.equal(lines.length, 0);
  assert.equal(outside, 1);
});

// řádky z DB tečou do atributů SVG — pokažený řádek nesmí být cesta do stránky
test('parseSegments: rozbitý řádek nespadne ani neprojde dál', () => {
  assert.deepEqual(parseSegments('{nevalidní'), []);
  assert.deepEqual(parseSegments('"řetězec"'), []);
  assert.deepEqual(parseSegments('null'), []);
  assert.deepEqual(parseSegments(JSON.stringify([[['1"/><script>', 14.4], [50, 14.4]]])), []);
  assert.deepEqual(parseSegments(JSON.stringify([[[NaN, 14.4], [50, 14.4]]])), []); // NaN → null v JSON
  assert.deepEqual(parseSegments(JSON.stringify([[[50, 14.4]]])), []);              // chybí druhý bod
});

test('heatmapLines: rozbité řádky se přeskočí, zdravé projdou', () => {
  const { lines, outside } = heatmapLines(
    [{ segments_json: '{nevalidní' }, row([[[50, 14.4], [50.0005, 14.4]]])], HM_STATION, SIZE);
  assert.equal(lines.length, 1);
  assert.equal(outside, 0);
});

test('axisLines: osa stanice dostane barvu své linky a body v px', () => {
  const [axis] = axisLines(HM_STATION, SIZE);
  assert.equal(axis.line, 'A');
  assert.equal(axis.pts.length, 2);
  assert.equal(Math.round(axis.pts[0][0]), SIZE / 2);
  assert.ok(axis.pts[0][1] < axis.pts[1][1]);
});
