import stations from '../web/stations.json';
import { weeklyChallenge, roundViewport, isoWeek } from '../web/shared/seed.mjs';
import { scoreRound } from '../web/shared/scoring.mjs';
import { validateRound } from '../web/shared/validate.mjs';
import { initialState, reduce, roundMsFor, guessesForRound } from '../web/shared/duel-machine.mjs';
import { CODE_RE } from '../web/shared/code.mjs';
import { ipHash, duelSeed } from './hash.js';

const TOKEN_RE = /^[0-9a-f]{16}$/;
const CLEANUP_MS = 300000; // po dohraném zápase se storage Durable Objectu smaže

export class MatchDO {
  constructor(ctx, env) {
    this.ctx = ctx;
    this.env = env;
  }

  // po hibernaci je instance prázdná — stav a kola se dopočítají z kódu a storage
  async load(code) {
    if (this.state) return;
    // seed přes secret: z veřejného kódu zápasu si stanice nikdo dopředu nespočítá
    this.rounds = weeklyChallenge(await duelSeed(code, this.env), stations);
    this.seats = (await this.ctx.storage.get('seats')) ?? {};
    this.guesses = (await this.ctx.storage.get('guesses')) ?? {}; // seat → {i, lines} posledního tipu
    this.state = (await this.ctx.storage.get('state'))
      ?? initialState(code, this.rounds.map(r => roundMsFor(r.station.lines.length)));
  }

  async fetch(request) {
    const url = new URL(request.url);
    const code = url.pathname.split('/').pop();
    if (!CODE_RE.test(code)) return new Response('bad code', { status: 400 });
    if (request.headers.get('upgrade') !== 'websocket') return new Response('expected websocket', { status: 426 });

    const token = url.searchParams.get('player') ?? '';
    if (!TOKEN_RE.test(token)) return new Response('bad player', { status: 400 });
    const nick = (url.searchParams.get('nick') ?? '').slice(0, 16) || 'hráč';
    const session = url.searchParams.get('session') ?? '';

    await this.load(code);
    await this.ctx.storage.put('code', code); // alarm si kód jinak nemá odkud vzít

    let seat = this.seats[token];
    if (!seat) {
      if (Object.keys(this.seats).length >= 2) return new Response('full', { status: 409 });
      seat = Object.values(this.seats).includes('a') ? 'b' : 'a';
      this.seats[token] = seat;
      await this.ctx.storage.put('seats', this.seats);
    }

    const [client, server] = Object.values(new WebSocketPair());
    this.ctx.acceptWebSocket(server, [seat]);
    server.serializeAttachment({ seat, code, session, ip: request.headers.get('cf-connecting-ip') ?? '' });
    await this.apply({ type: 'join', playerId: seat, nick }, Date.now());
    return new Response(null, { status: 101, webSocket: client });
  }

  async webSocketMessage(ws, raw) {
    const { seat, code, session, ip } = ws.deserializeAttachment();
    let msg;
    try { msg = JSON.parse(raw); } catch { return; }
    await this.load(code);

    if (msg.type === 'ready') return this.apply({ type: 'ready', playerId: seat }, Date.now());
    if (msg.type !== 'submit') return;
    // levná brána dřív než skórování a dva zápisy do storage — tyhle tipy automat stejně zahodí
    const s = this.state;
    if (s.phase !== 'drawing' || msg.i !== s.roundIndex || s.players[seat]?.submitted) return;

    const round = this.rounds[msg.i];
    if (!round) return;
    // úsečky musí ležet ve výřezu, který hráč dostal; neúplné kolo je za nulu
    const v = validateRound(msg.lines, round, { allowPartial: true });
    if (!v.ok) return;
    const complete = msg.lines.length === round.station.lines.length;
    const score = complete ? scoreRound(msg.lines, round.station).score : 0;
    // tip se ukládá před apply — druhý submit hned spustí reveal, který ho posílá soupeři
    this.guesses[seat] = { i: msg.i, lines: msg.lines };
    await this.ctx.storage.put('guesses', this.guesses);
    await this.apply({ type: 'submit', playerId: seat, i: msg.i, score }, Date.now());
    await this.logGuess({ session, ip, round, i: msg.i, segments: msg.lines, score, complete });
  }

  async webSocketClose(ws) {
    const { seat, code } = ws.deserializeAttachment();
    // po reloadu se nový socket stihne připojit dřív, než dorazí close toho starého —
    // pak není co pauzovat, hráč sedí u počítače
    if (this.ctx.getWebSockets(seat).some(other => other !== ws)) return;
    await this.load(code);
    await this.apply({ type: 'disconnect', playerId: seat }, Date.now());
  }

