# Hardcore mode

Čtvrtý režim vedle standardu, duelu a casualu. Nedostaneš jméno stanice, mapa je
pootočená o náhodný úhel a máš tři životy. Hraje se, dokud ti nedojdou.

Rozhodnutí padla v brainstormingu 2026-08-26; tenhle dokument je zadání pro
implementační plán.

## 1. Herní smyčka

Nekonečná řada náhodných stanic, přestupní taky. Po každém kole se z
`scoreRound` vezme `d` — průměrná odchylka od skutečné osy (u přestupu už
průměr přes obě linky).

| `d` | důsledek |
|---|---|
| < 15 m | +1 život, nejvýš na 3 |
| 15–100 m | nic |
| > 100 m | −1 život |
| vypršel čas nebo chybí úsečka | −1 život |

Start na třech životech, strop tři — zásoba se nedá nahromadit, takže tlak nikdy
nepoleví. Životy na nule = konec runu.

**Výsledek runu = počet odehraných kol včetně toho posledního, smrtícího.** Kdo
umřel v 23. kole, má 23.

Odpočet běží stejně jako jinde: 20 s na jednu úsečku, 30 s na přestup. Bodové
skóre se v hardcore nikde neukazuje — jediné číslo, na kterém záleží, je počet
kol. V panelu proto na místě skóre běží počítadlo kol s popiskem `kola`. (Do
`/api/guess` se kola logují dál i s body; jen se nezobrazují.)

**Výsledková karta** ukáže jméno stanice — po odpovědi už není co tajit —,
odchylku v metrech jako velké číslo místo bodů a pod tím `+1 život` / `-1 život`
/ `držíš se`. Tlačítka „prohlédnout mapu" a „stanice je zadaná špatně" zůstávají.

**Karta konce runu** ukáže počet kol, osobní rekord, pole na přezdívku se
zápisem mezi přeživší, „Hrát znovu" a návrat na začátek.

## 2. Rotace mapy

### Trik

Naivní řešení — rotovat dlaždice a pak inverzně rotovat každý klik — by znamenalo
přepsat `pxToLatLng`, `latLngToPx` i vykreslování os. Místo toho se `#tiles` a
`#draw` obalí do jednoho `<div id="map">` a **rotuje se ten**. Kreslení i osy se
rotují spolu s mapou, takže převod px↔latlng zůstane beze změny.

### Plátno

Rotovaný čtverec musí být větší, jinak koukají do rohů černé kouty. Plátno je
proto `√2`× větší než výřez:

- `#stage` má pořád `overflow: hidden` a ukazuje 600m čtverec,
- `#map` je `sizePx * √2` px široký, vycentrovaný přes zápornou pozici, s
  `rotate(vp.rot)`,
- odpovídá mu výřez `600 * √2 ≈ 849 m`.

`tiles.mjs` k tomu stačí přepnout z konstanty `VIEW_SIZE` na `vp.size` (ten už ve
viewportu je) na třech místech: `layout`, `pxToLatLng`, `latLngToPx`.

### Souřadnice kliku

Ne `offsetX`/`offsetY`, ale `svg.getScreenCTM().inverse()` aplikovaná na
`clientX`/`clientY`. Čtyři řádky, které jsou správně při jakékoli transformaci
rodiče.

### Narovnání po potvrzení

`#map` má CSS `transition` na `rotate`. Po potvrzení kola se nastaví na 0 — mapa,
hráčova čára i osy se narovnají jako jeden kus a **žádné souřadnice se
nepřepočítávají**, protože všechny žijí v prostoru plátna.

Sekvence konce kola: narovnání 600 ms → najetí osy 1000 ms → výsledková karta
(`showResultCard` posune svůj `setTimeout` z 1200 na 1800 ms).

### Známá vada

Kdo kreslí až v rohu pootočeného výřezu, tomu po narovnání kus čáry uteče za
okraj `#stage`. Aby se tam dostal, musí být přes 100 m mimo — což je stejně
ztráta života. Neřeší se.

## 3. Co hardcore skryje

| prvek | v hardcore |
|---|---|
| jméno stanice | `???` |
| odznaky linek | pryč |
| accent podle linky | šedý, jednotný pro celý režim |
| fotka na pozadí | neutrální — fotka podle stanice by ji prozradila |
| pruh o přestupu | ukáže se, ale bez odznaků a bez podtextu s linkami |

