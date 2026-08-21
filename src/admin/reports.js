import stations from '../../web/stations.json';

const LIMIT = 200;

async function sha256(s) {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s));
  return [...new Uint8Array(buf)].map(b => b.toString(16).padStart(2, '0')).join('');
}

// heslo: `npx wrangler pages secret put ADMIN_PASSWORD` (lokálně řádek v .dev.vars)
// hesla porovnáváme jako otisky stejné délky — na délku ani obsah se tím nedá hádat
async function authorized(request, env) {
  const expected = env.ADMIN_PASSWORD;
  if (!expected) return false; // nenastavený secret admin nikdy neotevře
  const header = request.headers.get('authorization') || '';
  if (!header.startsWith('Basic ')) return false;
  let given;
  try {
    given = atob(header.slice(6)).split(':').slice(1).join(':');
  } catch {
    return false;
  }
  return await sha256(given) === await sha256(expected);
}

const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

// ponytail: souřadnice jako text; když je budeš chtít vidět v mapě, obal je odkazem na mapy.cz
const segmentsCell = segmentsJson => {
  if (!segmentsJson) return '<i>propadlé kolo — nic nenakreslil</i>';
  try {
    return JSON.parse(segmentsJson)
      .map(seg => seg.map(([lat, lng]) => `${lat.toFixed(5)},${lng.toFixed(5)}`).join(' → '))
      .map(esc).join('<br>');
  } catch {
    return '<i>?</i>';
  }
};

function stationCell(r) {
  const current = stations.find(s => s.id === r.station_id);
  const lines = current ? current.lines.join('+') : '—';
  // jméno v době hlášení vs. dnes: hned je vidět, jestli je report už vyřízený
  const renamed = current && current.name !== r.station_name
    ? `<br><i>dnes: ${esc(current.name)}</i>` : '';
  return `<b>${esc(r.station_name)}</b> <span class="l">${esc(lines)}</span>${renamed}
          <br><small>${esc(r.station_id)}</small>`;
}

const page = rows => `<!DOCTYPE html>
<html lang="cs"><head><meta charset="utf-8"><title>Hlášení chyb ve stanicích</title>
<style>
  body { font: 14px/1.5 system-ui, sans-serif; margin: 24px; background: #121416; color: #e8e8e8; }
  h1 { font-size: 20px; }
  table { border-collapse: collapse; width: 100%; }
  th, td { text-align: left; padding: 8px 10px; border-bottom: 1px solid #2b2f33; vertical-align: top; }
  th { color: #9aa0a6; font-weight: 600; }
  td.note { white-space: pre-wrap; max-width: 40ch; }
  small, i { color: #9aa0a6; }
  .l { color: #121416; background: #e8e8e8; padding: 0 5px; border-radius: 3px; font-weight: 700; }
</style></head><body>
<h1>Hlášení chyb ve stanicích <small>(${rows.length}, posledních ${LIMIT})</small></h1>
${rows.length ? `<table>
<tr><th>kdy</th><th>stanice</th><th>jak to má být správně</th><th>co nakreslil</th><th>režim</th></tr>
${rows.map(r => `<tr>
  <td><small>${esc(r.created_at)}</small></td>
  <td>${stationCell(r)}</td>
  <td class="note">${esc(r.note)}</td>
  <td><small>${segmentsCell(r.segments_json)}</small></td>
  <td><small>${esc(r.mode)}<br>${esc(r.week)}</small></td>
</tr>`).join('')}
</table>` : '<p>Zatím nic.</p>'}
</body></html>`;

export async function onRequestGet({ request, env }) {
  if (!await authorized(request, env)) {
    return new Response('401', {
      status: 401,
      headers: { 'www-authenticate': 'Basic realm="metro-guesser admin", charset="UTF-8"' },
    });
  }
  const { results } = await env.DB.prepare(
    'SELECT * FROM reports ORDER BY created_at DESC LIMIT ?'
  ).bind(LIMIT).all();
  return new Response(page(results), {
    headers: {
      'content-type': 'text/html; charset=utf-8',
      'cache-control': 'no-store',
      'x-robots-tag': 'noindex',
    },
  });
}
