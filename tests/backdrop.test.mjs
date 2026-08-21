import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = p => JSON.parse(readFileSync(new URL(p, import.meta.url), 'utf8'));
const photos = read('../web/bg/CREDITS.json');
const stations = read('../web/stations.json');
const names = new Set(stations.map(s => s.name));

// překlep nebo obyčejná mezera místo nedělitelné by fotku stanice tiše odpojily
test('fotky pozadí: station odpovídá jménu v stations.json', () => {
  for (const p of photos) {
    if (p.station === null) continue;
    assert.ok(names.has(p.station), `neznámá stanice: ${JSON.stringify(p.station)}`);
  }
});

test('fotky pozadí: každá stanice dostane právě jednu fotku', () => {
  for (const name of names) {
    const sum = [...name].reduce((a, c) => a + c.codePointAt(0), 0);
    const p = photos.find(x => x.station === name) ?? photos[sum % photos.length];
    assert.ok(p?.file, `stanice bez fotky: ${name}`);
  }
});
