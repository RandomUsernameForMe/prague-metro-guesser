// Přepis os jedné stanice — odpověď na hlášení „stanice je zadaná špatně“.
// Osa se klikne do stejného leteckého snímku, jaký vidí hráč; vedle leží hlášení
// k té stanici i s tím, kudy osa podle hráčů vede.
//
// Uložený přepis žije v D1 (station_axes) a překrývá web/stations.json — projeví se
// do minuty a bez deploye. `npm run build:stations` ho nepřepíše, mění jen základ.
import { layout } from '../../web/tiles.mjs';
import { loadStations, invalidateStations } from '../stations.js';
import { parseAxes } from '../station-axes.js';
import { parseSegments } from './heatmap-geom.js';
import { page, html, esc } from './layout.js';

const SIZE = 640;      // hrana mapy v px
const SPAN = 600;      // metry — stejný výřez jako ve hře
const REPORTS = 50;
const NOTE_MAX = 200;
const LINE = { A: '#009f4d', B: '#ffd400', C: '#d6001c' };

const px = n => Math.round(n * 10) / 10;
const num = n => JSON.stringify(n);   // do <script> tečou jen čísla, žádné texty

const backLink = '<p><a href="/admin/reports">← hlášení</a></p>';

const notFound = () => html(page('Neznámá stanice', '/admin/reports',
  `${backLink}<p>Taková stanice není.</p>`));

// --- mapa ---------------------------------------------------------------

function mapHtml(station) {
  const vp = { lat: station.lat, lng: station.lng };
  const tiles = layout(vp, SIZE).map(t =>
    `<img src="${esc(t.url)}" alt="" style="position:absolute;left:${px(t.left)}px;top:${px(t.top)}px;` +
    `width:${px(t.w)}px;height:${px(t.h)}px">`).join('');

  // overflow: krajní dlaždice přesahují hranu výřezu a bez ořezu by přelezly stránku
  return `<div style="position:relative;width:${SIZE}px;height:${SIZE}px;max-width:100%;
    overflow:hidden;background:#000;touch-action:none">
  ${tiles}
  <svg id="edit" viewBox="0 0 ${SIZE} ${SIZE}" style="position:absolute;inset:0;width:100%;height:100%;cursor:crosshair"></svg>
</div>
<p><small>Klikni dvakrát — první klik začátek osy, druhý konec. Přepínač nad mapou říká,
která linka se kreslí. Šedě čárkovaně to, kudy osu zakreslili hráči v hlášeních.
Výřez 600 × 600 m vystředěný na stanici. Ortofoto © ČÚZK.</small></p>`;
}

// --- hlášení ------------------------------------------------------------

const fixText = fix => fix.map(seg =>
  seg.map(([lat, lng]) => `${lat.toFixed(5)},${lng.toFixed(5)}`).join(' → ')).join('<br>');

function reportsTable(station, reports) {
  if (!reports.length) return '<p><i>K téhle stanici žádné hlášení není.</i></p>';
  return `<table>
<tr><th>kdy</th><th>komentář</th><th>kudy osa vede podle hráče</th><th></th></tr>
${reports.map((r, i) => `<tr>
  <td><small>${esc(r.created_at)}</small></td>
  <td class="note">${r.note ? esc(r.note) : '<i>—</i>'}</td>
  <td><small>${r.fix.length ? fixText(r.fix) : '<i>osu nezakreslil</i>'}</small></td>
  <td>${r.fix.length
    ? `<button type="button" data-fix="${i}">vzít tuhle osu</button>`
    : ''}</td>
</tr>`).join('')}
</table>
<p><small>„Vzít tuhle osu“ jen předvyplní mapu — uložíš ji až tlačítkem pod mapou.
Hlášení se nikam neodklikávají, po opravě osy je poznáš podle data.</small></p>`;
}

// --- stránka ------------------------------------------------------------

