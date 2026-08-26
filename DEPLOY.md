# Nasazení

Produkce: <https://kdejemetro.guth.workers.dev>
Admin: `/admin` (Basic Auth, na jménu nezáleží, heslo je secret `ADMIN_PASSWORD`)

Osy stanic jdou přepsat z adminu (`/admin/station?id=…`, odkaz je u každého
hlášení). Přepis žije v D1, projeví se do minuty a bez deploye — ale až po
migraci `0003_station_axes.sql`, bez ní se hraje podle `web/stations.json`.

Adresa se skládá z `name` ve `wrangler.toml` a ze subdomény účtu (`guth`).
Přejmenování workeru zakládá nový worker — znamená to znovu nastavit secrety
a znovu propojit Workers Builds, tak to nedělej pro nic za nic.

## Běžný den

```
git push
npx wrangler deploy
```

Obojí. **Push sám nenasazuje.** Workers Builds je odpojený — trigger shodilo
přejmenování workeru 26. 8. 2026 a zpátky propojený není, takže produkce jede
z ruky. Kdo pushne a jde od počítače, nechá produkci pozadu a nic mu to neřekne.

**Ověř si, že se to opravdu nasadilo.** `wrangler deploy` běžně hlásí
`No updated asset files to upload` i když se soubory měnily, takže výpis
příkazu není důkaz. Stáhni si z produkce něco, co přibylo posledním commitem:

```
curl -s https://kdejemetro.guth.workers.dev/app.mjs | grep -c neco_z_posledni_zmeny
npx wrangler deployments list | tail -20
```

Ve výpisu deploymentů je zdroj `Unknown (deployment)` ruční wrangler,
`Workers Builds` znamená, že se trigger probral k životu. Až se tak stane,
`npx wrangler deploy` z běžného dne vypadne a tenhle odstavec s ním.
Propojení popisuje *Jednorázové nastavení* níž.

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

**1. Propojit repo** — v dashboardu Workers & Pages → `kdejemetro` →
Settings → Builds → Connect → vyber GitHub repo. Momentálně propojené není
(viz *Běžný den*).

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
  negeneruje, a tenhle worker je má. I kdyby buildy zase jezdily, odkaz k
  proklikání z větve nebude.
- **Migrace v CI.** Token, který si Workers Builds generuje sám, má práva na
  Workers Scripts, KV a R2 — ne na D1. Kdybys migrace přesto chtěl automaticky,
  přidej tokenu právo *D1 (edit)* a nastav deploy command na
  `npx wrangler d1 migrations apply metro-guesser --remote && npx wrangler deploy`.
