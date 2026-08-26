import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseAxes, mergeOverrides } from '../src/station-axes.js';

const ANDEL = {
  id: '1', name: 'Anděl', lat: 50.0702, lng: 14.4039, lines: ['B'],
  axes: [{ line: 'B', pts: [[50.0694, 14.4037], [50.0705, 14.4039]] }],
};
const MUSTEK = {
  id: '2', name: 'Můstek', lat: 50.0836, lng: 14.4232, lines: ['A', 'B'],
  axes: [
    { line: 'A', pts: [[50.0840, 14.4230], [50.0834, 14.4238]] },
    { line: 'B', pts: [[50.0832, 14.4225], [50.0838, 14.4229]] },
  ],
};
const OK = '[{"line":"B","pts":[[50.0695,14.4038],[50.0706,14.4040]]}]';

test('parseAxes: platná osa projde a body se okopírují', () => {
  const { axes, error } = parseAxes(OK, ANDEL);
  assert.equal(error, undefined);
  assert.deepEqual(axes, [{ line: 'B', pts: [[50.0695, 14.4038], [50.0706, 14.4040]] }]);
});

test('parseAxes: přestup chce osu na každou linku, v pořadí linek', () => {
  const a = { line: 'A', pts: [[50.0841, 14.4231], [50.0835, 14.4239]] };
  const b = { line: 'B', pts: [[50.0833, 14.4226], [50.0839, 14.4230]] };
  assert.ok(parseAxes(JSON.stringify([a]), MUSTEK).error, 'jedna osa na přestupu nestačí');
  // pořadí ve vstupu nerozhoduje — výstup drží pořadí station.lines
  assert.deepEqual(parseAxes(JSON.stringify([b, a]), MUSTEK).axes, [a, b]);
  assert.ok(parseAxes(JSON.stringify([a, a]), MUSTEK).error, 'stejná linka dvakrát');
});

// vstup z adminu teče do skórování i do výřezu kola — rozbitá osa je horší než žádná
test('parseAxes: nesmysly neprojdou', () => {
  for (const bad of [
    'nic', '{}', '[]',
    '[{"line":"A","pts":[[50.0695,14.4038],[50.0706,14.4040]]}]',      // cizí linka
    '[{"line":"B","pts":[[50.0695,14.4038]]}]',                         // jeden bod
    '[{"line":"B","pts":[[50.0695,14.4038],[50.0706,14.4040],[50,14]]}]', // tři body
    '[{"line":"B","pts":[[null,14.4038],[50.0706,14.4040]]}]',
    '[{"line":"B","pts":[["50.07","14.40"],[50.0706,14.4040]]}]',
    '[{"line":"B","pts":[[50.1,14.4038],[50.0706,14.4040]]}]',          // 3 km od stanice
  ]) {
    const { axes, error } = parseAxes(bad, ANDEL);
    assert.equal(axes, undefined, bad);
    assert.equal(typeof error, 'string', bad);
  }
});

test('mergeOverrides: přepis nahradí osy a základ nechá být', () => {
  const base = [ANDEL, MUSTEK];
  const out = mergeOverrides(base, [{ station_id: '1', axes_json: OK }]);
  assert.deepEqual(out[0].axes, [{ line: 'B', pts: [[50.0695, 14.4038], [50.0706, 14.4040]] }]);
  assert.equal(out[1], MUSTEK, 'stanice bez přepisu se ani nekopíruje');
  assert.deepEqual(base[0].axes, ANDEL.axes, 'základ se nesmí přepsat');
  assert.equal(out[0].name, 'Anděl', 'zbytek stanice zůstává');
});

test('mergeOverrides: pokažený řádek se přeskočí, hraje se podle stations.json', () => {
  const out = mergeOverrides([ANDEL], [{ station_id: '1', axes_json: '{pokažené' }]);
  assert.deepEqual(out[0].axes, ANDEL.axes);
});

test('mergeOverrides: bez přepisů vrací základ beze změny', () => {
  const base = [ANDEL];
  assert.equal(mergeOverrides(base, []), base);
});
