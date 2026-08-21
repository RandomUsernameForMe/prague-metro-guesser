import stations from '../../web/stations.json';
import { isoWeek, weeklyChallenge } from '../../web/shared/seed.mjs';
import { scoreRound } from '../../web/shared/scoring.mjs';
import { validateSubmission } from '../../web/shared/validate.mjs';
import { ipHash } from '../hash.js';

const json = (obj, status = 200) =>
  new Response(JSON.stringify(obj), { status, headers: { 'content-type': 'application/json' } });

export async function onRequestPost({ request, env }) {
  const body = await request.json().catch(() => null);
  const week = isoWeek(new Date());
  const rounds = weeklyChallenge(week, stations);
  const v = validateSubmission(body, rounds, week);
  if (!v.ok) return json({ error: v.error }, 400);

  const ip = await ipHash(request.headers.get('cf-connecting-ip'), env);
  const { cnt } = await env.DB.prepare(
    "SELECT COUNT(*) AS cnt FROM scores WHERE ip_hash = ? AND created_at > datetime('now','-1 hour')"
  ).bind(ip).first();
  if (cnt >= 10) return json({ error: 'rate limit' }, 429);

  // skóre počítá server — číslo od klienta se ignoruje; null = propadlé kolo
  const score = rounds.reduce(
    (sum, r, i) => sum + (body.lines[i] === null ? 0 : scoreRound(body.lines[i], r.station).score), 0);

  try {
    await env.DB.prepare(
      'INSERT INTO scores (week, nick, score, lines_json, ip_hash) VALUES (?, ?, ?, ?, ?)'
    ).bind(week, body.nick, score, JSON.stringify(body.lines), ip).run();
  } catch (e) {
    if (String(e).includes('UNIQUE')) return json({ error: 'nick už tento týden hrál' }, 409);
    throw e;
  }
  return json({ score, week });
}
