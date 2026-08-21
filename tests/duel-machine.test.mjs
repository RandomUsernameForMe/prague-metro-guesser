import test from 'node:test';
import assert from 'node:assert/strict';
import { initialState, reduce, COUNTDOWN_MS, SHOT_CLOCK_MS } from '../web/shared/duel-machine.mjs';

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

// dva hráči, po odpočtu, na začátku prvního kola
const drawing = (now = NOW) => {
  const two = join(join(fresh(), 'a', 'Ada', now).state, 'b', 'Bob', now).state;
  return reduce(two, { type: 'timeout' }, now + COUNTDOWN_MS).state;
};

test('konec odpočtu spustí první kolo', () => {
  const start = NOW + COUNTDOWN_MS;
  const two = join(join(fresh(), 'a', 'Ada').state, 'b', 'Bob').state;
  const { state, effects } = reduce(two, { type: 'timeout' }, start);
  assert.equal(state.phase, 'drawing');
  assert.equal(state.roundIndex, 0);
  assert.equal(state.deadline, start + ROUND_MS[0]);
  assert.deepEqual(alarms(effects), [start + ROUND_MS[0]]);
  assert.deepEqual(sent(effects), [{ type: 'round', i: 0, deadline: start + ROUND_MS[0] }]);
});

test('první odevzdání zkrátí deadline na pět sekund', () => {
  const s = drawing();
  const start = s.deadline - ROUND_MS[0];
  const { state, effects } = reduce(s, { type: 'submit', playerId: 'a', i: 0, score: 800 }, start + 2000);
  assert.equal(state.phase, 'drawing');
  assert.equal(state.deadline, start + 2000 + SHOT_CLOCK_MS);
  assert.deepEqual(alarms(effects), [start + 2000 + SHOT_CLOCK_MS]);
  assert.ok(sent(effects).some(m => m.type === 'deadline' && m.deadline === start + 2000 + SHOT_CLOCK_MS));
  assert.ok(sent(effects).some(m => m.type === 'opponent' && m.id === 'a' && m.submitted === true));
});

test('pozdní odevzdání soupeři čas nepřidá', () => {
  const s = drawing();
  const start = s.deadline - ROUND_MS[0];
  // odevzdáno 2 s před koncem kola → do konce zbývají 2 s, ne 5
  const { state } = reduce(s, { type: 'submit', playerId: 'a', i: 0, score: 800 }, start + ROUND_MS[0] - 2000);
  assert.equal(state.deadline, start + ROUND_MS[0]);
});

test('odevzdání po deadline se zahodí', () => {
  const s = drawing();
  const { state, effects } = reduce(s, { type: 'submit', playerId: 'a', i: 0, score: 900 }, s.deadline + 1);
  assert.equal(state.players.a.submitted, false);
  assert.deepEqual(effects, []);
});

test('druhé odevzdání téhož hráče se zahodí', () => {
  const s = drawing();
  const once = reduce(s, { type: 'submit', playerId: 'a', i: 0, score: 800 }, s.deadline - 10000).state;
  const { state, effects } = reduce(once, { type: 'submit', playerId: 'a', i: 0, score: 1000 }, s.deadline - 9000);
  assert.equal(state.players.a.score, 800, 'skóre se nepřepíše lepším pokusem');
  assert.deepEqual(effects, []);
});

test('odevzdání do jiného kola se zahodí', () => {
  const s = drawing();
  const { effects } = reduce(s, { type: 'submit', playerId: 'a', i: 1, score: 800 }, s.deadline - 10000);
  assert.deepEqual(effects, []);
});

test('když odevzdají oba, kolo končí hned', () => {
  const s = drawing();
  const t = s.deadline - 10000;
  const one = reduce(s, { type: 'submit', playerId: 'a', i: 0, score: 800 }, t).state;
  const { state, effects } = reduce(one, { type: 'submit', playerId: 'b', i: 0, score: 500 }, t + 100);
  assert.equal(state.phase, 'reveal');
  assert.deepEqual(state.players.a.total, 800);
  assert.deepEqual(state.players.b.total, 500);
  assert.ok(sent(effects).some(m => m.type === 'reveal' && m.scores.a === 800 && m.totals.b === 500));
});
