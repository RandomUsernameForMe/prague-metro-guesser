# Nasazení

Produkce: <https://kdejemetro.guth.workers.dev>
Admin: `/admin` (Basic Auth, na jménu nezáleží, heslo je secret `ADMIN_PASSWORD`)

Adresa se skládá z `name` ve `wrangler.toml` a ze subdomény účtu (`guth`).
Přejmenování workeru zakládá nový worker — znamená to znovu nastavit secrety
a znovu propojit Workers Builds, tak to nedělej pro nic za nic.

## Běžný den

```
git push
```

To je celé. Workers Builds nasadí každý push do `main`.

**Ověř si, že se to opravdu nasadilo.** Push, který nikam nedojel, se nijak
neohlásí — 26. 8. 2026 takhle produkce tiše zůstala tři commity pozadu, protože
přejmenování workeru shodilo build trigger. Nejrychlejší kontrola je stáhnout si
soubor, který přibyl posledním commitem; 404 znamená, že build neproběhl:

```
curl -sI https://kdejemetro.guth.workers.dev/og.jpg | head -1
npx wrangler deployments list | tail -20   # zdroj má být Workers Builds, ne Secret Change
```

Když build nejede, nasadíš ručně přes `npx wrangler deploy` a pak se koukni na
trigger (Settings → Builds u workeru `kdejemetro`).

## Když se mění schéma databáze

Přidej soubor do `migrations/` (`0002_neco.sql`, `0003_...`) a pusť:

```
npm run migrate
```

Pouští se ručně schválně: build nemá k D1 přístup (viz níž) a migrace, která se
nasadí sama, se sama i rozbije. Příkaz je idempotentní — už použité migrace
přeskočí, protože si je D1 eviduje v tabulce `d1_migrations`.

## Když se mění brand

Ikony (`web/icon-*.png`, `web/apple-touch-icon.png`) a náhled sdílení
(`web/og.jpg`) jsou v gitu jako hotové soubory, build je nedělá. Po změně barev
nebo ikony je přegeneruj:

```
node scripts/build-brand.mjs
```

Potřebuje Google Chrome v `/Applications` a síť (do OG obrázku se skládají
letecké dlaždice z ČÚZK). Trvá to asi minutu — Chrome po sobě snímek zapíše, ale
sám neskončí, takže se čeká na timeout.

## Jednorázové nastavení

Tohle uděláš jednou a už nikdy.

**1. Propojit repo** — v dashboardu Workers & Pages → `prague-metro-guesser` →
Settings → Builds → Connect → vyber GitHub repo.

| pole | hodnota |
|---|---|
| Build command | nechat prázdné (projekt nemá build step) |
| Deploy command | `npx wrangler deploy` |
| Production branch | `main` |

Jméno workeru v dashboardu se musí shodovat s `name` ve `wrangler.toml`, jinak
build spadne.

**2. Secrety** — bez nich aplikace běží, jen bez příslušné funkce:

```
npx wrangler secret put SALT             # solí otisky IP a seed kol duelu
npx wrangler secret put ADMIN_PASSWORD   # Basic Auth pro /admin
npx wrangler secret put EXPORT_TOKEN     # CSV export na /api/export
```

## Lokální vývoj

```
npm run migrate:local   # jednou, založí tabulky v .wrangler/state
npm run dev             # http://localhost:8787
npm test                # čisté unit testy, nepotřebují server
npm run smoke           # duel proti běžícímu dev serveru
```

## Co za tebe nikdo neudělá

- **Preview URL na PR nefungují.** Cloudflare je pro workery s Durable Objects
  negeneruje, a tenhle worker je má. Buildy na větvích proběhnou, odkaz k
  proklikání z nich nebude.
- **Migrace v CI.** Token, který si Workers Builds generuje sám, má práva na
  Workers Scripts, KV a R2 — ne na D1. Kdybys migrace přesto chtěl automaticky,
  přidej tokenu právo *D1 (edit)* a nastav deploy command na
  `npx wrangler d1 migrations apply metro-guesser --remote && npx wrangler deploy`.
