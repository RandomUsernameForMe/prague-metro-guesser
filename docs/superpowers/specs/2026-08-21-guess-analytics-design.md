# Sběr dat o guessech — návrh

Datum: 2026-08-21

## Cíl

Zaznamenat každé odehrané kolo ve všech režimech, aby z toho šly dělat exporty
a infografiky: které stanice jsou nejtěžší, jak rychle lidé kreslí, kam se
systematicky sekají.

Dnes se ukládá jen finální týdenní skóre (tabulka `scores`) a jen když hráč
vyplní přezdívku. Warmup a casual guessy nikdy neopustí prohlížeč.

## Rozsah

- Logují se **všechny režimy**: `weekly`, `warmup`, `casual`.
- Jeden řádek = jedno kolo jednoho hráče.
- Propadlé kolo (vypršel čas, chybí úsečka) se loguje také.
- Tabulka `scores` a její endpointy zůstávají beze změny.

## Architektura

Klient po každém kole odešle jeden fire-and-forget `POST /api/guess`. Server
skóre nepřebírá — přepočítá si ho sám z odeslaných úseček. Data se čtou dvěma
endpointy: plochý CSV export (chráněný tokenem) a veřejná agregace po stanicích.

Zvolená varianta „POST po každém kole" proti alternativám:

- *Buffer v localStorage a flush po dávkách* — méně requestů, ale přibývá stavový
  kód a při zavření tabu se rozehraná data ztratí.
- *Rozšířit `/api/score`* — pokryje jen weekly, warmup a casual by zůstaly bez dat.

## Datový model

Nová tabulka v `schema.sql`:

```sql
CREATE TABLE IF NOT EXISTS guesses (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  session TEXT NOT NULL,        -- náhodné UUID z localStorage
  mode TEXT NOT NULL,           -- weekly | warmup | casual
  week TEXT NOT NULL,
  station_id TEXT NOT NULL,
  round_idx INTEGER NOT NULL,
  u REAL NOT NULL,              -- kde ve výřezu stanice ležela (zlomek zleva)
  v REAL NOT NULL,              -- (zlomek shora)
  segments_json TEXT NOT NULL,  -- co hráč nakreslil: [[[lat,lng],[lat,lng]], ...]
  dist_m REAL,                  -- NULL u propadlého kola
  score INTEGER NOT NULL,
  per_line_json TEXT,           -- [{"line":"A","d":42.1}, ...]; NULL u propadlého kola
  ms INTEGER NOT NULL,          -- jak dlouho hráč kreslil
  timed_out INTEGER NOT NULL,   -- 0/1
  forfeited INTEGER NOT NULL,   -- 0/1 — nestihl všechny úsečky
  ip_hash TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_guesses_station ON guesses(station_id);
CREATE INDEX IF NOT EXISTS idx_guesses_created ON guesses(created_at);
```

Propadlé kolo: `forfeited = 1`, `score = 0`, `dist_m` a `per_line_json` `NULL`,
`segments_json` obsahuje to, co hráč stihl nakreslit (klidně prázdné pole).

## Komponenty

### `web/shared/validate.mjs` — extrakce `validateRound`

Ze `validateSubmission` se vytáhne kontrola jednoho kola:

```js
validateRound(segments, round, { allowPartial = false }) -> { ok, error? }
```

Ověří, že `segments` je pole dvoubodových úseček s konečnými čísly a že všechny
body leží uvnitř výřezu kola (`roundViewport` + `MARGIN`). Bez `allowPartial`
navíc vyžaduje přesně `station.lines.length` úseček; s ním povolí 0 až tolik
úseček (propadlé kolo).

`validateSubmission` volá `validateRound` pro každé kolo. Chování se nemění,
stávající testy musí projít beze změny.

### `functions/api/guess.js` — `POST /api/guess`

Tělo:

```json
{ "session": "uuid", "mode": "casual", "stationId": "...", "roundIdx": 0,
  "u": 0.42, "v": 0.61, "segments": [[[lat,lng],[lat,lng]]],
  "ms": 8123, "timedOut": false, "forfeited": false }
```

Postup:

1. Ověřit tvar: `session` odpovídá UUID, `mode` je z výčtu, `stationId` existuje
   ve `stations.json`, `roundIdx` je celé číslo 0–999, `u`/`v` v ⟨0,1⟩,
   `ms` celé číslo 0–600000, `timedOut`/`forfeited` boolean.
2. Ověřit úsečky přes `validateRound(segments, {station, u, v}, {allowPartial: forfeited})`.
3. Rate limit: `SELECT COUNT(*) FROM guesses WHERE ip_hash = ? AND created_at > datetime('now','-1 hour')`;
   při ≥ 300 vrátit 429. Stejný `sha256(cf-connecting-ip)` jako `/api/score`.
