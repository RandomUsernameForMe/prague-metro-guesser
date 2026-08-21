import test from 'node:test';
import assert from 'node:assert/strict';
import { initialState, reduce, COUNTDOWN_MS, SHOT_CLOCK_MS, REVEAL_MS, GRACE_MS, READY_MS, WAITING_MS, guessesForRound } from '../web/shared/duel-machine.mjs';

const NOW = 1_000_000;
const ROUND_MS = [20000, 30000, 20000]; // tři kola, druhé je přestup

const fresh = () => initialState('ABC123', ROUND_MS);
const join = (s, id, nick, now = NOW) => reduce(s, { type: 'join', playerId: id, nick }, now);
const ready = (s, id, now = NOW) => reduce(s, { type: 'ready', playerId: id }, now);
const alarms = fx => fx.filter(e => e.type === 'alarm').map(e => e.at);
const sent = fx => fx.filter(e => e.type === 'send').map(e => e.msg);

// oba připojení, čeká se, až každý potvrdí „jsem připraven"
const paired = (now = NOW) => join(join(fresh(), 'a', 'Ada', now).state, 'b', 'Bob', now).state;
// oba potvrdili → běží odpočet do startu
const counting = (now = NOW) => ready(ready(paired(now), 'a', now).state, 'b', now).state;

test('první hráč čeká, ale ne donekonečna', () => {
  const { state, effects } = join(fresh(), 'a', 'Ada');
  assert.equal(state.phase, 'waiting');
  assert.equal(state.deadline, NOW + WAITING_MS);
  assert.deepEqual(alarms(effects), [NOW + WAITING_MS]);
  assert.equal(state.players.a.nick, 'Ada');
});

test('když soupeř nedorazí, zápas se zruší bez vítěze', () => {
  const alone = join(fresh(), 'a', 'Ada').state;
  const { state, effects } = reduce(alone, { type: 'timeout' }, NOW + WAITING_MS);
  assert.equal(state.phase, 'ended');
  assert.equal(state.reason, 'alone');
  assert.equal(state.winner, null);
  assert.deepEqual(alarms(effects), [null], 'čekání skončilo, další alarm není na co');
});

test('příchod druhého hráče přebije alarm čekání ready checkem', () => {
  const { effects } = join(join(fresh(), 'a', 'Ada').state, 'b', 'Bob');
  assert.deepEqual(alarms(effects), [NOW + READY_MS]);
});

test('do dohraného zápasu se nikdo nepřidá', () => {
  const end = playOut(drawing(), { a: [1, 1, 1], b: [2, 2, 2] });
  const { state, effects } = reduce(end, { type: 'join', playerId: 'c', nick: 'Cyril' }, end.deadline + 1000);
  assert.equal(state.phase, 'ended');
  assert.deepEqual(state.order, ['a', 'b'], 'třetí hráč se do pořadí nedostane');
  assert.deepEqual(sent(effects), [{ type: 'error', error: 'ended' }]);
});

test('druhý hráč spustí ready check, ne rovnou zápas', () => {
  const { state, effects } = join(join(fresh(), 'a', 'Ada').state, 'b', 'Bob');
  assert.equal(state.phase, 'ready');
  assert.equal(state.deadline, NOW + READY_MS);
  assert.deepEqual(alarms(effects), [NOW + READY_MS]);
  assert.deepEqual(state.order, ['a', 'b']);
  assert.equal(state.players.a.ready, false);
});

test('potvrzení jednoho hráče vidí soupeř, ale zápas ještě nezačne', () => {
  const { state, effects } = ready(paired(), 'a');
  assert.equal(state.phase, 'ready');
  assert.equal(state.players.a.ready, true);
  assert.equal(state.players.b.ready, false);
  assert.equal(state.deadline, NOW + READY_MS, 'čekání na druhého se nezkracuje ani neprodlužuje');
  assert.deepEqual(alarms(effects), [], 'běžící alarm se nepřestavuje');
  const msg = sent(effects).find(m => m.type === 'state');
  assert.equal(msg.players.find(p => p.id === 'a').ready, true);
});

test('potvrzení obou spustí odpočet do startu', () => {
  const t = NOW + 4000;
  const { state, effects } = ready(ready(paired(), 'a').state, 'b', t);
  assert.equal(state.phase, 'countdown');
  assert.equal(state.deadline, t + COUNTDOWN_MS);
  assert.deepEqual(alarms(effects), [t + COUNTDOWN_MS]);
});

test('opakované potvrzení téhož hráče zápas nespustí', () => {
  const once = ready(paired(), 'a').state;
  const { state, effects } = ready(once, 'a', NOW + 1000);
  assert.equal(state.phase, 'ready');
  assert.deepEqual(alarms(effects), []);
});

