// Hardcore: bez jména stanice, mapa pootočená, tři životy.
// Sdílený modul — server si z něj zrekonstruuje run, který klient odehrál.

export const LIVES_MAX = 3;
export const LOSE_M = 100;   // horší kolo bere život
export const GAIN_M = 15;    // lepší kolo život vrací

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