function body(station, { override, reports, error }) {
  const stav = override
    ? `<p>Osy jsou <b>přepsané z adminu</b> (${esc(override.updated_at)}${
        override.note ? `, ${esc(override.note)}` : ''}).</p>`
    : '<p>Osy jsou původní z OSM.</p>';

  const lineButtons = station.lines.map((l, i) =>
    `<button type="button" class="pick" data-line="${i}"${i ? '' : ' aria-current="true"'}
       style="border-color:${LINE[l] ?? '#fff'}">osa ${esc(l)}</button>`).join('');

  return `${backLink}
${stav}
${error ? `<p class="err">Neuloženo: ${esc(error)}</p>` : ''}
<form method="post" action="/admin/station">
  <input type="hidden" name="id" value="${esc(station.id)}">
  <input type="hidden" name="axes" id="axes-json">
  <p>${lineButtons} <button type="button" id="undo">vrátit poslední změnu</button></p>
  ${mapHtml(station)}
  <p><code id="axes-text"></code></p>
  <p>
    <input name="note" maxlength="${NOTE_MAX}" size="48" placeholder="proč se mění (podle hlášení z…)">
    <button name="action" value="save">Uložit osu</button>
    ${override ? '<button name="action" value="reset">Vrátit původní z OSM</button>' : ''}
  </p>
</form>
<h2>Hlášení k téhle stanici</h2>
${reportsTable(station, reports)}
${script(station, reports)}`;
}

// Inline modul: admin stránky si CSP nenastavují (ta ve web/_headers platí jen pro
// statické soubory), takže inline <script> projde. Přepočet px↔lat/lng se netahá znovu —
// bere se z /tiles.mjs, ze kterého kreslí i hra; jinak by se obojí časem rozešlo.
// Do skriptu tečou jen čísla a názvy linek z stations.json, nic textového z databáze.
function script(station, reports) {
  // pořadí os drží pořadí linek — skript i hlášení berou i-tou úsečku k i-té lince
  const axes = station.lines.map(l => station.axes.find(a => a.line === l)?.pts ?? []);
  const data = {
    size: SIZE,
    vp: { lat: station.lat, lng: station.lng, size: SPAN },
    lines: station.lines,
    colors: station.lines.map(l => LINE[l] ?? '#fff'),
    axes,
    fixes: reports.map(r => r.fix),
  };
  return `<script type="module">
import { pxToLatLng, latLngToPx } from '/tiles.mjs';

const D = ${num(data)};
const svg = document.getElementById('edit');
const out = document.getElementById('axes-text');
const field = document.getElementById('axes-json');
let axes = D.axes.map(pts => pts.map(p => p.slice()));
let undoStack = [];
let anchor = null;

const toPx = ([lat, lng]) => latLngToPx(lat, lng, D.vp, D.size);
const toLatLng = (x, y) => pxToLatLng(x, y, D.vp, D.size);

let sel = 0;
const svgNs = 'http://www.w3.org/2000/svg';
const el = (name, attrs) => {
  const n = document.createElementNS(svgNs, name);
  for (const k in attrs) n.setAttribute(k, attrs[k]);
  return n;
};

function draw() {
  const kids = [];
  for (const fix of D.fixes) {
    for (const seg of fix) {
      const [a, b] = seg.map(toPx);
      kids.push(el('line', { x1: a[0], y1: a[1], x2: b[0], y2: b[1], stroke: '#fff',
        'stroke-width': 3, 'stroke-dasharray': '8 6', 'stroke-opacity': 0.55, 'stroke-linecap': 'round' }));
    }
  }
  axes.forEach((pts, i) => {
    const [a, b] = pts.map(toPx);
    const c = D.colors[i];
    kids.push(el('line', { x1: a[0], y1: a[1], x2: b[0], y2: b[1], stroke: c,
      'stroke-width': 5, 'stroke-linecap': 'round', 'stroke-opacity': i === sel ? 1 : 0.6 }));
    for (const [x, y] of [a, b]) kids.push(el('circle', { cx: x, cy: y, r: 5, fill: c }));
  });
  if (anchor) kids.push(el('circle', { cx: anchor[0], cy: anchor[1], r: 6, fill: 'none',
    stroke: D.colors[sel], 'stroke-width': 2 }));
  svg.replaceChildren(...kids);
  field.value = JSON.stringify(axes.map((pts, i) => ({ line: D.lines[i], pts })));
  out.textContent = axes.map((pts, i) => D.lines[i] + ': '
    + pts.map(p => p[0].toFixed(5) + ', ' + p[1].toFixed(5)).join('  →  ')).join('   |   ');
}

function set(i, pts) {
  undoStack.push(axes.map(a => a.map(p => p.slice())));
  axes[i] = pts;
  draw();
}

svg.addEventListener('click', e => {
  const r = svg.getBoundingClientRect();
  const x = (e.clientX - r.left) / r.width * D.size;
  const y = (e.clientY - r.top) / r.height * D.size;
  if (!anchor) { anchor = [x, y]; draw(); return; }
  set(sel, [toLatLng(anchor[0], anchor[1]), toLatLng(x, y)]);
  anchor = null;
  draw();
});

for (const b of document.querySelectorAll('.pick')) {
  b.onclick = () => {
    sel = Number(b.dataset.line);
    anchor = null;
    for (const o of document.querySelectorAll('.pick')) o.removeAttribute('aria-current');
    b.setAttribute('aria-current', 'true');
    draw();
  };
}

// osa z hlášení: i-tá úsečka patří i-té lince stanice, stejně jako ji hráč kreslil
for (const b of document.querySelectorAll('[data-fix]')) {
  b.onclick = () => {
    const fix = D.fixes[Number(b.dataset.fix)];
    undoStack.push(axes.map(a => a.map(p => p.slice())));
    fix.forEach((seg, i) => { if (i < axes.length) axes[i] = seg.map(p => p.slice()); });
    anchor = null;
    draw();
  };
}

document.getElementById('undo').onclick = () => {
  if (undoStack.length) axes = undoStack.pop();
  anchor = null;
  draw();
};

draw();
</script>`;
}

