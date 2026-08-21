# Živý duel 1v1 — návrh

Datum: 2026-08-21

## Cíl

Umožnit dvěma lidem odehrát proti sobě partii v reálném čase: stejných 10 kol,
společný časovač, po každém kole se ukáže, kdo byl blíž. Týdenní výzva a
tréninkové režimy zůstávají beze změny.

## Rozhodnutí

| Téma | Volba |
|---|---|
| Tempo | Lockstep — kolo začíná oběma naráz, kdo odevzdá dřív, čeká |
| Čas kola | 20 s (stanice s jednou linkou), 30 s (přestup) — stejné jako dnes |
| Shot clock | První odevzdání zkrátí deadline na `min(deadline, now + 5 s)` |
| Párování | Privátní kód/link **i** veřejná fronta |
| Start zápasu | Ready check: oba musí potvrdit do 60 s, jinak nepotvrzený prohrává |
| Odpojení | Pauza, grace 15 s, pak výhra kontumací |
| Infra | Přesun z Pages na Worker se `assets` bindingem |

## Architektura

Dnes: Cloudflare Pages (statické `web/`) + šest Pages Functions (`score`,
`leaderboard`, `guess`, `report`, `stats`, `export`) + D1. Pages Functions neumí definovat třídu Durable Objectu,
umí se na ni jen navázat. Proto se celý projekt překlápí na jeden Worker:

- `assets` binding servíruje `web/`
- dnešních šest Functions se stane šesti routami téhož Workeru
- `MatchDO` a `LobbyDO` leží ve stejném skriptu

Cena: mění se deploy target a `npm run dev` (na `wrangler dev`), custom doménu je
potřeba přepnout z Pages projektu na Worker.

Durable Objecty se deklarují jako SQLite-backed (`new_sqlite_classes` v migraci),
jinak nejsou na free plánu dostupné.

```
klient --WS----> /api/duel/:code   --> MatchDO   (stav zápasu, alarmy, skórování)
klient --POST--> /api/duel/queue   --> LobbyDO   (fronta, vrací code)
konec zápasu:                          MatchDO   --> D1 (tabulka duels)
```

`stations.json` a `scoring.mjs` sdílí Worker i klient jako dnes. Skóre počítá
**výhradně** DO; klient posílá jen úsečky.

## Párování

**Kód zápasu je jméno DO.** `MatchDO` se adresuje `idFromName(code)`, kde `code`
je 6 znaků z abecedy bez zaměnitelných tvarů (`ABCDEFGHJKLMNPQRSTUVWXYZ23456789`).
Žádná mapovací tabulka. Odkaz má tvar `/?duel=K7P2M9`.

**Fronta** je `LobbyDO` jako singleton (`idFromName('global')`), který drží
jednoho čekajícího s TTL 60 s. `POST /api/duel/queue` vrátí kód: je-li fronta
prázdná, volající kód založí a rovnou si otevře WebSocket do svého (zatím
prázdného) zápasu; čeká-li tam někdo, druhý dostane tentýž kód a připojí se.
Zápas se tím rozjede sám — nic se nepolluje, protože čekající už visí na
WebSocketu zápasu. (Původní verze specu počítala s dotazem po 2 s; není potřeba.)

**Nick** se dnes zadává až při odesílání skóre. V duelu musí být znám před
startem, protože ho soupeř vidí v lobby — prompt se přesouvá před vstup do
zápasu. Validace recykluje `NICK_RE` z `web/shared/validate.mjs`.

## MatchDO

Stav v DO storage (přežije hibernaci):

```js
{ code, roundMs: [10], phase, roundIndex, deadline, order: ['a', 'b'],
  players: { [id]: { nick, connected, ready, total, submitted, score } },
  pausedPhase, pausedRemainingMs, winner, reason }
```

Sedadlo (`'a'` / `'b'`) přiděluje `MatchDO` podle pořadí připojení a mapu
`token → sedadlo` drží mimo stav automatu. Ven jdou jen sedadla — token soupeře
se nikdy neposílá, jinak by šlo převzít jeho místo při návratu.

```
waiting ──oba připojeni──> ready(60 s) ──oba potvrdili──> countdown(3 s)
                               │                                    │
              vypršelo ────────┴──> ended (noshow)                  ↓
                                                                drawing(N)
                                                                    │
                                           deadline nebo oba odevzdali
                                                                    ↓
                                                            reveal(N, 3 s)
                                                                    │
                                              N < 9 ────────────────┘ (zpět do drawing(N+1))
                                              N = 9 ────────────> ended

kdykoli: disconnect ──> paused (alarm 15 s) ──reconnect──> zpět do předchozí fáze
                                             └──vypršelo──> ended (forfeit)
```

Časování řídí **DO alarm**, ne klient. Klient si drží jen odpočet pro zobrazení,
odvozený z absolutního `deadline` v ms.

### Shot clock

Při prvním platném submitu v kole:

```
deadline = min(deadline, now + 5000)
alarm se přenastaví
oběma se pošle `deadline`
```

`min`, ne `now + 5000` — jinak by pozdní odevzdání soupeři čas přidalo. Když
odevzdají oba, kolo končí okamžitě a alarm se ruší.

V UI musí být zkrácení vidět (odpočet zčervená a skočí na 5), jinak hráč netuší,
proč mu zmizel čas.

### Protokol (JSON přes WebSocket)

