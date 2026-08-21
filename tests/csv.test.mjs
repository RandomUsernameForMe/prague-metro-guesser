import { test } from 'node:test';
import assert from 'node:assert/strict';
import { csvRow } from '../web/shared/csv.mjs';

test('prosté hodnoty se neobalují', () => {
  assert.equal(csvRow([1, 'Anděl', 42.5]), '1,Anděl,42.5');
});

test('čárka, uvozovka i konec řádku se obalí, uvozovky se zdvojí', () => {
  assert.equal(csvRow(['a,b']), '"a,b"');
  assert.equal(csvRow(['řekl "ahoj"']), '"řekl ""ahoj"""');
  assert.equal(csvRow(['a\nb']), '"a\nb"');
  assert.equal(csvRow(['a\rb']), '"a\rb"');
});

test('null i undefined jsou prázdná buňka', () => {
  assert.equal(csvRow([null, undefined, 0]), ',,0');
});

test('segments_json neroztrhá řádek na víc sloupců', () => {
  const seg = JSON.stringify([[[50.07, 14.4], [50.08, 14.41]]]);
  const row = csvRow([7, 'Anděl', seg]);
  // mimo uvozovky smí být jen dvě čárky — oddělovače tří sloupců
  let inQuotes = false, seps = 0;
  for (const ch of row) {
    if (ch === '"') inQuotes = !inQuotes;
    else if (ch === ',' && !inQuotes) seps++;
  }
  assert.equal(seps, 2);
});