Pruh tedy řekne jen **„Přestup — 2 úsečky!"**. Že jde o přestup, se přiznat musí
(jinak hráč nakreslí jednu čáru a propadne kolo), ale které linky to jsou, ne.
`buildTransfer` k tomu potřebuje umět prázdné `lines` při `required >= 2`.

## 4. Vizuál

Grayscale jde **jen na UI, ne na ortofoto**. Snímek zůstane v plné barvě, takže
hardcore není opticky těžší — je jen jinak oblečený.

| vrstva | co s ní |
|---|---|
| ortofoto `#tiles` | beze změny, plná barva |
| pozadí `#bg` | `filter: grayscale(1)` — je to kulisa, ne podklad ke hraní |
| panel, karty, tlačítka | vlastní paleta v šedé, uhel → kost |
| `--a`, `--b`, `--c` | přebity na kost `#e8e4dc`, aby odhalená osa neprozradila linku barvou |
| `--draw` | krev `#c1121f` |
| urgentní odpočet, ztráta života | krev |
| nadpisy | Nosifer |
| ostatní text | Archivo / Anton jako jinde |

Paleta se řeší **přepsáním CSS proměnných, ne `filter: grayscale()` na panelu** —
filtr na `#panel` by založil containing block a rozbil `backdrop-filter` matného
skla.

### Font

Nosifer (OFL, self-hosted `web/fonts/nosifer-latin.woff2`, ~25 kB). Latin only,
takže se nasadí **jen na řetězce bez diakritiky, které si řídí kód**: `HARDCORE`,
`???`, číslo kol, `KONEC`, `+1` / `-1`. Zbytek věty zůstane v Archivu s háčky —
„Přežil jsi 23 kol" se vysází správně.

### Lebky a grunge

- **Životy:** tři lebky místo teček průběhu v `#progress`. Ztracená zhasne a
  otřese se.
- **Vodoznak:** velká slabě viditelná lebka v pozadí panelu, jedno inline SVG.
- **Zrno a scanline:** přes `#panel::after` a `.card::after`, `pointer-events:
  none`. Vědomě **ne** přes `#stage` — přes snímek by ubíralo ostrost, což je
  přesně to, co u mapy nechceme.

### Vstup do režimu

Šedé čtvercové tlačítko s lebkou v pravém horním rohu úvodní karty, mimo řadu
tabů. Klik přepne kartu do čtvrtého, skrytého režimu (`data-mode="hardcore"` →
celá obrazovka zšedne, tlačítko dostane `.on`). Klik na kterýkoli normální tab se
vrátí zpět. `TABS` zůstává tříprvkové, `introTab` umí navíc hodnotu `hardcore`.

## 5. Server a žebříček

### Seed

Kola se derivují ze **seedu** přes `mulberry32` — stejná funkce na klientu i
serveru, takže server z jednoho čísla zrekonstruuje celý run. Seed si losuje
klient na začátku runu.

Každé kolo se seeduje zvlášť (`seed + i * 0x9e3779b1`), aby server uměl odvodit
i-té kolo bez iterace přes předchozí.

### Odeslání

Jeden POST na konci runu:

```
POST /api/hardcore
{ nick, seed, rounds: [segments | null, ...] }
```

Server si přepočítá vzdálenosti, odsimuluje životy a **počet kol si spočítá sám** —
číslo od klienta se ignoruje, přesně jako u weekly. Kola za smrtí utne. Cap 500
kol na payload.

`GET /api/hardcore` vrací top 100 `{nick, rounds}`.

### Uložení

Nová tabulka, migrace `0002_hardcore.sql`:

```sql
CREATE TABLE IF NOT EXISTS hardcore (
  nick TEXT NOT NULL UNIQUE,
  rounds INTEGER NOT NULL,
  seed INTEGER NOT NULL,
  run_json TEXT NOT NULL,
  ip_hash TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_hardcore_rounds ON hardcore(rounds DESC);
CREATE INDEX IF NOT EXISTS idx_hardcore_ip ON hardcore(ip_hash, created_at);
```