| Směr | Zpráva | Obsah |
|---|---|---|
| S→K | `state` | plný stav při připojení i reconnectu — klient je bezstavový a vždy se dosynchronizuje |
| S→K | `round` | `{ i, viewport: {lat, lng, size}, name, lines, deadline, msLeft }` — jméno stanice a její linky jsou **zadání** kola, ne tajemství; utajené zůstávají `axes` |
| S→K | `deadline` | `{ i, deadline, msLeft }` — po zásahu shot clocku |
| S→K | `opponent` | `{ id, connected, submitted }` |
| S→K | `reveal` | `{ i, axes, scores: {a, b}, totals: {a, b} }` |
| S→K | `end` | `{ totals, winner, reason }` |
| K→S | `ready` | bez obsahu — potvrzení ve fázi `ready`; mimo ni se ignoruje |
| K→S | `submit` | `{ i, lines }` — po `deadline` se zahodí, kolo je 0 |

Každá zpráva s `deadline` nese i `msLeft` dopočtené v okamžiku odeslání. Klient
počítá odpočet z `msLeft` a vlastního `performance.now()`, takže rozjeté hodiny
na jeho zařízení nic nerozbijí.

### Co serverový průběh zaručuje

Seed zůstává v DO, takže **nejdou předpočítat budoucí kola**; `viewport` přijde
až v momentě startu kola; odevzdání po `deadline` se zahodí; skóre počítá DO přes
stávající `scoreRound`. Validaci úseček přebírá `validateRound` z
`web/shared/validate.mjs`, která už dnes umí i neúplné kolo.

**Co nezaručuje:** `web/stations.json` je veřejný a obsahuje `axes` — skutečné
osy kolejí. Protože jméno stanice je součástí zadání, umí si dnes kdokoli
skriptem vyřešit libovolné kolo v libovolném režimu. Duel to nezhoršuje ani
nezlepšuje. Skutečná obrana by znamenala `axes` z veřejného JSONu vyndat a
posílat je až při odhalení — samostatná práce mimo tenhle návrh.

## Klient

Dnešní `app.mjs` (557 řádků) míchá kreslení a řízení hry a drží stav v modulových
proměnných. Duel to obrací: kola chodí ze serveru po jednom a deadline vlastní DO.

- `web/board.mjs` — nový, čistý přesun z `app.mjs`: kreslení úseček, `redraw`,
  převod px↔latlng, časovač, result card. Bez změny chování.
- `web/app.mjs` — zůstává jako řízení weekly/casual.
- `web/duel.mjs` — nový: WebSocket a duel flow.

Bez toho řezu by duel přilepil další větev do každé funkce v `app.mjs`.

## Data

Nová tabulka; weekly leaderboard (`scores`) se nemění.

```sql
CREATE TABLE duels (
  code TEXT PRIMARY KEY,
  nick_a TEXT, nick_b TEXT,
  score_a INTEGER, score_b INTEGER,
  winner TEXT,                 -- 'a' | 'b' | NULL při remíze
  ended_reason TEXT,           -- 'complete' | 'forfeit' | 'noshow'
  created_at TEXT DEFAULT (datetime('now'))
);
```

Zapisuje se jednou, na konci zápasu, z DO.

Kromě toho zapisuje `MatchDO` každé odehrané kolo do stávající tabulky `guesses`
s `mode = 'duel'` — jinak by v exportu a ve statistikách stanic vznikla díra.
Řádek plní server sám; klient v duelu na `/api/guess` nic neposílá. Sloupce `ms`
a `timed_out` zůstávají nulové: server neměří, jak dlouho hráč kreslil, a
vypršení času v duelu neznamená propadlé kolo — odevzdá se, co je nakresleno.

## Testování

Logika zápasu jde do `web/shared/duel-machine.mjs` jako čistá funkce
`(state, event, now) → { state, effects }`. Události: `join`, `submit`,
`timeout`, `disconnect`, `reconnect`. Efekty: `{type:'send'}`, `{type:'alarm'}`
(`at: null` alarm ruší) a `{type:'finish'}` pro zápis výsledku.
`MatchDO` je pak jen slupka kolem WebSocketu, alarmů a storage.
Testuje se přes `node --test` bez miniflare, stejně jako dnešní `seed` a
`validate`.

Testy, které musí existovat:

- první submit zkrátí deadline na `min(deadline, now + 5000)`; pozdní submit
  deadline nezvýší
- submit po deadline je zahozen, kolo je 0
- oba odevzdali → reveal okamžitě, alarm zrušen
- disconnect → pauza a hodiny stojí; reconnect do 15 s vrací **zbytek** času z
  okamžiku odpojení, ne nových 5 s ani nové celé kolo
- disconnect a 15 s ticho → `ended` s `forfeit`, vyhrává připojený hráč
- 10. reveal → `ended`, součty odpovídají součtu kol

Ručně: dvě okna nad `wrangler dev`, jeden zápas do konce, jeden s vypnutou wifi.

## Pořadí prací

**Fáze 1 — migrace, žádná změna chování** (~1–2 h): Pages → Worker s `assets`,
šest Functions na routy, `npm test` zelené, deploy, přepnutí domény, smazání Pages
projektu. Merguje se samostatně.

**Fáze 2 — duel** (~2 dny): `board.mjs` řez → `duel-machine.mjs` a testy →
`MatchDO` → `LobbyDO` → `duel.mjs` a UI → tabulka `duels`.

## Mimo rozsah

Odveta/rematch, chat, žebříček duelů, spectating, ELO, více než dva hráči.
