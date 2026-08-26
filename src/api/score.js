import stations from '../../web/stations.json';
import { isoWeek, weeklyChallenge } from '../../web/shared/seed.mjs';
import { scoreRound } from '../../web/shared/scoring.mjs';
import { validateSubmission } from '../../web/shared/validate.mjs';
import { ipHash } from '../hash.js';

const json = (obj, status = 200) =>
  new Response(JSON.stringify(obj), { status, headers: { 'content-type': 'application/json' } });

const MAX_SAME_NICK = 20; // pojistka proti nekonečnému hledání volného čísla

// Odmítnutý zápis je jinak neviditelný — hráč hlásí „nepropsalo se" a v DB není nic.
// Log jde do Workers Logs (observability v wrangler.toml), vidět i v `wrangler tail`.
const reject = (error, ctx, status = 400) => {
  console.error('score reject', JSON.stringify({ error, ...ctx }));
  return json({ error }, status);
};

export async function onRequestPost({ request, env }) {
  const body = await request.json().catch(() => null);
  const week = isoWeek(new Date());
  const rounds = weeklyChallenge(week, stations);
  const v = validateSubmission(body, rounds, week);
  if (!v.ok) return reject(v.error, { nick: body?.nick, week: body?.week, server_week: week });

  const ip = await ipHash(request.headers.get('cf-connecting-ip'), env);
  const { cnt } = await env.DB.prepare(
    "SELECT COUNT(*) AS cnt FROM scores WHERE ip_hash = ? AND created_at > datetime('now','-1 hour')"
  ).bind(ip).first();
  if (cnt >= 10) return reject('rate limit', { nick: body.nick, cnt }, 429);

  // skóre počítá server — číslo od klienta se ignoruje; null = propadlé kolo
  const score = rounds.reduce(
    (sum, r, i) => sum + (body.lines[i] === null ? 0 : scoreRound(body.lines[i], r.station).score), 0);

  // Týdenní výzva je jednorázová, ale dva různí lidé si klidně zvolí stejnou přezdívku.
  // Kdo je kdo, se pozná podle otisku IP: vlastní druhý pokus se odmítne, cizímu
  // jmenovci se přidá pořadové číslo — "Maty (2)". Přezdívku zabírá až INSERT, takže
  // dva souběžné zápisy nesplynou; UNIQUE pošle druhý z nich na další číslo.
  const insert = env.DB.prepare(
    'INSERT INTO scores (week, nick, score, lines_json, ip_hash) VALUES (?, ?, ?, ?, ?)'
  );
  for (let n = 1; n <= MAX_SAME_NICK; n++) {
    const nick = n === 1 ? body.nick : `${body.nick} (${n})`;
    const taken = await env.DB.prepare(
      'SELECT ip_hash FROM scores WHERE week = ? AND nick = ?'
    ).bind(week, nick).first();
    if (taken) {
      if (taken.ip_hash === ip) return reject('already played', { nick }, 409);
      continue;
    }
    try {
      await insert.bind(week, nick, score, JSON.stringify(body.lines), ip).run();
      return json({ score, week, nick });
    } catch (e) {
      if (!String(e).includes('UNIQUE')) throw e;
    }
  }
  return reject('nick taken', { nick: body.nick }, 409);
}