`UNIQUE(nick)` s upsertem jen na lepší výsledek
(`ON CONFLICT(nick) DO UPDATE ... WHERE excluded.rounds > hardcore.rounds`) dělá
z tabulky all-time žebříček přeživších. Rate limit podle `ip_hash` stejně jako v
`score.js`.

Vedle toho si klient drží osobní rekord v `localStorage` pod `pmg-hc-best`.

### Bounds

`validateRound` dostane volitelný `span` (default `VIEW_SIZE`). Bounds check pak
pouští body až do rohu plátna — 424 m místo dnešních 305. Bez toho by hardcore
kola tiše propadala na `bounds` a nezalogovala se.

Totéž v `/api/guess`, kam přibude mode `hardcore` (do `MODES` v `guess.js` i ve
`validate.mjs`).

### Co se vědomě neřeší

Obě díry má i dnešní weekly, takže hardcore je nezhoršuje:

- hráč si může seed přelosovat, dokud nepadnou stanice, které zná,
- `stations.json` je veřejný, takže dokonalý run jde poslat i bez hraní.

## 6. Rozsah

**Nové soubory**

| soubor | co v něm je | odhad |
|---|---|---|
| `web/shared/hardcore.mjs` | konstanty, `hardcoreRound`, `hardcoreViewport`, `nextLives`, `runLength` | ~40 ř. |
| `src/api/hardcore.js` | POST (přepočet runu) + GET (žebříček) | ~70 ř. |
| `migrations/0002_hardcore.sql` | tabulka výše | ~12 ř. |
| `tests/hardcore.test.mjs` | viz níž | ~60 ř. |
| `web/fonts/nosifer-latin.woff2` | font | ~25 kB |

**Změněné soubory**

| soubor | co se v něm mění |
|---|---|
| `web/app.mjs` | větve pro mode `hardcore`: panel, karty, životy, konec runu, žebříček |
| `web/board.mjs` | `#map` wrapper, `mapPx`, `getScreenCTM`, `straighten()`, `buildTransfer` bez linek |
| `web/tiles.mjs` | `vp.size` místo `VIEW_SIZE` na třech místech |
| `web/index.html` | obal `#tiles` + `#draw` do `<div id="map">` |
| `web/style.css` | hardcore paleta, `#map`, lebky, zrno, `@font-face` Nosifer |
| `web/shared/validate.mjs` | `span` u `validateRound`, `hardcore` v `MODES` |
| `src/api/guess.js` | `hardcore` v `MODES`, `span` u bounds |
| `src/index.js` | routa `/api/hardcore` |

## 7. Rozhraní klíčových kusů

```js
// web/shared/hardcore.mjs
export const LIVES_MAX = 3;
export const LOSE_M = 100;   // horší kolo bere život
export const GAIN_M = 15;    // lepší kolo život vrací
export const SPAN = Math.SQRT2;  // plátno vs. výřez, ať rotace nekouká do rohů
export const MAX_ROUNDS = 500;

// i-té kolo runu; deterministické ze seedu, klient i server dojdou ke stejné stanici
export function hardcoreRound(seed, i, stations)  // → {station, u, v, rot}

// viewport kola: střed jako jinde, ale větší plátno a úhel navíc
export function hardcoreViewport(round)           // → {lat, lng, size, rot}

// d = průměrná odchylka kola v metrech; null = propadlé kolo
export function nextLives(lives, d)               // → nový počet životů

// kolik kol hráč odehrál, než mu došly životy (fatální kolo se počítá)
export function runLength(distances)              // → N
```

## 8. Testy

`tests/hardcore.test.mjs`, `node --test` jako zbytek:

1. `nextLives` — tabulka z kapitoly 1 včetně stropu a `null`.
2. `runLength` — smrtící kolo se počítá; run bez smrti vrací délku pole;
   regenerace prodlouží run.
3. `hardcoreRound` — dvakrát stejný seed a index dá stejnou stanici; `rot` leží
   v `[0, 2π)`; `u`, `v` v `[0.2, 0.8]`.
4. `hardcoreViewport` — `size === VIEW_SIZE * √2`, střed odpovídá
   `roundViewport`.
5. px↔latlng round-trip při `size = 849` — bod tam a zpátky s přesností pod 1 px.
6. `validateRound` se `span` — bod 400 m od středu projde se `span`, bez něj
   spadne na `bounds`.
