import stations from '../../web/stations.json';
import { validateReport } from '../../web/shared/validate.mjs';
import { ipHash } from '../hash.js';

const json = (obj, status = 200) =>
  new Response(JSON.stringify(obj), { status, headers: { 'content-type': 'application/json' } });

export async function onRequestPost({ request, env }) {
  const body = await request.json().catch(() => null);
  const v = validateReport(body, stations);
  if (!v.ok) return json({ error: v.error }, 400);

  const ip = await ipHash(request.headers.get('cf-connecting-ip'), env);
  const { cnt } = await env.DB.prepare(
    "SELECT COUNT(*) AS cnt FROM reports WHERE ip_hash = ? AND created_at > datetime('now','-1 hour')"
  ).bind(ip).first();
  if (cnt >= 5) return json({ error: 'rate limit' }, 429);

  await env.DB.prepare(
    `INSERT INTO reports (station_id, station_name, note, mode, week, segments_json, fix_json, ip_hash)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
  ).bind(
    v.station.id, v.station.name, v.note, body.mode, body.week,
    v.segments && JSON.stringify(v.segments), v.fix && JSON.stringify(v.fix), ip,
  ).run();

  return json({ ok: true });
}
