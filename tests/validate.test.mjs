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
