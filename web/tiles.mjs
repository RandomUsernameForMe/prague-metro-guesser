import { lngToTileX, latToTileY, mPerDegLng, M_PER_DEG_LAT } from './shared/geo.mjs';
import { VIEW_SIZE } from './shared/seed.mjs';

const Z = 18, TILE = 256;
const SOURCES = [
  (z, x, y) => `https://ags.cuzk.gov.cz/arcgis1/rest/services/ORTOFOTO_WM/MapServer/tile/${z}/${y}/${x}`,
  (z, x, y) => `https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/${z}/${y}/${x}`,
];
let srcIdx = 0;

// dlaždice pokrývající výřez + jejich pozice ve stage
// (export kvůli scripts/build-brand.mjs, který skládá stejný výřez do OG obrázku)
export function layout(vp, sizePx) {
  const span = vp.size ?? VIEW_SIZE;   // hardcore kreslí na větší plátno, ať rotace nekouká do rohů
  const halfLng = (span / 2) / mPerDegLng(vp.lat);
  const halfLat = (span / 2) / M_PER_DEG_LAT;
  const xW = lngToTileX(vp.lng - halfLng, Z) * TILE;
  const xE = lngToTileX(vp.lng + halfLng, Z) * TILE;
  const yN = latToTileY(vp.lat + halfLat, Z) * TILE;
  const yS = latToTileY(vp.lat - halfLat, Z) * TILE;
  const scaleX = sizePx / (xE - xW), scaleY = sizePx / (yS - yN);
  const out = [];
  for (let tx = Math.floor(xW / TILE); tx * TILE < xE; tx++) {
    for (let ty = Math.floor(yN / TILE); ty * TILE < yS; ty++) {
      out.push({
        url: SOURCES[srcIdx](Z, tx, ty),
        left: (tx * TILE - xW) * scaleX, top: (ty * TILE - yN) * scaleY,
        w: TILE * scaleX + 0.5, h: TILE * scaleY + 0.5,
      });
    }
  }
  return out;
}

// vp: {lat,lng} střed výřezu; sizePx: px hrana čtvercového stage
export function renderTiles(container, vp, sizePx) {
  const frag = document.createDocumentFragment();
  for (const t of layout(vp, sizePx)) {
    const img = new Image();
    img.src = t.url;
    img.onerror = () => {
      if (srcIdx === 0) { srcIdx = 1; renderTiles(container, vp, sizePx); }
    };
    img.draggable = false;
    img.style.cssText = `position:absolute;left:${t.left}px;top:${t.top}px;width:${t.w}px;height:${t.h}px;`;
    frag.appendChild(img);
  }
  // staré dlaždice drž na místě, dokud nejsou nové v DOM — žádné černé bliknutí
  container.replaceChildren(frag);
}

// natáhne dlaždice příštího kola do cache prohlížeče
const warm = [];
export function prefetchTiles(vp, sizePx) {
  for (const t of layout(vp, sizePx)) {
    const img = new Image();
    img.src = t.url;
    warm.push(img);
  }
  if (warm.length > 200) warm.splice(0, warm.length - 200);
}

// ponytail: px↔latlng přes equirect, dlaždice přes mercator — rozdíl na 600 m < 1 px
export function pxToLatLng(px, py, vp, sizePx) {
  const span = vp.size ?? VIEW_SIZE;
  const east = (px / sizePx - 0.5) * span;
  const north = (0.5 - py / sizePx) * span;
  return [vp.lat + north / M_PER_DEG_LAT, vp.lng + east / mPerDegLng(vp.lat)];
}

export function latLngToPx(lat, lng, vp, sizePx) {
  const span = vp.size ?? VIEW_SIZE;
  const east = (lng - vp.lng) * mPerDegLng(vp.lat);
  const north = (lat - vp.lat) * M_PER_DEG_LAT;
  return [((east / span) + 0.5) * sizePx, (0.5 - north / span) * sizePx];
}
