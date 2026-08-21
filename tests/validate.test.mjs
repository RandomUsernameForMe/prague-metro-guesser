import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validateSubmission } from '../web/shared/validate.mjs';
import { weeklyChallenge, roundViewport } from '../web/shared/seed.mjs';

const axis = (lat, line) => ({ line, pts: [[lat, 14.399], [lat, 14.401]] });
const fx = [];
for (let i = 0; i < 11; i++) {
  const lat = 50 + i * 0.01;
  fx.push({ id: `s${i}`, name: `S${i}`, lat, lng: 14.4, lines: ['C'], isTransfer: false, axes: [axis(lat, 'C')] });
}
for (const [n, ls] of [['Můstek', ['A', 'B']], ['Muzeum', ['A', 'C']], ['Florenc', ['B', 'C']]]) {
  fx.push({
    id: n, name: n, lat: 50.08, lng: 14.43, lines: ls, isTransfer: true,
    axes: ls.map(l => ({ line: l, pts: [[50.079, 14.43], [50.081, 14.43]] })),
  });
}

const week = '2026-34';
const rounds = weeklyChallenge(week, fx);
// validní tah: jedna úsečka na každou linku stanice, poblíž středu výřezu
const goodLines = rounds.map(r => {
  const vp = roundViewport(r);
  return r.station.lines.map((_, k) => [
    [vp.lat - 0.0005, vp.lng + k * 0.0002],
    [vp.lat + 0.0005, vp.lng + k * 0.0002],
  ]);
});

test('validní payload projde', () => {
  const r = validateSubmission({ week, nick: 'Tomáš_1', lines: goodLines }, rounds, week);
  assert.equal(r.ok, true);
});

test('propadlé kolo (null) projde — vypršel čas', () => {
  const withNull = goodLines.map((l, i) => (i === 2 ? null : l));
  const r = validateSubmission({ week, nick: 'Hráč', lines: withNull }, rounds, week);
  assert.equal(r.ok, true);
});

test('přestupní kolo vyžaduje dvě úsečky', () => {
  const i = rounds.findIndex(r => r.station.lines.length === 2);
  assert.ok(i >= 0, 've výzvě chybí přestupní stanice');
  const one = goodLines.map((l, k) => (k === i ? [l[0]] : l));
  const r = validateSubmission({ week, nick: 'Hráč', lines: one }, rounds, week);
  assert.equal(r.ok, false);
  assert.match(r.error, /segments/);
});

test('špatný nick / týden / počet kol / počet bodů / bod mimo výřez → chyba', () => {
  const bad = [
    [{ week, nick: 'ab', lines: goodLines }, /nick/],
    [{ week: '2026-33', nick: 'Hráč', lines: goodLines }, /week/],
    [{ week, nick: 'Hráč', lines: goodLines.slice(0, 9) }, /lines/],
    // úsečka musí mít přesně 2 body
    [{ week, nick: 'Hráč', lines: goodLines.map((l, i) => (i === 0 ? [[l[0][0], l[0][1], l[0][0]]] : l)) }, /points/],
    [{ week, nick: 'Hráč', lines: goodLines.map((l, i) => (i === 0 ? [[[50.5, 14.4], l[0][1]]] : l)) }, /bounds/],
  ];
  for (const [payload, re] of bad) {
    const r = validateSubmission(payload, rounds, week);
    assert.equal(r.ok, false, `mělo selhat: ${re}`);
    assert.match(r.error, re);
  }
});