  async webSocketError(ws) {
    return this.webSocketClose(ws);
  }

  async alarm() {
    const code = await this.ctx.storage.get('code');
    if (!code) return;
    await this.load(code);
    // po dohraném zápase má alarm jediný úkol: uklidit po sobě
    if (this.state.phase === 'ended') {
      await this.ctx.storage.deleteAll();
      this.state = null;
      return;
    }
    await this.apply({ type: 'timeout' }, Date.now());
  }

  async apply(event, now) {
    const { state, effects } = reduce(this.state, event, now);
    this.state = state;
    await this.ctx.storage.put('state', state);
    for (const fx of effects) {
      if (fx.type === 'alarm') {
        await (fx.at === null ? this.ctx.storage.deleteAlarm() : this.ctx.storage.setAlarm(fx.at));
      } else if (fx.type === 'send') {
        this.send(fx.to, fx.msg);
      } else if (fx.type === 'finish') {
        await this.persist(fx);
        // end() posílá alarm(null) dřív v poli efektů, takže tenhle úklid přežije
        await this.ctx.storage.setAlarm(Date.now() + CLEANUP_MS);
      }
    }
  }

  send(to, msg) {
    const payload = this.enrich(msg);
    const sockets = to === 'all' ? this.ctx.getWebSockets() : this.ctx.getWebSockets(to);
    for (const ws of sockets) {
      const { seat } = ws.deserializeAttachment();
      try { ws.send(JSON.stringify({ ...payload, you: seat })); } catch { /* mrtvý socket */ }
    }
  }

  // zadání kola: co klient potřebuje, aby ho uměl vykreslit
  roundInfo(i) {
    const st = this.rounds[i].station;
    return {
      i,
      viewport: roundViewport(this.rounds[i]),
      name: st.name,      // jméno je zadání kola, ne tajemství
      lines: st.lines,
    };
  }

  // automat neví nic o stanicích ani o hodinách klienta — doplní se to tady
  enrich(msg) {
    const out = { ...msg };
    if (out.deadline > 0) out.msLeft = Math.max(0, out.deadline - Date.now()); // proti rozjetým hodinám klienta
    if (out.type === 'round') Object.assign(out, this.roundInfo(out.i));
    // po reloadu i po odpauzování se klient vrací doprostřed kola — bez zadání by kreslil naslepo
    if (out.type === 'state' && out.phase === 'drawing') Object.assign(out, this.roundInfo(out.roundIndex));
    // dlaždice dalšího kola ať se stáhnou, dokud běží odpočet nebo odhalení
    if (out.type === 'state' && out.phase === 'countdown') out.nextViewport = roundViewport(this.rounds[0]);
    if (out.type === 'reveal') {
      out.axes = this.rounds[out.i].station.axes;   // skutečné osy až po konci kola
      out.guesses = guessesForRound(this.guesses, out.i); // i tipy soupeře — kolo skončilo, není co tajit
      const next = this.rounds[out.i + 1];
      if (next) out.nextViewport = roundViewport(next);
    }
    return out;
  }

  async persist({ totals, winner, reason }) {
    const [a, b] = this.state.order;
    const nick = id => this.state.players[id]?.nick ?? '';
    try {
      await this.env.DB.prepare(
        `INSERT OR IGNORE INTO duels (code, nick_a, nick_b, score_a, score_b, winner, ended_reason)
         VALUES (?, ?, ?, ?, ?, ?, ?)`
      ).bind(this.state.code, nick(a), nick(b), totals[a] ?? 0, totals[b] ?? 0, winner, reason).run();
    } catch { /* výsledek v DB je bonus, zápas tím nepadá */ }
  }

  // stejný řádek jako /api/guess, jen ho zapisuje server sám — v duelu klient POST neposílá
  async logGuess({ session, ip, round, i, segments, score, complete }) {
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(session ?? '')) return;
    const r = complete ? scoreRound(segments, round.station) : null;
    const hash = await ipHash(ip, this.env);
    try {
      await this.env.DB.prepare(
        `INSERT INTO guesses (session, mode, week, station_id, round_idx, u, v, segments_json,
                              dist_m, score, per_line_json, ms, timed_out, forfeited, ip_hash)
         VALUES (?, 'duel', ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, 0, ?, ?)`
      ).bind(
        session, isoWeek(new Date()), round.station.id, i, round.u, round.v,
        JSON.stringify(segments), r?.d ?? null, score, r ? JSON.stringify(r.perLine) : null,
        complete ? 0 : 1, hash,
      ).run();
    } catch { /* statistika nesmí shodit zápas */ }
  }
}
