import { page, html, card, int, pct } from './_layout.js';

// CSV je za tokenem, ne za admin heslem. Odkaz proto token doplní ze secretu —
// vidí ho jen ten, kdo už prošel Basic Authem o kus výš v _middleware.js.
function exportLink(env) {
  if (!env.EXPORT_TOKEN) return '<li><i>CSV export — nenastavený EXPORT_TOKEN</i></li>';
  const href = `/api/export?token=${encodeURIComponent(env.EXPORT_TOKEN)}`;
  return `<li><a href="${href}" rel="noreferrer">CSV export všech kol</a></li>`;
}

export async function onRequestGet({ env }) {
  const s = await env.DB.prepare(
    `SELECT COUNT(DISTINCT session) AS hraci, COUNT(*) AS kol,
            AVG(score) AS skore, SUM(forfeited) AS propadlo
     FROM guesses WHERE created_at > datetime('now','-7 days')`
  ).first();

  const body = `
<div class="cards">
  ${card('hráčů za 7 dní', int(s.hraci))}
  ${card('kol za 7 dní', int(s.kol))}
  ${card('ø skóre', s.kol ? int(s.skore) : '—')}
  ${card('propadlých kol', pct(s.propadlo ?? 0, s.kol))}
</div>
<p><small>Hráč = jedno UUID z localStorage. Kdo si smaže úložiště nebo hraje na
dvou zařízeních, počítá se vícekrát — je to horní odhad.</small></p>
<h2>Kam dál</h2>
<ul>
  <li><a href="/admin/stats">Statistiky</a> — denní provoz a obtížnost stanic</li>
  <li><a href="/admin/reports">Hlášení chyb</a> — co hráči nahlásili jako špatně zadanou stanici</li>
  ${exportLink(env)}
</ul>`;

  return html(page('Přehled', '/admin/', body));
}
