// Čistý stavový automat duelu. Nezná DOM, Cloudflare ani stanice — dostává
// jen délky kol a už spočítané skóre, takže se testuje obyčejným node --test.
export const COUNTDOWN_MS = 3000;
export const REVEAL_MS = 3000;
export const SHOT_CLOCK_MS = 5000;
export const GRACE_MS = 15000;
export const ROUND_MS = { single: 20000, transfer: 30000 };

export const roundMsFor = lineCount => (lineCount > 1 ? ROUND_MS.transfer : ROUND_MS.single);

// roundMs: pole délek kol v ms, jeho délka udává počet kol
export function initialState(code, roundMs) {
  return {
    code,
    roundMs,
    phase: 'waiting',      // waiting | countdown | drawing | reveal | paused | ended
    roundIndex: 0,
    deadline: 0,           // absolutní čas v ms; 0 = nic neběží
    players: {},           // id → {nick, connected, total, submitted, score}
    order: [],             // pořadí připojení, ['a', 'b']
    pausedPhase: null,
    pausedRemainingMs: 0,
    winner: null,
    reason: null,
  };
}

const send = (to, msg) => ({ type: 'send', to, msg });
const alarm = at => ({ type: 'alarm', at });

export const stateMsg = s => ({
  type: 'state',
  phase: s.phase,
  roundIndex: s.roundIndex,
  deadline: s.deadline,
  winner: s.winner,
  reason: s.reason,
  players: s.order.map(id => ({
    id,
    nick: s.players[id].nick,
    connected: s.players[id].connected,
    total: s.players[id].total,
    submitted: s.players[id].submitted,
  })),
});

export function reduce(state, event, now) {
  const s = structuredClone(state);
  const fx = [];
  switch (event.type) {
    case 'join': return join(s, event, now, fx);
    case 'timeout': return timeout(s, now, fx);
    case 'submit': return submit(s, event, now, fx);
    case 'disconnect': return disconnect(s, event, now, fx);
    case 'reconnect': return reconnect(s, event, now, fx);
    default: return { state, effects: fx };
  }
}

function join(s, { playerId, nick }, now, fx) {
  if (s.players[playerId]) return reconnect(s, { playerId }, now, fx); // návrat po výpadku
  if (s.order.length >= 2) {
    fx.push(send(playerId, { type: 'error', error: 'full' }));
    return { state: s, effects: fx };
  }
  s.players[playerId] = { nick, connected: true, total: 0, submitted: false, score: 0 };
  s.order.push(playerId);
  if (s.order.length === 2) {
    s.phase = 'countdown';
    s.deadline = now + COUNTDOWN_MS;
    fx.push(alarm(s.deadline));
  }
  fx.push(send('all', stateMsg(s)));
  return { state: s, effects: fx };
}

function timeout(s, now, fx) {
  switch (s.phase) {
    case 'countdown': return startRound(s, 0, now, fx);
    case 'drawing': return endRound(s, now, fx);
    case 'reveal':
      return s.roundIndex + 1 < s.roundMs.length
        ? startRound(s, s.roundIndex + 1, now, fx)
        : end(s, 'complete', fx);
    case 'paused': return end(s, 'forfeit', fx);
    default: return { state: s, effects: fx };
  }
}

function disconnect(s, { playerId }, now, fx) {
  const p = s.players[playerId];
  if (!p || s.phase === 'ended') return { state: s, effects: fx };
  p.connected = false;
  // ve waiting není co pauzovat ani komu kontumovat — soupeř ještě nedorazil
  if (s.phase !== 'paused' && s.phase !== 'waiting') {
    s.pausedPhase = s.phase;
    s.pausedRemainingMs = Math.max(0, s.deadline - now); // hodiny stojí, dokud se nevrátí
    s.phase = 'paused';
    s.deadline = now + GRACE_MS;
    fx.push(alarm(s.deadline));
  }
  fx.push(send('all', { type: 'opponent', id: playerId, connected: false, submitted: p.submitted }));
  return { state: s, effects: fx };
}

function reconnect(s, { playerId }, now, fx) {
  const p = s.players[playerId];
  if (!p) return { state: s, effects: fx };
  p.connected = true;
  if (s.phase === 'paused' && s.order.every(id => s.players[id].connected)) {
    s.phase = s.pausedPhase;
    s.deadline = now + s.pausedRemainingMs;
    s.pausedPhase = null;
    s.pausedRemainingMs = 0;
    fx.push(alarm(s.deadline));
  }
  fx.push(send('all', stateMsg(s)));
  return { state: s, effects: fx };
}

function end(s, reason, fx) {
  const totals = {};
  for (const id of s.order) totals[id] = s.players[id].total;
  s.phase = 'ended';
  s.deadline = 0;
  s.reason = reason;
  if (reason === 'forfeit') {
    s.winner = s.order.find(id => s.players[id].connected) ?? null;
  } else {
    const [a, b] = s.order;
    s.winner = totals[a] === totals[b] ? null : totals[a] > totals[b] ? a : b;
  }
  fx.push(
    alarm(null),
    send('all', { type: 'end', totals, winner: s.winner, reason }),
    { type: 'finish', totals, winner: s.winner, reason },
  );
  return { state: s, effects: fx };
}

function startRound(s, i, now, fx) {
  s.phase = 'drawing';
  s.roundIndex = i;
  s.deadline = now + s.roundMs[i];
  for (const id of s.order) {
    s.players[id].submitted = false;
    s.players[id].score = 0;
  }
  fx.push(alarm(s.deadline), send('all', { type: 'round', i, deadline: s.deadline }));
  return { state: s, effects: fx };
}

function submit(s, { playerId, i, score }, now, fx) {
  const p = s.players[playerId];
  // pozdní, duplicitní i cizí kolo se tiše zahodí — kolo je pak za 0
  if (s.phase !== 'drawing' || i !== s.roundIndex || !p || p.submitted || now > s.deadline) {
    return { state: s, effects: fx };
  }
  p.submitted = true;
  p.score = score;
  if (s.order.every(id => s.players[id].submitted)) return endRound(s, now, fx);

  s.deadline = Math.min(s.deadline, now + SHOT_CLOCK_MS); // min, jinak by pozdní tip čas přidal
  fx.push(
    alarm(s.deadline),
    send('all', { type: 'opponent', id: playerId, connected: p.connected, submitted: true }),
    send('all', { type: 'deadline', i, deadline: s.deadline }),
  );
  return { state: s, effects: fx };
}

function endRound(s, now, fx) {
  const scores = {}, totals = {};
  for (const id of s.order) {
    const p = s.players[id];
    p.total += p.score;   // kdo neodevzdal, má score 0 z startRound
    scores[id] = p.score;
    totals[id] = p.total;
  }
  s.phase = 'reveal';
  s.deadline = now + REVEAL_MS;
  fx.push(alarm(s.deadline), send('all', { type: 'reveal', i: s.roundIndex, scores, totals }));
  return { state: s, effects: fx };
}
