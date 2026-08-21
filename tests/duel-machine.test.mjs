import test from 'node:test';
import assert from 'node:assert/strict';
import { initialState, reduce, COUNTDOWN_MS } from '../web/shared/duel-machine.mjs';

const NOW = 1_000_000;
const ROUND_MS = [20000, 30000, 20000]; // tři kola, druhé je přestup

const fresh = () => initialState('ABC123', ROUND_MS);
const join = (s, id, nick, now = NOW) => reduce(s, { type: 'join', playerId: id, nick }, now);
const alarms = fx => fx.filter(e => e.type === 'alarm').map(e => e.at);
const sent = fx => fx.filter(e => e.type === 'send').map(e => e.msg);

test('první hráč čeká, žádný alarm se nestaví', () => {
  const { state, effects } = join(fresh(), 'a', 'Ada');
  assert.equal(state.phase, 'waiting');
  assert.deepEqual(alarms(effects), []);
  assert.equal(state.players.a.nick, 'Ada');
});

test('druhý hráč spustí odpočet do startu', () => {
  const { state, effects } = join(join(fresh(), 'a', 'Ada').state, 'b', 'Bob');
  assert.equal(state.phase, 'countdown');
  assert.equal(state.deadline, NOW + COUNTDOWN_MS);
  assert.deepEqual(alarms(effects), [NOW + COUNTDOWN_MS]);
  assert.deepEqual(state.order, ['a', 'b']);
});

test('třetí hráč dostane chybu a stav se nezmění', () => {
  const full = join(join(fresh(), 'a', 'Ada').state, 'b', 'Bob').state;
  const { state, effects } = join(full, 'c', 'Cyril');
  assert.deepEqual(state, full);
  assert.deepEqual(sent(effects), [{ type: 'error', error: 'full' }]);
});
