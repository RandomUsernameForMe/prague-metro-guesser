# Migrace Pages → Worker — implementační plán

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Přenést aplikaci z Cloudflare Pages na jeden Worker se `[assets]` bindingem, beze změny chování, aby šlo v další fázi přidat Durable Objecty.

**Architecture:** Statické soubory z `web/` servíruje `[assets]`. Šest dnešních Pages Functions se přesune z `functions/api/*.js` do `src/api/*.js` (stejná hloubka → importy se nemění, podpis `onRequestGet/onRequestPost({request, env})` zůstává) a `src/index.js` je tenký router `cesta → metoda → handler`.

**Tech Stack:** Cloudflare Workers, wrangler 4, D1, vanilla ES modules.

**Proč vůbec:** Pages Functions neumí definovat třídu Durable Objectu — jen se na ni navázat. Fáze 2 (živý duel) na DO stojí. Spec: `docs/superpowers/specs/2026-08-21-live-duel-design.md`.

---

### Task 1: Přesun Functions do `src/api/` a router

**Files:**
- Move: `functions/api/score.js` → `src/api/score.js` (a stejně dalších pět)
- Create: `src/index.js`
- Modify: `wrangler.toml`
- Modify: `package.json:6-8`

- [ ] **Step 1: Přesuň soubory přes `git mv`**

Hloubka zanoření se nemění (`functions/api/x.js` i `src/api/x.js` jsou dva adresáře od kořene), takže relativní importy typu `../../web/stations.json` zůstávají platné. Nesahej na obsah souborů.

```bash
mkdir -p src/api
git mv functions/api/score.js src/api/score.js
git mv functions/api/leaderboard.js src/api/leaderboard.js
git mv functions/api/guess.js src/api/guess.js
git mv functions/api/report.js src/api/report.js
git mv functions/api/stats.js src/api/stats.js
git mv functions/api/export.js src/api/export.js
rmdir functions/api functions
```

- [ ] **Step 2: Ověř, že v souborech nezůstal odkaz na `functions/`**

Run: `grep -rn "functions/" src/ web/ package.json wrangler.toml`
Expected: žádný výstup.

- [ ] **Step 3: Napiš router**

Create `src/index.js`:

```js
import * as score from './api/score.js';
import * as leaderboard from './api/leaderboard.js';
import * as guess from './api/guess.js';
import * as report from './api/report.js';
import * as stats from './api/stats.js';
import * as exportCsv from './api/export.js';

// cesta → metoda → handler; podpis zůstal z Pages Functions: ({ request, env })
const ROUTES = {
  '/api/score': { POST: score.onRequestPost },
  '/api/leaderboard': { GET: leaderboard.onRequestGet },
  '/api/guess': { POST: guess.onRequestPost },
  '/api/report': { POST: report.onRequestPost },
  '/api/stats': { GET: stats.onRequestGet },
  '/api/export': { GET: exportCsv.onRequestGet },
};

export default {
  async fetch(request, env) {
    const { pathname } = new URL(request.url);
    const handler = ROUTES[pathname]?.[request.method];
    // statické soubory řeší [assets] dřív, než se sem request dostane
    if (!handler) return new Response('not found', { status: 404 });
    return handler({ request, env });
  },
};
```

- [ ] **Step 4: Přepiš `wrangler.toml`**

Nahraď celý obsah:

```toml
name = "prague-metro-guesser"
main = "src/index.js"
compatibility_date = "2026-08-01"

[assets]
directory = "./web"

[[d1_databases]]
binding = "DB"
database_name = "metro-guesser"
database_id = "853881c9-743d-4803-88cb-71cf7cf98b72"
```

`pages_build_output_dir` mizí. Když `[assets]` nenajde soubor, request spadne na Worker — proto `/api/*` funguje a `/` vrátí `web/index.html`.

- [ ] **Step 5: Uprav skripty v `package.json`**

Nahraď blok `"scripts"`:

```json
  "scripts": {
    "test": "node --test 'tests/*.test.mjs'",
    "build:stations": "node scripts/build-stations.mjs",
    "dev": "wrangler dev",
    "deploy": "wrangler deploy"
  },
```

- [ ] **Step 6: Založ lokální D1 a spusť dev server**

```bash
npx wrangler d1 execute metro-guesser --local --file=schema.sql
npx wrangler dev
```

Expected: `Ready on http://localhost:8787`. Server nech běžet v druhém terminálu.

- [ ] **Step 7: Prokliknej všech šest rout curlem**

