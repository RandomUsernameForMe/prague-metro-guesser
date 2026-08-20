# Prague Metro Guesser — Design

Webová hra: hráč vidí fixní letecký výřez Prahy, zná jméno stanice metra a nakreslí čáru, kudy podle něj pod zemí vede stanice (osa nástupiště/kolejí). Týdenní výzva o 10 stanicích, veřejný leaderboard.

## Architektura

- **Frontend:** vanilla JS + SVG, žádný framework. Hostováno na Cloudflare Pages.
- **Backend:** jeden Cloudflare Worker se dvěma endpointy:
  - `GET /api/leaderboard?week=YYYY-WW` — top skóre týdne
  - `POST /api/score` — `{week, nick, lines}` → Worker přepočítá skóre a uloží
- **DB:** Cloudflare D1, tabulka `scores(week TEXT, nick TEXT, score INTEGER, lines_json TEXT, created_at TEXT, UNIQUE(week, nick))`
- **Data:** `stations.json` generovaný jednorázově build skriptem (Node) z OpenStreetMap Overpass API, commitnutý v repu. Sdílený mezi frontendem a Workerem.
- **Sdílený kód:** scoring modul a modul týdenního seedu jsou jedny soubory importované klientem i Workerem (ESM).

## Data a ground truth (plně automatizované)

- Overpass dotaz: 60 nodů `railway=station station=subway` v bboxu Prahy + ways `railway=subway`.
- Osa stanice = úseky kolejí (`railway=subway`) do 150 m od nodu stanice, oříznuté na tento okruh. U přestupních stanic (Můstek, Muzeum, Florenc) vzniknou osy obou linek — scoring bere vzdálenost k nejbližší.
- `stations.json` per stanice: `{id, name, lat, lng, lines: ["A"], axes: [[[lat,lng],...], ...], isTransfer}`
- Žádné ruční nastavování správných odpovědí.

## Týdenní výzva

- Seed = ISO rok-týden (např. `2026-34`), deterministické PRNG (mulberry32 nad hashem stringu).
- Výběr: nejdřív 1 přestupní stanice ze 3 (Můstek, Muzeum, Florenc), pak 9 dalších z celého zbytku. Pořadí kol zamícháno stejným seedem.
- Offset výřezu per stanice též ze seedu → klient i Worker spočítají identické zadání, žádný týdenní rebuild ani cron.

## Zobrazení snímku

- Fixní výřez ~600×600 m, bez panování. Stanice náhodně posunutá od středu, min. 15 % od kraje výřezu.
- Dlaždice: mřížka `<img>` z ČÚZK ortofoto WMTS (open data, bez API klíče). Fallback při nedostupnosti: Esri World Imagery. Atribuce v patičce.
- Přes dlaždice absolutně pozicovaná SVG vrstva na kreslení. Převod souřadnic: Web Mercator, lineární mapování bbox → pixely.

## UI

- Layout „full-bleed": snímek přes celý viewport, plovoucí HUD pill nahoře, plovoucí tlačítko Potvrdit vpravo dole. Tmavý, minimalistický vizuál. Reveal a výsledky jako overlay.

## Herní smyčka

1. 10 kol. HUD: jméno stanice, kolo X/10, průběžné skóre.
2. Kreslení: klik přidá bod lomené čáry (tah prstem/myší kreslí spojitě), tlačítka Smazat a Potvrdit. Minimálně 2 body.
3. Po potvrzení: animovaný reveal skutečné osy, body kola, tlačítko Další.
4. Po 10. kole: celkové skóre, zadání přezdívky (3–16 znaků), odeslání, zobrazení leaderboardu týdne.
- **Trénink:** náhodná stanice, stejná mechanika, bez zápisu na leaderboard.

## Skóre

- Hráčova čára navzorkována po 5 m. Symetrická průměrná vzdálenost `d` (metry): průměr z (vzorky hráče → nejbližší bod osy) a (vzorky osy → nejbližší bod hráčovy čáry). Symetrie brání tečce u osy.
- Kolo: `round(1000 × exp(−d/85))`. Orientačně: 10 m ≈ 889, 30 m ≈ 703, 100 m ≈ 308.
- Týden max 10 000.

## Leaderboard a anti-cheat (lehký)

- Bez registrace, jen přezdívka. `UNIQUE(week, nick)` — první zápis vyhrává, druhý pokus se stejným nickem = 409.
- Worker přepočítá skóre z poslaných čar sám (sdílený scoring modul + `stations.json`); klientem poslané číslo se ignoruje.
- Validace vstupu: max. počet bodů čáry (200/kolo), souřadnice uvnitř výřezu daného kola, nick regex `^[\p{L}\p{N} _-]{3,16}$`.
- Jeden bodovaný pokus/týden i v localStorage (soft). Rate limit per IP (např. 10 POST/h) přes Workers rate limiting.

## Chybové stavy

- ČÚZK dlaždice selžou (onerror) → přepnout celou mřížku na Esri.
- Overpass výpadek se netýká runtime (data baked).
- POST selže → retry tlačítko, skóre drženo v paměti/localStorage.

## Testy

- Unit: scoring (vzdálenosti, symetrie, vzorec), determinismus seedu (stejný týden → stejných 10 stanic + offsety, vždy ≥1 přestupní), validace vstupu Workeru.
- Build skript: tvar `stations.json` — 60 stanic, každá má ≥1 osu, přestupní mají ≥2.

## Mimo scope (v2)

- Hard mode bez jména stanice (volba obtížnosti v UI připravena, ale neimplementována).
- Účty, historie hráče, denní režimy.
