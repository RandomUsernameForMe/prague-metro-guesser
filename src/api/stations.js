import { loadStations } from '../stations.js';

// /stations.json vypadá zvenčí jako statický soubor, ale musí projít workerem —
// jinak by klient dostal verzi bez přepisů z adminu (viz run_worker_first v wrangler.toml).
export async function onRequestGet({ env }) {
  return new Response(JSON.stringify(await loadStations(env)), {
    headers: {
      'content-type': 'application/json; charset=utf-8',
      // krátká cache: po opravě osy v adminu se svět srovná do minuty
      'cache-control': 'public, max-age=60',
    },
  });
}
