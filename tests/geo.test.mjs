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

// hodnoty ověřeny proti živé dlaždici Esri World Imagery (z18/88814/141572 = centrum Prahy)
test('tile indexy pro centrum Prahy na z18', () => {
  assert.equal(Math.floor(lngToTileX(14.42, 18)), 141572);
  assert.equal(Math.floor(latToTileY(50.08, 18)), 88814);
});
