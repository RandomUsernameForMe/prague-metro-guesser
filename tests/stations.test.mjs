import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { toLocalMeters } from '../web/shared/geo.mjs';

const stations = JSON.parse(readFileSync('web/stations.json'));

test('každá linka stanice má právě jednu osu rozumné délky', () => {
  assert.equal(stations.length, 57);
  for (const s of stations) {
    assert.deepEqual(s.axes.map(a => a.line), s.lines, `${s.name}: osy ≠ linky`);
    for (const a of s.axes) {
      const m = a.pts.map(([lat, lng]) => toLocalMeters(lat, lng, s));
      const len = m.reduce((acc, p, i) => (i ? acc + Math.hypot(p[0] - m[i - 1][0], p[1] - m[i - 1][1]) : 0), 0);
      assert.ok(len >= 60 && len <= 450, `${s.name}/${a.line}: osa ${len.toFixed(0)} m`);
    }
  }
});
