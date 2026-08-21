# Admin rozhraní se statistikami — návrh

Datum: 2026-08-21

## Cíl

Dát provozovateli hry stránku, ze které pozná, jak si hra vede: kolik lidí
hraje, kolik kol denně přibývá, jestli lidé kola dokončují a které stanice jsou
nejtěžší.

Dnes existují data, ale ne pohled na ně. Tabulka `guesses` má od commitu
`33dec2b` řádek za každé odehrané kolo, `/api/export` je umí vysypat jako CSV a
`/api/stats` z nich dělá veřejnou agregaci po stanicích. Kdo chce vidět provoz,
musí stáhnout CSV a otevřít tabulkový procesor.

## Rozsah

- Tři stránky pod `/admin/`, všechny za stávajícím Basic Auth.
- Čte se výhradně z `guesses`. Žádná změna schématu, žádný nový zápis.
- Veřejné `/api/stats` a `/api/export` zůstávají beze změny.
- `/admin/reports` si zachovává obsah; mění se mu jen hlavička a odkud bere auth.

## Architektura

Server-rendered HTML bez klientského JavaScriptu, stejně jako dnešní
`/admin/reports`. Stránka je jeden `Response` s hotovou tabulkou.

Autorizaci přebírá `functions/admin/_middleware.js` — vlastní konvence
Cloudflare Pages Functions pro kód, který má běžet před všemi routami v adresáři.
Ověření hesla tím existuje na jednom místě pro celý podstrom `/admin/*`.

Zvolená varianta proti alternativám:

- *Kopie `authorized()` v každé stránce* — tři kopie bezpečnostního kódu, které
  se rozejdou. Přesně to, čemu se middleware vyhýbá.
- *Klientský dashboard nad `/api/stats`* — vyžadovalo by vystavit provozní data
  veřejným API nebo postavit druhé autorizované API. Server-rendered stránka
  žádné nové veřejné rozhraní nepřidává.

### Soubory

| Soubor | Stav | Účel |
|---|---|---|
| `functions/admin/_middleware.js` | nový | Basic Auth pro celý `/admin/*` |
| `functions/admin/_layout.js` | nový | `esc()`, `page()`, sdílené CSS, navigační lišta |
| `functions/admin/index.js` | nový | rozcestník se souhrnem za 7 dní |
| `functions/admin/stats.js` | nový | denní řada a tabulka stanic |
| `functions/admin/reports.js` | úprava | zbaven vlastního auth a vlastního CSS |
| `tests/admin.test.mjs` | nový | escapování a formátovací funkce |

Soubory s podtržítkem na začátku Pages neroutuje, takže `_middleware.js` ani
`_layout.js` nevzniknou jako veřejné URL.

## Stránky

### `/admin/` — rozcestník

Čtyři souhrnná čísla za posledních 7 dní: hráčů, kol, průměrné skóre, podíl
propadlých kol. Pod nimi odkazy na Hlášení, Statistiky a CSV export.

Souhrn je tu proto, aby rozcestník nebyl prázdná stránka se třemi odkazy.

### `/admin/stats` — provozní přehled

Denní řada za 14 dní: den, kol, hráčů, průměrné skóre. Pod ní tabulka stanic
seřazená od nejtěžší, se stejnými sloupci, jaké dnes vrací `/api/stats`.

### `/admin/reports` — hlášení chyb

Beze změny obsahu.

## Dotazy

Tři dotazy nad `guesses`, spuštěné přes `env.DB.batch()`.

```sql
-- souhrn za 7 dní (rozcestník)
SELECT COUNT(DISTINCT session) AS hraci, COUNT(*) AS kol,
       AVG(score) AS skore, SUM(forfeited) AS propadlo
FROM guesses WHERE created_at > datetime('now','-7 days');

-- denní řada za 14 dní (statistiky)
SELECT date(created_at) AS den, COUNT(*) AS kol,
       COUNT(DISTINCT session) AS hraci, AVG(score) AS skore
FROM guesses WHERE created_at > datetime('now','-14 days')
GROUP BY den ORDER BY den DESC;

-- po stanicích (statistiky) — stejná agregace jako /api/stats
SELECT station_id, COUNT(*) AS n, AVG(score) AS avg_score, AVG(dist_m) AS avg_dist,
       SUM(forfeited) AS forfeits, AVG(ms) AS avg_ms
FROM guesses GROUP BY station_id;
```

Indexy `idx_guesses_created` a `idx_guesses_station` už existují a pokrývají
všechny tři.

## Rozhodnutí

**„Hráčů" znamená `COUNT(DISTINCT session)`.** `session` je náhodné UUID
z localStorage. Kdo si smaže úložiště nebo hraje na dvou zařízeních, počítá se
vícekrát — je to tedy horní odhad a stránka to u čísla říká. Alternativa
`ip_hash` by naopak slepila celou domácnost nebo školní síť do jednoho hráče.

**Bez filtru podle režimu.** Veřejné `/api/stats` ho má, admin ho zatím
nepotřebuje. Doplnění je jeden `WHERE`.

**Bez grafů.** Denní řada je tabulka. Stránka nesmí tahat knihovnu z CDN a ruční
SVG se u čtyř sloupců nevyplatí.

**Průměr, ne medián.** SQLite medián neumí bez window funkcí a na otázku „jak si
lidé vedou" odpovídá průměr stejně dobře.

**Prázdná databáze je normální stav.** Čerstvé nasazení nemá v `guesses` nic.
Všechny agregace musí projít bez dělení nulou a stránka místo tabulky napíše, že
zatím nejsou data.

## Bezpečnost

Middleware odmítá požadavek, když `ADMIN_PASSWORD` není nastavený — nenastavený
secret nesmí admin otevřít, jen zavřít. Hesla se porovnávají jako SHA-256 otisky
stejné délky, aby z doby porovnání nešla uhodnout délka ani obsah.

Jediný neověřený uživatelský vstup na stránkách je sloupec `note`
z hlášení; prochází přes `esc()`. Odpovědi nesou `cache-control: no-store`
a `x-robots-tag: noindex`.

## Testy

`tests/admin.test.mjs` importuje `_layout.js` přímo v Node — je to čisté ESM bez
Worker globálů.

- `esc()` neutralizuje `<`, `>`, `&` i `"`.
- Formátování procent a času vrátí smysluplnou hodnotu pro nulový počet kol,
  místo `NaN` nebo pádu.

## Ověření při implementaci

Že `_middleware.js` chytá i `/admin` bez koncového lomítka a že soubory
s podtržítkem nevznikají jako veřejné routy. Ověřuje se lokálně přes
`wrangler pages dev`, ne až v produkci.
