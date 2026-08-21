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

test('na přestupní stanici se osy kříží, neleží v jedné přímce', () => {
  const dir = (a, s) => {
    const [x0, y0] = toLocalMeters(a.pts[0][0], a.pts[0][1], s);
    const [x1, y1] = toLocalMeters(a.pts.at(-1)[0], a.pts.at(-1)[1], s);
    return Math.atan2(y1 - y0, x1 - x0);
  };
  for (const s of stations.filter(x => x.isTransfer)) {
    const [p, q] = s.axes.map(a => dir(a, s));
    // úsečka nemá orientaci, proto mod 180 a překlopení nad 90 → 0° = rovnoběžné, 90° = kolmé
    const d = ((((p - q) * 180) / Math.PI) % 180 + 180) % 180;
    const deg = Math.min(d, 180 - d);
    assert.ok(deg >= 45, `${s.name}: osy svírají ${deg.toFixed(0)}°`);
  }
});
