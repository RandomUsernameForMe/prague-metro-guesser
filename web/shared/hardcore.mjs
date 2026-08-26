// Hardcore: bez jména stanice, mapa pootočená, tři životy.
// Sdílený modul — server si z něj zrekonstruuje run, který klient odehrál.
import { mulberry32, roundViewport, VIEW_SIZE } from './seed.mjs';

export const LIVES_MAX = 3;
export const LOSE_M = 100;   // horší kolo bere život
export const GAIN_M = 15;    // lepší kolo život vrací
export const SPAN = Math.SQRT2;  // plátno vs. výřez, ať pootočený čtverec nekouká do rohů
export const MAX_ROUNDS = 500;   // strop na velikost payloadu při odeslání runu

const GOLDEN = 0x9e3779b1;

// i-té kolo runu. Každé kolo se seeduje zvlášť, aby server uměl odvodit
// libovolné kolo bez iterace přes ta předchozí.
export function hardcoreRound(seed, i, stations) {
  const rng = mulberry32((seed + Math.imul(i + 1, GOLDEN)) | 0);
  rng(); // první hodnota po skoku v seedu koreluje se sousedy — zahoď ji
  const station = stations[Math.floor(rng() * stations.length)];
  return { station, u: 0.2 + rng() * 0.6, v: 0.2 + rng() * 0.6, rot: rng() * 2 * Math.PI };
}

// viewport kola: střed jako jinde, ale větší plátno a úhel navíc
export function hardcoreViewport(round) {
  return { ...roundViewport(round), size: VIEW_SIZE * SPAN, rot: round.rot };
}

// d = průměrná odchylka kola v metrech; null = propadlé kolo (nestihl všechny úsečky)
export function nextLives(lives, d) {
  if (d === null || d > LOSE_M) return lives - 1;
  if (d < GAIN_M) return Math.min(LIVES_MAX, lives + 1);
  return lives;
}

// kolik kol hráč odehrál, než mu došly životy; fatální kolo se počítá
export function runLength(distances) {
  let lives = LIVES_MAX;
  for (let i = 0; i < distances.length; i++) {
    lives = nextLives(lives, distances[i]);
    if (lives <= 0) return i + 1;
  }
  return distances.length;
}