// --- routy --------------------------------------------------------------

// po zápisu redirect, ať reload stránky neuloží osu podruhé
const seeOther = id => new Response(null, {
  status: 303,
  headers: { location: `/admin/station?id=${encodeURIComponent(id)}`, 'cache-control': 'no-store' },
});

async function render(env, station, error) {
  const [ov, reps] = await env.DB.batch([
    env.DB.prepare('SELECT axes_json, note, updated_at FROM station_axes WHERE station_id = ?').bind(station.id),
    env.DB.prepare('SELECT created_at, note, fix_json FROM reports WHERE station_id = ? ORDER BY created_at DESC LIMIT ?')
      .bind(station.id, REPORTS),
  ]);
  // fix z databáze rovnou do SVG a do skriptu — prochází stejnou kontrolou jako tipy v heatmapě
  const reports = reps.results.map(r => ({ ...r, fix: parseSegments(r.fix_json) }));
  const title = `${station.name} (${station.lines.join('+')})`;
  return html(page(title, '/admin/reports', body(station, { override: ov.results[0], reports, error })));
}

export async function onRequestGet({ request, env }) {
  const id = new URL(request.url).searchParams.get('id');
  const station = (await loadStations(env)).find(s => s.id === id);
  return station ? render(env, station) : notFound();
}

export async function onRequestPost({ request, env }) {
  const form = await request.formData();
  const id = String(form.get('id') ?? '');
  const station = (await loadStations(env)).find(s => s.id === id);
  if (!station) return notFound();

  if (form.get('action') === 'reset') {
    await env.DB.prepare('DELETE FROM station_axes WHERE station_id = ?').bind(id).run();
    invalidateStations();
    return seeOther(id);
  }

  const { axes, error } = parseAxes(String(form.get('axes') ?? ''), station);
  if (error) return render(env, station, error);

  const note = String(form.get('note') ?? '').trim().slice(0, NOTE_MAX);
  await env.DB.prepare(
    `INSERT INTO station_axes (station_id, axes_json, note) VALUES (?, ?, ?)
     ON CONFLICT(station_id) DO UPDATE SET
       axes_json = excluded.axes_json, note = excluded.note, updated_at = datetime('now')`
  ).bind(id, JSON.stringify(axes), note || null).run();
  invalidateStations();
  return seeOther(id);
}
