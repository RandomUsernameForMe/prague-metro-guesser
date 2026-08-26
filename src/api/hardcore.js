import stations from '../../web/stations.json';
import { VIEW_SIZE } from '../../web/shared/seed.mjs';
import { scoreRound } from '../../web/shared/scoring.mjs';
import { validateRound } from '../../web/shared/validate.mjs';
import { hardcoreRound, nextLives, LIVES_MAX, MAX_ROUNDS, SPAN } from '../../web/shared/hardcore.mjs';
import { ipHash } from '../hash.js';

const json = (obj, status = 200) =>
  new Response(JSON.stringify(obj), { status, headers: { 'content-type': 'application/json' } });

const NICK_RE = /^[\p{L}\p{N} _-]{3,16}$/u;
const SPAN_M = VIEW_SIZE * SPAN; // hardcore rotuje, tahy sahají až do rohů plátna

// Dvacítka nejlepších plus řádek hráče ?nick=, i když je až někde dole; pořadí počítá SQL.
export async function onRequestGet({ request, env }) {
  const nick = new URL(request.url).searchParams.get('nick') ?? '';
  const { results } = await env.DB.prepare(
    `SELECT nick, rounds, pos FROM (
       SELECT nick, rounds, ROW_NUMBER() OVER (ORDER BY rounds DESC, created_at ASC) AS pos
       FROM hardcore
     ) WHERE pos <= 20 OR nick = ?
     ORDER BY pos`
  ).bind(nick).all();
  return json({ entries: results });
}

export async function onRequestPost({ request, env }) {
  const b = await request.json().catch(() => null);
  if (!b || typeof b !== 'object') return json({ error: 'body' }, 400);
  if (typeof b.nick !== 'string' || !NICK_RE.test(b.nick)) return json({ error: 'nick' }, 400);
  if (!Number.isInteger(b.seed) || b.seed < 0 || b.seed > 0xffffffff) return json({ error: 'seed' }, 400);
  if (!Array.isArray(b.rounds) || !b.rounds.length || b.rounds.length > MAX_ROUNDS) {
    return json({ error: 'rounds' }, 400);
  }

  // Délku runu počítá server ze seedu a odeslaných úseček — číslo od klienta neexistuje.
  // Kola za smrtí se zahodí, i kdyby je klient poslal.
  let lives = LIVES_MAX, played = 0;
  for (const segments of b.rounds) {
    const round = hardcoreRound(b.seed, played, stations);
    let d = null;
    if (segments !== null) {
      const v = validateRound(segments, round, { span: SPAN_M });
      if (!v.ok) return json({ error: `${v.error} round ${played}` }, 400);
      d = scoreRound(segments, round.station).d;
    }
    lives = nextLives(lives, d);
    played++;
    if (lives <= 0) break;
  }

  const ip = await ipHash(request.headers.get('cf-connecting-ip'), env);
  const { cnt } = await env.DB.prepare(
    "SELECT COUNT(*) AS cnt FROM hardcore WHERE ip_hash = ? AND created_at > datetime('now','-1 hour')"
  ).bind(ip).first();
  if (cnt >= 10) return json({ error: 'rate limit' }, 429);

  // žebříček je all-time, takže se zapisuje jen lepší run než ten uložený
  await env.DB.prepare(
    `INSERT INTO hardcore (nick, rounds, seed, run_json, ip_hash) VALUES (?, ?, ?, ?, ?)
     ON CONFLICT(nick) DO UPDATE SET
       rounds = excluded.rounds, seed = excluded.seed, run_json = excluded.run_json,
       ip_hash = excluded.ip_hash, created_at = datetime('now')
     WHERE excluded.rounds > hardcore.rounds`
  ).bind(b.nick, played, b.seed, JSON.stringify(b.rounds), ip).run();

  return json({ rounds: played });
}
