import { test } from 'node:test';
import assert from 'node:assert/strict';
import { samplePolyline, symmetricDistance, scoreRound } from '../web/shared/scoring.mjs';
import { M_PER_DEG_LAT } from '../web/shared/geo.mjs';

const north = m => 50 + m / M_PER_DEG_LAT;
const east = m => 14.4 + m / (111320 * Math.cos(Math.PI * 50 / 180));

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

test('scoreRound: jedna linka — přesná shoda ≈ 1000, 85 m ≈ 368, bere nejbližší osu', () => {
  const st = {
    lat: 50, lng: 14.4, lines: ['C'],
    axes: [
      { line: 'C', pts: [[50, 14.4], [north(200), 14.4]] },        // osa přes stanici
      { line: 'C', pts: [[north(5000), 14.4], [north(5200), 14.4]] }, // vzdálená osa
    ],
  };
  const exact = scoreRound([st.axes[0].pts], st);
  assert.ok(exact.score >= 995, `score=${exact.score}`);

  const shifted = st.axes[0].pts.map(([lat]) => [lat, east(85)]);
  const off = scoreRound([shifted], st);
  assert.ok(Math.abs(off.score - 368) <= 8, `score=${off.score}`);
  assert.ok(Math.abs(off.d - 85) < 1.5);
});

// přestupní stanice: dvě úsečky, každá na jednu linku
const transfer = {
  lat: 50, lng: 14.4, lines: ['A', 'B'],
  axes: [
    { line: 'A', pts: [[50, 14.4], [north(200), 14.4]] },                 // svisle
    { line: 'B', pts: [[north(100), east(-100)], [north(100), east(100)]] }, // vodorovně
  ],
};

test('scoreRound: dvě linky — na pořadí úseček nezáleží', () => {
  const a = transfer.axes[0].pts, b = transfer.axes[1].pts;
  const ab = scoreRound([a, b], transfer);
  const ba = scoreRound([b, a], transfer);
  assert.ok(ab.score >= 995, `score=${ab.score}`);
  assert.equal(ab.score, ba.score);
  assert.deepEqual(ab.perLine.map(r => r.line).sort(), ['A', 'B']);
});

test('scoreRound: obě úsečky na jedné lince nevyhrají', () => {
  const a = transfer.axes[0].pts;
  const cheat = scoreRound([a, a], transfer);
  const honest = scoreRound([a, transfer.axes[1].pts], transfer);
  // druhá linka zůstane netrefená → její odchylka jde do průměru
  assert.ok(cheat.score < honest.score - 200, `cheat=${cheat.score} honest=${honest.score}`);
  assert.ok(cheat.perLine.some(r => r.d > 40), JSON.stringify(cheat.perLine));
});
