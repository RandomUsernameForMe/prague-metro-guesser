import stations from '../../web/stations.json';
import { page, html, esc, int, fix1, pct, secs, den } from './layout.js';

const byId = new Map(stations.map(s => [s.id, s]));

const empty = text => `<p><i>${text}</i></p>`;

function dailyTable(rows) {
  if (!rows.length) return empty('Za posledních 14 dní se nehrálo.');
  return `<table>
<tr><th>den</th><th class="num">kol</th><th class="num">hráčů</th><th class="num">ø skóre</th></tr>
${rows.map(r => `<tr>
  <td>${esc(den(r.den))}</td>
  <td class="num">${int(r.kol)}</td>
  <td class="num">${int(r.hraci)}</td>
  <td class="num">${int(r.skore)}</td>
</tr>`).join('')}
</table>`;
}

function stationTable(rows) {
  if (!rows.length) return empty('Zatím nikdo nic nezkusil.');
  // nejtěžší první; stanice bez skóre (samé propadlé kolo) patří na začátek
  const sorted = [...rows].sort((a, b) => (a.avg_score ?? -1) - (b.avg_score ?? -1));
  return `<table>
<tr><th>stanice</th><th class="num">kol</th><th class="num">ø skóre</th>
    <th class="num">ø vzdálenost</th><th class="num">propadlo</th><th class="num">ø čas</th></tr>
${sorted.map(r => {
    const st = byId.get(r.station_id);
    const name = st ? esc(st.name) : `<i>neznámá</i> <small>${esc(r.station_id)}</small>`;
    const lines = st ? ` <span class="l">${esc(st.lines.join('+'))}</span>` : '';
    return `<tr>
  <td>${name}${lines}</td>
  <td class="num">${int(r.n)}</td>
  <td class="num">${int(r.avg_score)}</td>
  <td class="num">${r.avg_dist === null ? '—' : `${fix1(r.avg_dist)} m`}</td>
  <td class="num">${pct(r.forfeits ?? 0, r.n)}</td>
  <td class="num">${secs(r.avg_ms)}</td>
</tr>`;
  }).join('')}
</table>`;
}

export async function onRequestGet({ env }) {
  const [daily, perStation] = await env.DB.batch([
    env.DB.prepare(
      `SELECT date(created_at) AS den, COUNT(*) AS kol,
              COUNT(DISTINCT session) AS hraci, AVG(score) AS skore
       FROM guesses WHERE created_at > datetime('now','-14 days')
       GROUP BY den ORDER BY den DESC`
    ),
    env.DB.prepare(
      `SELECT station_id, COUNT(*) AS n, AVG(score) AS avg_score, AVG(dist_m) AS avg_dist,
              SUM(forfeited) AS forfeits, AVG(ms) AS avg_ms
       FROM guesses GROUP BY station_id`
    ),
  ]);

  const body = `
<h2>Posledních 14 dní</h2>
${dailyTable(daily.results)}
<h2>Stanice <small>(nejtěžší první, za celou dobu)</small></h2>
${stationTable(perStation.results)}`;

  return html(page('Statistiky', '/admin/stats', body));
}
