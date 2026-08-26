import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  nextLives, runLength, hardcoreRound, hardcoreViewport, LIVES_MAX, SPAN,
} from '../web/shared/hardcore.mjs';
import { roundViewport, VIEW_SIZE } from '../web/shared/seed.mjs';

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
  // bez regenerace: tři špatná kola a konec
  assert.equal(runLength([200, 200, 200, 200]), 3);
  // s regenerací uprostřed: 3 → 2 → zpátky 3 → 2 → 1 → 0, smrt až v pátém kole
  assert.equal(runLength([200, 5, 200, 200, 200, 200]), 5);
});

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
