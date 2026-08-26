import { loadStations } from '../stations.js';

const json = (obj, status = 200, headers = {}) =>
  new Response(JSON.stringify(obj), { status, headers: { 'content-type': 'application/json', ...headers } });

// Agregace čte celou tabulku guesses a endpoint je veřejný — bez cache by každé
// zavolání rostlo s databází a šlo tlouct ve smyčce. Čísla o pár minut starší nevadí.
const TTL_S = 300;

const MODES = new Set(['weekly', 'warmup', 'casual', 'duel']);
const round1 = n => (n === null ? null : Math.round(n * 10) / 10);

// veřejné: agregace bez identifikátorů. Výběr týdenní výzvy tím neuniká — je
// deterministický z čísla týdne a stations.json, spočítá si ho kdokoli i dnes.
export async function onRequestGet({ request, env }) {
  const mode = new URL(request.url).searchParams.get('mode');
  if (mode && !MODES.has(mode)) return json({ error: 'mode' }, 400);

  const cached = await caches.default.match(request);
  if (cached) return cached;

  const stmt = env.DB.prepare(
    `SELECT station_id, COUNT(*) AS n, AVG(score) AS avg_score, AVG(dist_m) AS avg_dist,
            SUM(forfeited) AS forfeits, AVG(ms) AS avg_ms
     FROM guesses ${mode ? 'WHERE mode = ?' : ''} GROUP BY station_id`
  );
  const { results } = await (mode ? stmt.bind(mode) : stmt).all();

  const byId = new Map((await loadStations(env)).map(s => [s.id, s]));
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

  const res = json({ mode: mode ?? 'all', stations: entries }, 200,
    { 'cache-control': `public, max-age=${TTL_S}` });
  await caches.default.put(request, res.clone());
  return res;
}