4. Není-li kolo propadlé, spočítat `scoreRound(segments, station)` na serveru →
   `dist_m`, `score`, `per_line_json`. Číslo od klienta se nikdy nepoužije.
5. `INSERT` a odpověď `{"ok": true}` — nic o stanici ani skóre se nevrací, aby
   endpoint nešel zneužít jako nápověda.

Špatný vstup → 400 s krátkým kódem chyby, stejný styl jako `/api/score`.

### `functions/api/export.js` — `GET /api/export`

Parametry: `token` (povinný), `after` (id kurzor, default 0), `limit`
(default 50000, max 50000).

Vrátí `text/csv` se sloupci:

```
id, created_at, session, mode, week, station_id, station_name, station_lines,
round_idx, u, v, dist_m, score, ms, timed_out, forfeited, per_line_json, segments_json
```

`station_name` a `station_lines` se dojoinují ze `stations.json` v workeru —
v DB se neduplikují. Stránkuje se `WHERE id > ? ORDER BY id LIMIT ?`; klient
posílá poslední viděné `id` jako `after`.

Autorizace: `token` se porovnává s `env.EXPORT_TOKEN` (Cloudflare secret).
Chybí-li secret v prostředí, endpoint vrací 503 — nikdy se neotevře veřejně.
Porovnání délkově konstantní není potřeba řešit, token je náhodný a endpoint
je za rate limitem Cloudflare.

CSV se skládá vlastní funkcí `csvRow`: buňka se obalí uvozovkami a vnitřní
uvozovky se zdvojí vždy, když obsahuje `,`, `"`, `\n` nebo `\r`. `null` je
prázdná buňka. Tohle je jediná netriviální logika v souboru → má vlastní test.

### `functions/api/stats.js` — `GET /api/stats`

Veřejné, bez tokenu. Volitelný parametr `mode` (filtr na jeden režim).

```sql
SELECT station_id, COUNT(*) AS n, AVG(score) AS avg_score, AVG(dist_m) AS avg_dist,
       SUM(forfeited) AS forfeits, AVG(ms) AS avg_ms
FROM guesses [WHERE mode = ?] GROUP BY station_id
```

Odpověď: `{ "stations": [{ id, name, lines, n, avgScore, avgDist, forfeits, avgMs }] }`,
seřazeno podle `avgScore` vzestupně (nejtěžší první). Jméno a linky ze
`stations.json`.

Únik týdenní výzvy tu nehrozí: `weeklyChallenge` je deterministická z čísla
týdne a `stations.json` je veřejný soubor, takže výběr stanic si spočítá kdokoli
už dnes.

### `web/app.mjs` — klient

- `session`: `localStorage['pmg-session']`, při prvním spuštění `crypto.randomUUID()`.
- `startRound()` si uloží `roundStartedAt = performance.now()`.
- `logGuess(payload)`: `fetch('/api/guess', …).catch(() => {})` — výpadek sítě
  nebo 429 nesmí nikdy ovlivnit průběh hry, žádná chybová hláška hráči.
- Volá se z `finishRound()` (s vypočteným `dist`/`score`, které server stejně
  přepočítá) i z `forfeitRound()` (s tím, co bylo rozkresleno).

## Testy

`node --test 'tests/*.test.mjs'`, stejně jako dnes.

- `tests/csv.test.mjs` — `csvRow` obaluje buňky s čárkou, uvozovkou i novým
  řádkem, zdvojuje uvozovky, `null` dává prázdnou buňku.
- `tests/validate.test.mjs` — doplnit: `validateRound` přijme kolo mimo týdenní
  výzvu, odmítne bod mimo výřez, s `allowPartial` přijme méně úseček a bez něj
  ne. Stávající testy `validateSubmission` zůstávají a musí projít.

## Soukromí

Ukládá se pseudonymní náhodné UUID a SHA-256 hash IP adresy — žádné jméno,
e-mail ani přesná IP. `session` si hráč smaže vymazáním localStorage. CSV export
je za tokenem, veřejná je jen agregace bez identifikátorů.

## Co záměrně není součástí

- Stránka se statistikami ve hře — `/api/stats` je pro ni připravené, frontend
  přijde, až bude o co stát.
- Odvozené metriky (chyba úhlu, kolmá odchylka, bias směru) — počítají se
  z `segments_json` až při analýze, do DB nepatří.
- Migrace historických dat ze `scores` do `guesses` — stará data nemají čas ani
  výřez, dopočítat by je stejně nešlo.