test('kdo nepotvrdí do minuty, prohrává ve prospěch připraveného', () => {
  const one = ready(paired(), 'a').state;
  const { state, effects } = reduce(one, { type: 'timeout' }, one.deadline);
  assert.equal(state.phase, 'ended');
  assert.equal(state.reason, 'noshow');
  assert.equal(state.winner, 'a');
  assert.ok(effects.some(e => e.type === 'finish' && e.reason === 'noshow'));
});

test('když nepotvrdí nikdo, zápas se zruší bez vítěze', () => {
  const s = paired();
  const { state } = reduce(s, { type: 'timeout' }, s.deadline);
  assert.equal(state.phase, 'ended');
  assert.equal(state.reason, 'noshow');
  assert.equal(state.winner, null);
});

test('potvrzení po startu zápasu nic nemění', () => {
  const s = counting();
  const { state, effects } = ready(s, 'a', NOW + 1000);
  assert.equal(state.phase, 'countdown');
  assert.deepEqual(effects, []);
});

test('třetí hráč dostane chybu a stav se nezmění', () => {
  const full = join(join(fresh(), 'a', 'Ada').state, 'b', 'Bob').state;
  const { state, effects } = join(full, 'c', 'Cyril');
  assert.deepEqual(state, full);
  assert.deepEqual(sent(effects), [{ type: 'error', error: 'full' }]);
});

// dva hráči, oba potvrzení, po odpočtu, na začátku prvního kola
const drawing = (now = NOW) => reduce(counting(now), { type: 'timeout' }, now + COUNTDOWN_MS).state;

