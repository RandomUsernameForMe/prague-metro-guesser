// Přepis os stanice: kontrola vstupu z adminu a překrytí základu z stations.json.
// Bez importu stations.json schválně — takhle je modul spustitelný v testech pod Nodem.
//
// Osy tečou do skórování i do výřezu kola, takže vstup se ověřuje stejně přísně
// jako tipy hráčů: dva konečné body na každou linku stanice a nic daleko od ní.
import { toLocalMeters } from '../web/shared/geo.mjs';

const MAX_M = 1000; // osa dál než kilometr od stanice je překlep, ne oprava

const point = p => Array.isArray(p) && p.length === 2 && p.every(Number.isFinite);

// text: JSON [{line, pts: [[lat,lng],[lat,lng]]}, ...]. Vrací {axes} nebo {error} česky —
// text jde rovnou zpátky do admin stránky nad formulář.
export function parseAxes(text, station) {
  let v;
  try { v = JSON.parse(text); } catch { return { error: 'není to platný JSON' }; }
  if (!Array.isArray(v) || v.length !== station.lines.length) {
    return { error: `os musí být ${station.lines.length} — jedna na každou linku (${station.lines.join(', ')})` };
  }
  const seen = [];
  const axes = [];
  for (const a of v) {
    if (!a || typeof a !== 'object') return { error: 'osa musí být objekt {"line": "A", "pts": [...]}' };
    if (!station.lines.includes(a.line)) return { error: `linka ${JSON.stringify(a.line)} k téhle stanici nepatří` };
    if (seen.includes(a.line)) return { error: `linka ${a.line} je tam dvakrát` };
    if (!Array.isArray(a.pts) || a.pts.length !== 2 || !a.pts.every(point)) {
      return { error: `linka ${a.line}: osa jsou právě dva body [lat, lng]` };
    }
    for (const p of a.pts) {
      const [x, y] = toLocalMeters(p[0], p[1], station);
      if (Math.hypot(x, y) > MAX_M) return { error: `linka ${a.line}: bod leží víc než ${MAX_M} m od stanice` };
    }
    seen.push(a.line);
    axes.push({ line: a.line, pts: a.pts.map(([lat, lng]) => [lat, lng]) });
  }
  // pořadí os drží pořadí linek: scoring i hlášení berou i-tou úsečku k i-té lince
  axes.sort((a, b) => station.lines.indexOf(a.line) - station.lines.indexOf(b.line));
  return { axes };
}

// base: stations.json; rows: řádky station_axes. Základ se nemění, vrací se nové pole.
// Řádek, co neprojde kontrolou (ruční zásah do DB, starý tvar), se přeskočí — hraje se
// dál podle stations.json, protože rozbité osy jsou horší než neaplikovaná oprava.
export function mergeOverrides(base, rows) {
  const byId = new Map((rows ?? []).map(r => [r.station_id, r.axes_json]));
  if (!byId.size) return base;
  return base.map(s => {
    if (!byId.has(s.id)) return s;
    const { axes } = parseAxes(byId.get(s.id), s);
    return axes ? { ...s, axes } : s;
  });
}
