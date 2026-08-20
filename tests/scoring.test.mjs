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
