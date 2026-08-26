import { loadStations } from '../stations.js';
import { page, html, esc } from './layout.js';

const LIMIT = 200;

// ponytail: souřadnice jako text; když je budeš chtít vidět v mapě, obal je odkazem na mapy.cz
const segmentsCell = (segmentsJson, empty = '<i>propadlé kolo — nic nenakreslil</i>') => {
  if (!segmentsJson) return empty;
  try {
    return JSON.parse(segmentsJson)
      .map(seg => seg.map(([lat, lng]) => `${lat.toFixed(5)},${lng.toFixed(5)}`).join(' → '))
      .map(esc).join('<br>');
  } catch {
    return '<i>?</i>';
  }
};

function stationCell(r, stations) {
  const current = stations.find(s => s.id === r.station_id);
  const lines = current ? current.lines.join('+') : '—';
  // jméno v době hlášení vs. dnes: hned je vidět, jestli je report už vyřízený
  const renamed = current && current.name !== r.station_name
    ? `<br><i>dnes: ${esc(current.name)}</i>` : '';
  // odkaz na editor os — tam se hlášení vyřizuje
  const name = current
    ? `<a href="/admin/station?id=${encodeURIComponent(r.station_id)}">${esc(r.station_name)}</a>`
    : esc(r.station_name);
  return `<b>${name}</b> <span class="l">${esc(lines)}</span>${renamed}
          <br><small>${esc(r.station_id)}</small>`;
}

const body = (rows, stations) => `<p><small>${rows.length} hlášení, zobrazuje se posledních ${LIMIT}.</small></p>
${rows.length ? `<table>
<tr><th>kdy</th><th>stanice</th><th>kudy osa vede podle hráče</th><th>komentář</th><th>co nakreslil v kole</th><th>režim</th></tr>
${rows.map(r => `<tr>
  <td><small>${esc(r.created_at)}</small></td>
  <td>${stationCell(r, stations)}</td>
  <td><small>${segmentsCell(r.fix_json, '<i>osu nezakreslil</i>')}</small></td>
  <td class="note">${r.note ? esc(r.note) : '<i>—</i>'}</td>
  <td><small>${segmentsCell(r.segments_json)}</small></td>
  <td><small>${esc(r.mode)}<br>${esc(r.week)}</small></td>
</tr>`).join('')}
</table>` : '<p><i>Zatím nic.</i></p>'}`;

export async function onRequestGet({ env }) {
  const { results } = await env.DB.prepare(
    'SELECT * FROM reports ORDER BY created_at DESC LIMIT ?'
  ).bind(LIMIT).all();
  const stations = await loadStations(env);
  return html(page('Hlášení chyb ve stanicích', '/admin/reports', body(results, stations)));
}
