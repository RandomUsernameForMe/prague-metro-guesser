import { test } from 'node:test';
import assert from 'node:assert/strict';
import { esc, int, fix1, pct, secs, den, page } from '../functions/admin/_layout.js';

// note z hlášení je jediný neověřený uživatelský vstup, co teče do admin stránky
test('esc: uživatelský vstup neuteče z HTML', () => {
  assert.equal(esc('<script>alert(1)</script>'), '&lt;script&gt;alert(1)&lt;/script&gt;');
  assert.equal(esc('AT&T "x"'), 'AT&amp;T &quot;x&quot;');
  assert.equal(esc(null), 'null'); // nespadne na nezadané hodnotě
});

test('page: název stránky prochází escapováním', () => {
  assert.ok(page('a<b>', '/admin/', '').includes('<title>a&lt;b&gt; ·'));
});

test('page: aktivní položka v liště je právě jedna', () => {
  const html = page('Statistiky', '/admin/stats', '');
  // pozor: samotné `aria-current` je i v CSS selektoru, hledáme jen atribut v odkazu
  assert.equal(html.match(/aria-current="page"/g).length, 1);
  assert.ok(html.includes('<a href="/admin/stats" aria-current="page">'));
});

// prázdná databáze je normální stav: agregace vrací nuly a NULLy
test('formátování: prázdná tabulka nedělí nulou ani nevrátí NaN', () => {
  assert.equal(pct(0, 0), '—');
  assert.equal(int(null), '—');
  assert.equal(fix1(null), '—');
  assert.equal(secs(null), '—');
  for (const out of [pct(0, 0), int(null), fix1(null), secs(null)]) {
    assert.doesNotMatch(out, /NaN|Infinity|undefined/);
  }
});

test('formátování: běžné hodnoty', () => {
  assert.equal(pct(11, 100), '11 %');
  assert.equal(int(485.6), '486');
  assert.equal(fix1(198.76), '198,8'); // desetinná čárka, ne tečka
  assert.equal(secs(4681), '4,7 s');
  assert.equal(den('2026-08-21'), '21. 8.');
});
