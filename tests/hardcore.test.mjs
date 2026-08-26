import { test } from 'node:test';
import assert from 'node:assert/strict';
import { nextLives, runLength, LIVES_MAX } from '../web/shared/hardcore.mjs';

test('nextLives: nad 100 m bere život', () => {
  assert.equal(nextLives(3, 140), 2);
  assert.equal(nextLives(1, 100.1), 0);
});

test('nextLives: pod 15 m vrací život, ale nejvýš na strop', () => {
  assert.equal(nextLives(1, 9), 2);
  assert.equal(nextLives(LIVES_MAX, 1), LIVES_MAX);
});

test('nextLives: mezi 15 a 100 m se nic neděje', () => {
  assert.equal(nextLives(2, 15), 2);
  assert.equal(nextLives(2, 60), 2);
  assert.equal(nextLives(2, 100), 2);
});

test('nextLives: propadlé kolo (null) bere život', () => {
  assert.equal(nextLives(3, null), 2);
});

test('runLength: fatální kolo se počítá', () => {
  // tři špatná kola = tři ztracené životy, umírá ve třetím
  assert.equal(runLength([200, 200, 200, 200, 200]), 3);
});

test('runLength: run bez smrti vrací délku pole', () => {
  assert.equal(runLength([50, 50, 50]), 3);
});

test('runLength: regenerace run prodlouží', () => {
  // bez regenerace: tři špatná kola a konec
  assert.equal(runLength([200, 200, 200, 200]), 3);
  // s regenerací uprostřed: 3 → 2 → zpátky 3 → 2 → 1 → 0, smrt až v pátém kole
  assert.equal(runLength([200, 5, 200, 200, 200, 200]), 5);
});
