import stations from '../../web/stations.json';

const json = (obj, status = 200) =>
  new Response(JSON.stringify(obj), { status, headers: { 'content-type': 'application/json' } });

const MODES = new Set(['weekly', 'warmup', 'casual']);
const byId = new Map(stations.map(s => [s.id, s]));
const round1 = n => (n === null ? null : Math.round(n * 10) / 10);

// veřejné: agregace bez identifikátorů. Výběr týdenní výzvy tím neuniká — je
// deterministický z čísla týdne a stations.json, spočítá si ho kdokoli i dnes.
export async function onRequestGet({ request, env }) {
  const mode = new URL(request.url).searchParams.get('mode');
  if (mode && !MODES.has(mode)) return json({ error: 'mode' }, 400);

  const stmt = env.DB.prepare(
    `SELECT station_id, COUNT(*) AS n, AVG(score) AS avg_score, AVG(dist_m) AS avg_dist,
            SUM(forfeited) AS forfeits, AVG(ms) AS avg_ms
     FROM guesses ${mode ? 'WHERE mode = ?' : ''} GROUP BY station_id`
  );
  const { results } = await (mode ? stmt.bind(mode) : stmt).all();

  const entries = results.map(r => {
    const st = byId.get(r.station_id);
    return {
      id: r.station_id,
      name: st?.name ?? null,
      lines: st?.lines ?? [],
      n: r.n,
      avgScore: round1(r.avg_score),
      avgDist: round1(r.avg_dist),
      forfeits: r.forfeits,
      avgMs: Math.round(r.avg_ms),
    };
  }).sort((a, b) => a.avgScore - b.avgScore); // nejtěžší stanice první

  return json({ mode: mode ?? 'all', stations: entries });
}
