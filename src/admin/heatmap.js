import { loadStations } from '../stations.js';
import { layout } from '../../web/tiles.mjs';
import { page, html, esc, int, fix1, pct, card } from './layout.js';
import { heatmapLines, axisLines } from './heatmap-geom.js';

const SIZE = 640;      // hrana mapy v px; výřez je stejných 600 m jako ve hře
const DRAW = 500;      // strop na počet vykreslených kol, ať stránka nemá megabajty
const LINE = { A: '#009f4d', B: '#ffd400', C: '#d6001c' };

// Průsvitnost je kompromis: při deseti tipech musí být čára ještě vidět, při pěti
// stech se nesmí slít do plochy. 0,15 sedí na obojí — pět tipů přes sebe je plná barva.
const OPACITY = 0.15;

const px = n => Math.round(n * 10) / 10;

function mapHtml(station, lines) {
  const tiles = layout({ lat: station.lat, lng: station.lng }, SIZE).map(t =>
    `<img src="${esc(t.url)}" alt="" style="position:absolute;left:${px(t.left)}px;top:${px(t.top)}px;` +
    `width:${px(t.w)}px;height:${px(t.h)}px">`).join('');

  const guesses = lines.map(([[x1, y1], [x2, y2]]) =>
    `<line x1="${px(x1)}" y1="${px(y1)}" x2="${px(x2)}" y2="${px(y2)}"/>`).join('');

  const axes = axisLines(station, SIZE).map(a =>
    `<polyline points="${a.pts.map(p => `${px(p[0])},${px(p[1])}`).join(' ')}" fill="none"
       stroke="${LINE[a.line] ?? '#fff'}" stroke-width="4" stroke-linecap="round" stroke-opacity="0.9"/>`).join('');

  // overflow: krajní dlaždice přesahují hranu výřezu a bez ořezu by přelezly stránku
  return `<div style="position:relative;width:${SIZE}px;height:${SIZE}px;max-width:100%;
    overflow:hidden;background:#000">
  ${tiles}
  <svg viewBox="0 0 ${SIZE} ${SIZE}" style="position:absolute;inset:0;width:100%;height:100%">
    <g stroke="#ff2d6f" stroke-opacity="${OPACITY}" stroke-width="2" stroke-linecap="round">${guesses}</g>
    ${axes}
  </svg>
</div>`;
}

export async function onRequestGet({ request, env }) {
  const id = new URL(request.url).searchParams.get('station');
  const station = (await loadStations(env)).find(s => s.id === id);
  if (!station) {
    return html(page('Neznámá stanice', '/admin/stats',
      '<p>Taková stanice není. <a href="/admin/stats">Zpátky na statistiky</a>.</p>'));
  }

  const [agg, rows] = await env.DB.batch([
    env.DB.prepare(
      `SELECT COUNT(*) AS n, AVG(score) AS avg_score, AVG(dist_m) AS avg_dist, SUM(forfeited) AS forfeits
       FROM guesses WHERE station_id = ?`
    ).bind(station.id),
    env.DB.prepare(
      'SELECT segments_json FROM guesses WHERE station_id = ? ORDER BY created_at DESC, id DESC LIMIT ?'
    ).bind(station.id, DRAW),
  ]);

  const s = agg.results[0];
  const { lines, outside } = heatmapLines(rows.results, station, SIZE);

  // kol v tabulce vs. úseček na mapě: přestupní stanice chce osu za každou linku,
  // takže jedno kolo může být víc čar. Proto se počítá obojí.
  const note = !s.n
    ? 'Tuhle stanici zatím nikdo nehrál.'
    : `Nakresleno ${int(lines.length)} úseček z posledních ${int(Math.min(s.n, DRAW))} kol` +
      (s.n > DRAW ? ` (z&nbsp;celkových ${int(s.n)})` : '') +
      (outside ? `. Mimo výřez padlo ${int(outside)} úseček — do obrázku se nevešly.` : '.');

  const body = `
<p><a href="/admin/stats">← statistiky</a> · <a href="/admin/station?id=${encodeURIComponent(station.id)}">upravit osu</a></p>
<div class="cards">
  ${card('kol', int(s.n))}
  ${card('ø skóre', s.n ? int(s.avg_score) : '—')}
  ${card('ø vzdálenost', s.avg_dist === null ? '—' : `${fix1(s.avg_dist)} m`)}
  ${card('propadlo', pct(s.forfeits ?? 0, s.n))}
</div>
${mapHtml(station, lines)}
<p><small>${note} Růžově tipy hráčů, barevně skutečná osa nástupiště. Výřez je
600 × 600 m, stejný jako ve hře, ale vystředěný na stanici — hráči ji viděli
posunutou. Ortofoto © ČÚZK.</small></p>`;

  return html(page(`${station.name} (${station.lines.join('+')})`, '/admin/stats', body));
}