```bash
curl -s http://localhost:8787/ | head -2
curl -s 'http://localhost:8787/api/leaderboard?week=2026-34'
curl -s http://localhost:8787/api/stats
curl -s http://localhost:8787/api/export
curl -s -X POST http://localhost:8787/api/guess -H 'content-type: application/json' -d '{}'
curl -s -X POST http://localhost:8787/api/report -H 'content-type: application/json' -d '{}'
curl -s -X POST http://localhost:8787/api/score -H 'content-type: application/json' -d '{}'
curl -s -o /dev/null -w '%{http_code}\n' http://localhost:8787/api/neexistuje
curl -s -o /dev/null -w '%{http_code}\n' http://localhost:8787/stations.json
```

Expected, řádek po řádku:
1. `<!DOCTYPE html>` a `<html lang="cs">`
2. `{"week":"2026-34","entries":[]}`
3. `{"mode":"all","stations":[]}`
4. `{"error":"export disabled"}`
5. `{"error":"session"}`
6. `{"error":"body"}`
7. `{"error":"nick"}`
8. `404`
9. `200`

Když řádek 1 vrátí `not found`, `[assets]` míří jinam než na `web/`. Když řádek 9 vrátí 404, aplikace by v prohlížeči nenačetla stanice.

- [ ] **Step 8: Ověř aplikaci v prohlížeči**

Otevři `http://localhost:8787`, dej „Rozehřátí", odehraj jedno kolo. Musí se načíst letecké dlaždice, odpočet běžet a po potvrzení se ukázat osa. V konzoli prohlížeče nesmí být 404.

- [ ] **Step 9: Spusť testy**

Run: `npm test`
Expected: `fail 0`. (Testy pokrývají jen `web/shared/*.mjs`, migrace se jich nedotýká — jde o kontrolu, že se nic nerozbilo přesunem.)

- [ ] **Step 10: Commit**

```bash
git add -A
git commit -m "refactor: serve from a Worker with assets instead of Pages

Pages Functions cannot define Durable Object classes, which the live duel
mode needs. Functions move to src/api/ at the same nesting depth, so their
imports are unchanged, and src/index.js dispatches by path and method."
```

---

### Task 2: Nasazení a přepnutí domény

Tenhle úkol sahá na produkci. Kroky označené **[ručně]** dělá člověk ve webové konzoli Cloudflare — neautomatizuj je.

**Files:** žádné změny v repu.

- [ ] **Step 1: Nasaď Worker**

Run: `npx wrangler deploy`
Expected: výpis končí URL tvaru `https://prague-metro-guesser.<účet>.workers.dev`.

- [ ] **Step 2: Nastav secret pro export**

`EXPORT_TOKEN` byl secret Pages projektu; na Worker se nepřenese sám a bez něj vrací `/api/export` 503.

```bash
npx wrangler secret put EXPORT_TOKEN
```

Zadej stejnou hodnotu, jakou měl Pages projekt. Nemáš-li ji, vygeneruj novou (`openssl rand -hex 24`) a poznamenej si ji.

- [ ] **Step 3: Ověř nasazený Worker na workers.dev URL**

```bash
curl -s 'https://prague-metro-guesser.<účet>.workers.dev/api/stats' | head -c 200
curl -s -o /dev/null -w '%{http_code}\n' 'https://prague-metro-guesser.<účet>.workers.dev/'
```

Expected: JSON se skutečnými daty z produkční D1 (ne prázdné pole, pokud už někdo hrál) a `200`.

- [ ] **Step 4: [ručně] Přepni custom doménu**

V dashboardu Cloudflare: Workers & Pages → `prague-metro-guesser` (Worker) → Settings → Domains & Routes → Add custom domain. Doménu je nejdřív nutné odebrat z Pages projektu, jinak ji Worker nepřevezme.

- [ ] **Step 5: Ověř produkci na custom doméně**

```bash
curl -s -o /dev/null -w '%{http_code}\n' https://<doména>/
curl -s 'https://<doména>/api/leaderboard?week='"$(date -u +%G-%V)"
```

Expected: `200` a žebříček aktuálního týdne se skutečnými zápisy.

- [ ] **Step 6: [ručně] Smaž Pages projekt**

Až doména pojede z Workeru a žebříček ukazuje data, smaž starý Pages projekt, ať do něj nic omylem nedeployuje. D1 databáze je samostatný zdroj a smazáním Pages projektu se jí nic nestane.

---

## Co tenhle plán nedělá

Nemění chování aplikace, neřeší duel, nesahá na `web/`. Fáze 2 je v samostatném plánu `docs/superpowers/plans/2026-08-21-live-duel.md`.
