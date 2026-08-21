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
  // 0.2–0.8: i nejdelší osa (~180 m) se vejde do výřezu celá
  return chosen.map(station => ({ station, u: 0.2 + rng() * 0.6, v: 0.2 + rng() * 0.6 }));
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
    u: 0.2 + Math.random() * 0.6,
    v: 0.2 + Math.random() * 0.6,
  }));
}

// střed podle os, ne podle nodu stanice — v OSM node občas sedí u vestibulu (Křižíkova: 85 m vedle)
function axisCenter(station) {
  const pts = station.axes.flatMap(a => a.pts);
  return {
    lat: pts.reduce((s, p) => s + p[0], 0) / pts.length,
    lng: pts.reduce((s, p) => s + p[1], 0) / pts.length,
  };
}

// u = zlomek zleva, v = zlomek shora, kde ve výřezu leží stanice
export function roundViewport(round) {
  const { station, u, v } = round;
  const c = axisCenter(station);
  // posun od středu se osekne tak, aby osy zůstaly celé ve výřezu (Můstek: nástupiště 200 m od sebe)
  const pts = station.axes.flatMap(a => a.pts);
  const half = (get, m) => Math.max(...pts.map(p => Math.abs(get(p)) * m));
  const room = d => Math.max(0, 0.5 - d / VIEW_SIZE);
  const clamp = (t, d) => Math.min(Math.max(t, 0.5 - room(d)), 0.5 + room(d));
  return {
    lat: c.lat + ((clamp(v, half(p => p[0] - c.lat, M_PER_DEG_LAT)) - 0.5) * VIEW_SIZE) / M_PER_DEG_LAT,
    lng: c.lng + ((0.5 - clamp(u, half(p => p[1] - c.lng, mPerDegLng(c.lat)))) * VIEW_SIZE) / mPerDegLng(c.lat),
    size: VIEW_SIZE,
  };
}
