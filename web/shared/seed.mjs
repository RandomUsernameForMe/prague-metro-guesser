import { M_PER_DEG_LAT, mPerDegLng } from './geo.mjs';

export const VIEW_SIZE = 600; // metry, čtvercový výřez

export function isoWeek(date) {
  const d = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
  const day = d.getUTCDay() || 7;
  d.setUTCDate(d.getUTCDate() + 4 - day);
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  const week = Math.ceil(((d - yearStart) / 86400000 + 1) / 7);
  return `${d.getUTCFullYear()}-${String(week).padStart(2, '0')}`;
}

function strHash(str) { // xmur3
  let h = 1779033703 ^ str.length;
  for (let i = 0; i < str.length; i++) {
    h = Math.imul(h ^ str.charCodeAt(i), 3432918353);
    h = (h << 13) | (h >>> 19);
  }
  h = Math.imul(h ^ (h >>> 16), 2246822507);
  h = Math.imul(h ^ (h >>> 13), 3266489909);
  return (h ^= h >>> 16) >>> 0;
}

export function mulberry32(a) {
  return function () {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function weeklyChallenge(week, stations) {
  const rng = mulberry32(strHash(week));
  const transfers = stations.filter(s => s.isTransfer);
  const chosen = [transfers[Math.floor(rng() * transfers.length)]];
  const rest = stations.filter(s => s.id !== chosen[0].id);
  while (chosen.length < 10) chosen.push(rest.splice(Math.floor(rng() * rest.length), 1)[0]);
  for (let i = chosen.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [chosen[i], chosen[j]] = [chosen[j], chosen[i]];
  }
  return chosen.map(station => ({ station, u: 0.15 + rng() * 0.7, v: 0.15 + rng() * 0.7 }));
}

// náhodná kola mimo zadané stanice — rozehřátí nesmí prozradit týdenní výzvu
export function practiceRounds(stations, count, excludeIds = new Set()) {
  const pool = stations.filter(s => !excludeIds.has(s.id));
  const picked = [];
  while (picked.length < count && pool.length) {
    picked.push(pool.splice(Math.floor(Math.random() * pool.length), 1)[0]);
  }
  return picked.map(station => ({
    station,
    u: 0.15 + Math.random() * 0.7,
    v: 0.15 + Math.random() * 0.7,
  }));
}

// u = zlomek zleva, v = zlomek shora, kde ve výřezu leží stanice
export function roundViewport(round) {
  const { station, u, v } = round;
  return {
    lat: station.lat + ((v - 0.5) * VIEW_SIZE) / M_PER_DEG_LAT,
    lng: station.lng + ((0.5 - u) * VIEW_SIZE) / mPerDegLng(station.lat),
    size: VIEW_SIZE,
  };
}
