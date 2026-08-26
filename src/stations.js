// Stanice tak, jak s nimi počítá server i klient: základ z web/stations.json
// překrytý přepisy z tabulky station_axes (admin, /admin/station).
//
// Nikdo si stanice nesmí importovat napřímo — klient je tahá z /stations.json,
// které serviruje worker ze stejného zdroje. Jinak by hrál podle jiných os,
// než proti kterým se kolo validuje, a tipy by mu padaly na 400.
import base from '../web/stations.json';
import { mergeOverrides } from './station-axes.js';

const TTL_MS = 60000; // dotaz do D1 na každé kolo je zbytečný; přepis se rozjede do minuty

let cache = null;
let cachedAt = 0;

export async function loadStations(env, now = Date.now()) {
  if (cache && now - cachedAt < TTL_MS) return cache;
  try {
    const { results } = await env.DB.prepare('SELECT station_id, axes_json FROM station_axes').all();
    cache = mergeOverrides(base, results);
    cachedAt = now;
  } catch (e) {
    // rozbitá D1 nesmí shodit hru — bez přepisů se hraje dál podle stations.json
    console.error('station_axes read failed', String(e));
    return cache ?? base;
  }
  return cache;
}

// po zápisu v adminu, ať admin hned vidí, co uložil. Ostatní isolaty dojedou na TTL.
export function invalidateStations() { cache = null; }