test('konec odpočtu spustí první kolo', () => {
  const start = NOW + COUNTDOWN_MS;
  const { state, effects } = reduce(counting(), { type: 'timeout' }, start);
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

// dohraje zápas od zadaného stavu: v každém kole dostane 'a' skóre z scores.a[i], 'b' z scores.b[i]
const playOut = (s, scores) => {
  let cur = s;
  for (let i = cur.roundIndex; i < ROUND_MS.length; i++) {
    const t = cur.deadline - 1000;
    cur = reduce(cur, { type: 'submit', playerId: 'a', i, score: scores.a[i] }, t).state;
    cur = reduce(cur, { type: 'submit', playerId: 'b', i, score: scores.b[i] }, t).state;
    cur = reduce(cur, { type: 'timeout' }, cur.deadline).state; // konec reveal
  }
  return cur;
};

test('vypršení času v kole zavře kolo a kdo neodevzdal, má nulu', () => {
  const s = drawing();
  const one = reduce(s, { type: 'submit', playerId: 'a', i: 0, score: 700 }, s.deadline - 10000).state;
  const { state } = reduce(one, { type: 'timeout' }, one.deadline);
  assert.equal(state.phase, 'reveal');
  assert.equal(state.players.a.total, 700);
  assert.equal(state.players.b.total, 0);
});

test('konec odhalení spustí další kolo s délkou podle typu stanice', () => {
  const s = drawing();
  const t = s.deadline - 5000;
  const both = reduce(reduce(s, { type: 'submit', playerId: 'a', i: 0, score: 1 }, t).state,
    { type: 'submit', playerId: 'b', i: 0, score: 2 }, t).state;
  assert.equal(both.deadline, t + REVEAL_MS);
  const { state } = reduce(both, { type: 'timeout' }, both.deadline);
  assert.equal(state.phase, 'drawing');
  assert.equal(state.roundIndex, 1);
  assert.equal(state.deadline, both.deadline + ROUND_MS[1], 'druhé kolo je přestup → 30 s');
});

test('po posledním odhalení zápas končí a vyhrává vyšší součet', () => {
  const end = playOut(drawing(), { a: [100, 100, 100], b: [900, 0, 0] });
  assert.equal(end.phase, 'ended');
  assert.equal(end.reason, 'complete');
  assert.equal(end.winner, 'b');
  assert.equal(end.players.a.total, 300);
  assert.equal(end.players.b.total, 900);
});

test('konec zápasu vydá efekt finish a zruší alarm', () => {
  let cur = drawing();
  for (let i = 0; i < ROUND_MS.length - 1; i++) {
    const t = cur.deadline - 1000;
    cur = reduce(cur, { type: 'submit', playerId: 'a', i, score: 10 }, t).state;
    cur = reduce(cur, { type: 'submit', playerId: 'b', i, score: 20 }, t).state;
    cur = reduce(cur, { type: 'timeout' }, cur.deadline).state;
  }
  const t = cur.deadline - 1000;
  cur = reduce(cur, { type: 'submit', playerId: 'a', i: 2, score: 10 }, t).state;
  cur = reduce(cur, { type: 'submit', playerId: 'b', i: 2, score: 20 }, t).state;
  const { state, effects } = reduce(cur, { type: 'timeout' }, cur.deadline);
  assert.equal(state.phase, 'ended');
  assert.deepEqual(alarms(effects), [null]);
  const finish = effects.find(e => e.type === 'finish');
  assert.deepEqual(finish, { type: 'finish', totals: { a: 30, b: 60 }, winner: 'b', reason: 'complete' });
});

test('shodné součty znamenají remízu', () => {
  const end = playOut(drawing(), { a: [500, 0, 0], b: [500, 0, 0] });
  assert.equal(end.winner, null);
  assert.equal(end.reason, 'complete');
});

test('odpojení uprostřed kola zápas pauzne a nastaví grace', () => {
  const s = drawing();
  const t = s.deadline - 8000; // do konce kola zbývá 8 s
  const { state, effects } = reduce(s, { type: 'disconnect', playerId: 'b' }, t);
  assert.equal(state.phase, 'paused');
  assert.equal(state.pausedPhase, 'drawing');
  assert.equal(state.pausedRemainingMs, 8000);
  assert.equal(state.deadline, t + GRACE_MS);
  assert.equal(state.players.b.connected, false);
  assert.deepEqual(alarms(effects), [t + GRACE_MS]);
});

test('odpojení pošle i stav, jinak soupeř kreslí do stojícího zápasu', () => {
  const { effects } = reduce(drawing(), { type: 'disconnect', playerId: 'b' }, NOW + 1000);
  const paused = sent(effects).filter(m => m.type === 'state' && m.phase === 'paused');
  assert.equal(paused.length, 1, 'bez state zprávy se pauzovací karta nikdy neukáže');
});

test('návrat do patnácti sekund vrátí zbytek času, ne nových pět', () => {
  const s = drawing();
  const t = s.deadline - 8000;
  const paused = reduce(s, { type: 'disconnect', playerId: 'b' }, t).state;
  const back = t + 10000; // vrátil se po 10 s
  const { state, effects } = reduce(paused, { type: 'reconnect', playerId: 'b' }, back);
  assert.equal(state.phase, 'drawing');
  assert.equal(state.players.b.connected, true);
  assert.equal(state.deadline, back + 8000, 'hodiny stály, zbývá pořád 8 s');
  assert.deepEqual(alarms(effects), [back + 8000]);
});

test('ticho po celou grace znamená kontumaci ve prospěch připojeného', () => {
  const s = drawing();
  const t = s.deadline - 8000;
  const paused = reduce(s, { type: 'disconnect', playerId: 'b' }, t).state;
  const { state, effects } = reduce(paused, { type: 'timeout' }, paused.deadline);
  assert.equal(state.phase, 'ended');
  assert.equal(state.reason, 'forfeit');
  assert.equal(state.winner, 'a');
  assert.ok(effects.some(e => e.type === 'finish' && e.reason === 'forfeit'));
});

test('odpojení hráče čekajícího na soupeře nic nepauzuje', () => {
  const alone = join(fresh(), 'a', 'Ada').state;
  const { state, effects } = reduce(alone, { type: 'disconnect', playerId: 'a' }, NOW + 5000);
  assert.equal(state.phase, 'waiting');
  assert.deepEqual(alarms(effects), [], 'prázdný zápas se nemá komu kontumovat');
  assert.equal(state.players.a.connected, false);
});

test('návrat známého hráče přes join se chová jako reconnect', () => {
  const s = drawing();
  const t = s.deadline - 8000;
  const paused = reduce(s, { type: 'disconnect', playerId: 'b' }, t).state;
  const { state } = reduce(paused, { type: 'join', playerId: 'b', nick: 'Bob' }, t + 1000);
  assert.equal(state.phase, 'drawing');
  assert.equal(state.order.length, 2, 'nesmí vzniknout třetí hráč');
});

test('po konci zápasu už odpojení nic nemění', () => {
  const end = playOut(drawing(), { a: [1, 1, 1], b: [2, 2, 2] });
  const { state, effects } = reduce(end, { type: 'disconnect', playerId: 'a' }, end.deadline + 1000);
  assert.equal(state.phase, 'ended');
  assert.deepEqual(alarms(effects), []);
});

test('guessesForRound: odhalí jen tipy z právě skončeného kola', () => {
  const guesses = { a: { i: 1, lines: [[[50, 14], [50, 14.1]]] }, b: { i: 0, lines: [[[50, 15], [50, 15.1]]] } };
  assert.deepEqual(guessesForRound(guesses, 1), { a: guesses.a.lines });
  assert.deepEqual(guessesForRound(guesses, 2), {});
});
