import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isoWeek, weeklyChallenge, practiceRounds, roundViewport, VIEW_SIZE } from '../web/shared/seed.mjs';

// fixture: 14 stanic, 3 přestupní
const fx = [];
for (let i = 0; i < 11; i++) fx.push({ id: `s${i}`, name: `Stanice ${i}`, lat: 50 + i * 0.01, lng: 14.4, isTransfer: false, axes: [] });
for (const n of ['Můstek', 'Muzeum', 'Florenc']) fx.push({ id: n, name: n, lat: 50.08, lng: 14.43, isTransfer: true, axes: [] });

test('isoWeek: známé hodnoty (UTC)', () => {
  assert.equal(isoWeek(new Date(Date.UTC(2026, 7, 20))), '2026-34');
  assert.equal(isoWeek(new Date(Date.UTC(2026, 0, 1))), '2026-01');
  assert.equal(isoWeek(new Date(Date.UTC(2027, 0, 1))), '2026-53');
});

test('weeklyChallenge: deterministické, 10 kol, unikátní stanice', () => {
  const a = weeklyChallenge('2026-34', fx);
  const b = weeklyChallenge('2026-34', fx);
  assert.equal(a.length, 10);
  assert.deepEqual(a.map(r => r.station.id), b.map(r => r.station.id));
  assert.deepEqual(a.map(r => [r.u, r.v]), b.map(r => [r.u, r.v]));
  assert.equal(new Set(a.map(r => r.station.id)).size, 10);
});

test('weeklyChallenge: jiný týden → jiný výběr/pořadí', () => {
  const ids = w => weeklyChallenge(w, fx).map(r => r.station.id).join(',');
  assert.notEqual(ids('2026-34'), ids('2026-35'));
});

test('weeklyChallenge: vždy ≥1 přestupní, u/v v [0.15,0.85]', () => {
  for (let w = 1; w <= 52; w++) {
    const ch = weeklyChallenge(`2026-${String(w).padStart(2, '0')}`, fx);
    assert.ok(ch.some(r => r.station.isTransfer), `týden ${w} bez přestupní`);
    for (const r of ch) {
      assert.ok(r.u >= 0.15 && r.u <= 0.85 && r.v >= 0.15 && r.v <= 0.85);
    }
  }
});

test('practiceRounds: nikdy nedá stanici z týdenní výzvy', () => {
  const weekly = weeklyChallenge('2026-34', fx);
  const excluded = new Set(weekly.map(r => r.station.id));
  for (let i = 0; i < 50; i++) {
    const rounds = practiceRounds(fx, 10, excluded);
    for (const r of rounds) assert.ok(!excluded.has(r.station.id), `únik: ${r.station.name}`);
    assert.equal(new Set(rounds.map(r => r.station.id)).size, rounds.length, 'duplicitní stanice');
    for (const r of rounds) {
      assert.ok(r.u >= 0.15 && r.u <= 0.85 && r.v >= 0.15 && r.v <= 0.85);
    }
  }
});

test('practiceRounds: nespadne, když je stanic míň než kol', () => {
  const rounds = practiceRounds(fx.slice(0, 3), 10);
  assert.equal(rounds.length, 3);
});

test('roundViewport: u=0.15 → střed 210 m východně od stanice', () => {
  // výřez se centruje na osy, ne na node — tady mají střed přesně v lat/lng stanice
  const st = { lat: 50.0, lng: 14.4, axes: [{ line: 'C', pts: [[49.999, 14.4], [50.001, 14.4]] }] };
  const vp = roundViewport({ station: st, u: 0.15, v: 0.5 });
  assert.ok(Math.abs((vp.lng - st.lng) * 111320 * Math.cos(Math.PI * 50 / 180) - 210) < 1);
  assert.ok(Math.abs(vp.lat - st.lat) < 1e-9);
  assert.equal(VIEW_SIZE, 600);
});
