import { lngToTileX, latToTileY, mPerDegLng, M_PER_DEG_LAT } from './shared/geo.mjs';
import { VIEW_SIZE } from './shared/seed.mjs';

const Z = 18, TILE = 256;
const SOURCES = [
  (z, x, y) => `https://ags.cuzk.gov.cz/arcgis1/rest/services/ORTOFOTO_WM/MapServer/tile/${z}/${y}/${x}`,
  (z, x, y) => `https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/${z}/${y}/${x}`,
];
let srcIdx = 0;

// vp: {lat,lng} střed výřezu; sizePx: px hrana čtvercového stage
export function renderTiles(container, vp, sizePx) {
  const halfLng = (VIEW_SIZE / 2) / mPerDegLng(vp.lat);
  const halfLat = (VIEW_SIZE / 2) / M_PER_DEG_LAT;
  const xW = lngToTileX(vp.lng - halfLng, Z) * TILE;
  const xE = lngToTileX(vp.lng + halfLng, Z) * TILE;
  const yN = latToTileY(vp.lat + halfLat, Z) * TILE;
  const yS = latToTileY(vp.lat - halfLat, Z) * TILE;
  const scaleX = sizePx / (xE - xW), scaleY = sizePx / (yS - yN);
  container.textContent = '';
  for (let tx = Math.floor(xW / TILE); tx * TILE < xE; tx++) {
    for (let ty = Math.floor(yN / TILE); ty * TILE < yS; ty++) {
      const img = new Image();
      img.src = SOURCES[srcIdx](Z, tx, ty);
      img.onerror = () => {
        if (srcIdx === 0) { srcIdx = 1; renderTiles(container, vp, sizePx); }
      };
      img.draggable = false;
      img.style.cssText = `position:absolute;left:${(tx * TILE - xW) * scaleX}px;top:${(ty * TILE - yN) * scaleY}px;width:${TILE * scaleX + 0.5}px;height:${TILE * scaleY + 0.5}px;`;
      container.appendChild(img);
    }
  }
}

// ponytail: px↔latlng přes equirect, dlaždice přes mercator — rozdíl na 600 m < 1 px
export function pxToLatLng(px, py, vp, sizePx) {
  const east = (px / sizePx - 0.5) * VIEW_SIZE;
  const north = (0.5 - py / sizePx) * VIEW_SIZE;
  return [vp.lat + north / M_PER_DEG_LAT, vp.lng + east / mPerDegLng(vp.lat)];
}

export function latLngToPx(lat, lng, vp, sizePx) {
  const east = (lng - vp.lng) * mPerDegLng(vp.lat);
  const north = (lat - vp.lat) * M_PER_DEG_LAT;
  return [((east / VIEW_SIZE) + 0.5) * sizePx, (0.5 - north / VIEW_SIZE) * sizePx];
}
