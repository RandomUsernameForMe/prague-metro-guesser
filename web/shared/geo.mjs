// ponytail: equirect aproximace kolem počátku — na výřezu 600 m chyba < 1 m
export const M_PER_DEG_LAT = 110574;
export function mPerDegLng(lat) { return 111320 * Math.cos(lat * Math.PI / 180); }

export function toLocalMeters(lat, lng, origin) {
  return [(lng - origin.lng) * mPerDegLng(origin.lat), (lat - origin.lat) * M_PER_DEG_LAT];
}

export function lngToTileX(lng, z) { return ((lng + 180) / 360) * 2 ** z; }
export function latToTileY(lat, z) {
  const r = (lat * Math.PI) / 180;
  return ((1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2) * 2 ** z;
}
