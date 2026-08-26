import { loadStations } from '../stations.js';
import { csvRow } from '../../web/shared/csv.mjs';

const json = (obj, status = 200) =>
  new Response(JSON.stringify(obj), { status, headers: { 'content-type': 'application/json' } });

const MAX_LIMIT = 50000;

const COLUMNS = ['id', 'created_at', 'session', 'mode', 'week', 'station_id', 'station_name',
  'station_lines', 'round_idx', 'u', 'v', 'dist_m', 'score', 'ms', 'timed_out', 'forfeited',
  'per_line_json', 'segments_json'];

export async function onRequestGet({ request, env }) {
  // bez nastaveného secretu se export nikdy neotevře veřejně
  if (!env.EXPORT_TOKEN) return json({ error: 'export disabled' }, 503);
  const q = new URL(request.url).searchParams;
  if (q.get('token') !== env.EXPORT_TOKEN) return json({ error: 'token' }, 403);

  const after = Number(q.get('after') ?? 0);
  const limit = Number(q.get('limit') ?? MAX_LIMIT);
  if (!Number.isInteger(after) || after < 0) return json({ error: 'after' }, 400);
  if (!Number.isInteger(limit) || limit < 1) return json({ error: 'limit' }, 400);

  const { results } = await env.DB.prepare(
    'SELECT * FROM guesses WHERE id > ? ORDER BY id LIMIT ?'
  ).bind(after, Math.min(limit, MAX_LIMIT)).all();

  const byId = new Map((await loadStations(env)).map(s => [s.id, s]));
  const body = [csvRow(COLUMNS), ...results.map(r => {
    const st = byId.get(r.station_id);
    return csvRow([r.id, r.created_at, r.session, r.mode, r.week, r.station_id,
      st?.name, st?.lines.join('+'), r.round_idx, r.u, r.v, r.dist_m, r.score, r.ms,
      r.timed_out, r.forfeited, r.per_line_json, r.segments_json]);
  })].join('\n');

  // víc řádků než limit → další stránka přes ?after=<poslední id>
  return new Response(body, {
    headers: {
      'content-type': 'text/csv; charset=utf-8',
      'content-disposition': 'attachment; filename="guesses.csv"',
    },
  });
}
