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
    default: return { state, effects: fx };
  }
}

function join(s, { playerId, nick }, now, fx) {
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
