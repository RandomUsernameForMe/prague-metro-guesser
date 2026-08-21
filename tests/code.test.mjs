import test from 'node:test';
import assert from 'node:assert/strict';
import { newCode, CODE_RE, ALPHABET } from '../web/shared/code.mjs';

test('kód má šest znaků z abecedy bez zaměnitelných tvarů', () => {
  for (let i = 0; i < 200; i++) {
    const code = newCode();
    assert.equal(code.length, 6);
    assert.match(code, CODE_RE);
  }
});

test('abeceda neobsahuje znaky, které jdou splést', () => {
  for (const ch of 'IO01') assert.ok(!ALPHABET.includes(ch), `${ch} nemá v abecedě co dělat`);
  assert.equal(ALPHABET.length, 32, 'délka 32 dělí 256 beze zbytku → žádné zkreslení');
});

test('CODE_RE odmítne malá písmena a špatnou délku', () => {
  assert.ok(!CODE_RE.test('abc123'));
  assert.ok(!CODE_RE.test('ABC12'));
  assert.ok(!CODE_RE.test('ABC1234'));
});
