// Přepočet uložených tipů do px jednoho společného výřezu. Každý hráč viděl
// stanici jinak posunutou (sloupce u, v), ale úsečky se ukládají v lat/lng —
// jdou tedy složit do jednoho rámu vystředěného na stanici bez ohledu na to,
// jaký výřez měl kdo na obrazovce.
//
// Čísla z databáze tečou rovnou do atributů SVG, takže se každé ověřuje jako
// konečné číslo. Zápis přes /api/guess sice prochází validateRound, ale admin
// se na to nespoléhá — jeden pokažený řádek nesmí být cesta do stránky.
import { latLngToPx } from '../../web/tiles.mjs';

const pair = p => Array.isArray(p) && p.length === 2
  && Number.isFinite(p[0]) && Number.isFinite(p[1]);

// jeden řádek guesses → pole úseček [[lat,lng],[lat,lng]]; cokoli divného zahodí
export function parseSegments(json) {
  let segs;
  try { segs = JSON.parse(json); } catch { return []; }
  if (!Array.isArray(segs)) return [];
  return segs.filter(s => Array.isArray(s) && s.length === 2 && pair(s[0]) && pair(s[1]));
}

// ponytail: úsečka je „v rámu", když v něm leží aspoň jeden konec. Tip, který rám
// protíná, ale oba konce má venku, tak vypadne — při 600m rámu je to zanedbatelné.
const inFrame = ([x, y], size) => x >= 0 && x <= size && y >= 0 && y <= size;

// rows: řádky s sloupcem segments_json. Vrací úsečky v px a počet zahozených.
export function heatmapLines(rows, station, sizePx) {
  const vp = { lat: station.lat, lng: station.lng };
  const lines = [];
  let outside = 0;
  for (const row of rows) {
    for (const [from, to] of parseSegments(row.segments_json)) {
      const a = latLngToPx(from[0], from[1], vp, sizePx);
      const b = latLngToPx(to[0], to[1], vp, sizePx);
      if (!inFrame(a, sizePx) && !inFrame(b, sizePx)) { outside++; continue; }
      lines.push([a, b]);
    }
  }
  return { lines, outside };
}

// osy stanice ve stejném rámu — předloha, proti které se tipy čtou
export function axisLines(station, sizePx) {
  const vp = { lat: station.lat, lng: station.lng };
  return (station.axes ?? []).map(axis => ({
    line: axis.line,
    pts: axis.pts.map(([lat, lng]) => latLngToPx(lat, lng, vp, sizePx)),
  }));
}
