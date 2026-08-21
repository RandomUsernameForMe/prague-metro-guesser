import stations from '../../web/stations.json';
import { isoWeek } from '../../web/shared/seed.mjs';
import { scoreRound } from '../../web/shared/scoring.mjs';
import { validateRound } from '../../web/shared/validate.mjs';
import { ipHash } from '../hash.js';

const json = (obj, status = 200) =>
  new Response(JSON.stringify(obj), { status, headers: { 'content-type': 'application/json' } });

const MODES = new Set(['weekly', 'warmup', 'casual']);
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const HOURLY_LIMIT = 300; // casual kolo trvá 20 s → poctivý hráč se sem nedostane
const byId = new Map(stations.map(s => [s.id, s]));
const inUnit = n => typeof n === 'number' && Number.isFinite(n) && n >= 0 && n <= 1;

export async function onRequestPost({ request, env }) {
  const b = await request.json().catch(() => null);
  if (!b || typeof b !== 'object') return json({ error: 'body' }, 400);
  if (typeof b.session !== 'string' || !UUID_RE.test(b.session)) return json({ error: 'session' }, 400);
  if (!MODES.has(b.mode)) return json({ error: 'mode' }, 400);
  if (!Number.isInteger(b.roundIdx) || b.roundIdx < 0 || b.roundIdx > 999) return json({ error: 'roundIdx' }, 400);
  if (!inUnit(b.u) || !inUnit(b.v)) return json({ error: 'viewport' }, 400);
  if (!Number.isInteger(b.ms) || b.ms < 0 || b.ms > 600000) return json({ error: 'ms' }, 400);
  if (typeof b.timedOut !== 'boolean' || typeof b.forfeited !== 'boolean') return json({ error: 'flags' }, 400);

  const station = byId.get(b.stationId);
  if (!station) return json({ error: 'station' }, 400);
  // úsečky musí ležet uvnitř výřezu, který si klient nárokuje — jinak je přepočet skóre nesmysl
  const v = validateRound(b.segments, { station, u: b.u, v: b.v }, { allowPartial: b.forfeited });
  if (!v.ok) return json({ error: v.error }, 400);

  const ip = await ipHash(request.headers.get('cf-connecting-ip'), env);
  const { cnt } = await env.DB.prepare(
    "SELECT COUNT(*) AS cnt FROM guesses WHERE ip_hash = ? AND created_at > datetime('now','-1 hour')"
  ).bind(ip).first();
  if (cnt >= HOURLY_LIMIT) return json({ error: 'rate limit' }, 429);

  // skóre počítá server ze samotných úseček; číslo od klienta se nikdy nepoužije
  let dist = null, score = 0, perLine = null;
  if (!b.forfeited) {
    const r = scoreRound(b.segments, station);
    dist = r.d;
    score = r.score;
    perLine = JSON.stringify(r.perLine);
  }

  await env.DB.prepare(
    `INSERT INTO guesses (session, mode, week, station_id, round_idx, u, v, segments_json,
                          dist_m, score, per_line_json, ms, timed_out, forfeited, ip_hash)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).bind(
    b.session, b.mode, isoWeek(new Date()), station.id, b.roundIdx, b.u, b.v,
    JSON.stringify(b.segments), dist, score, perLine, b.ms,
    b.timedOut ? 1 : 0, b.forfeited ? 1 : 0, ip,
  ).run();

  // odpověď nic neprozrazuje — endpoint nesmí jít zneužít jako nápověda
  return json({ ok: true });
}
