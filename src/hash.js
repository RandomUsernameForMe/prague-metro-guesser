// Jedna sůl pro celý worker: `npx wrangler secret put SALT` (lokálně řádek v .dev.vars).
// Bez ní všechno funguje dál, jen bez ochrany, kterou sůl přidává — proto ta prefixovaná
// doména v každém volání, ať se jeden secret nedá použít napříč účely.

export async function sha256(s) {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s));
  return [...new Uint8Array(buf)].map(b => b.toString(16).padStart(2, '0')).join('');
}

// IPv4 má jen 4 miliardy hodnot — holý otisk IP se hrubou silou obrátí za pár vteřin,
// takže pseudonymizace stojí a padá na soli.
export const ipHash = (ip, env) => sha256(`ip|${env.SALT ?? ''}|${ip ?? ''}`);

// Kola duelu se nesmí dát dopočítat z kódu zápasu — ten je veřejný, je v pozvánkovém
// odkazu, a seed.mjs i stations.json si stáhne kdokoli.
export const duelSeed = (code, env) => sha256(`duel|${env.SALT ?? ''}|${code}`);
