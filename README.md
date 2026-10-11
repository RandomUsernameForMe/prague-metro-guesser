# Kde je metro? — Prague Metro Guesser

Where does the Prague metro actually run? You get an aerial photo of a piece of Prague and a station name, and you draw the line where you think the platform lies underground. The closer your line is to the real track axis, the more points you get.

**Play:** <https://kdejemetro.guth.workers.dev>

## Game modes

- **Weekly challenge** — 10 stations, the same for everyone in a given ISO week, public leaderboard.
- **Training** — random stations, no leaderboard.
- **Live duel** — 1v1 in real time: same 10 rounds, shared timer, round-by-round reveal.
- **Hardcore** — no station name, randomly rotated map, three lives, endless.

## How it works

- **Ground truth from OpenStreetMap.** A build script pulls all metro stations and `railway=subway` tracks from the Overpass API and clips the track axes around each station. Nothing is hand-placed.
- **Scoring.** Your line is sampled every 5 m and compared to the real axis with a symmetric mean distance `d`; a round scores `round(1000 × exp(−d / 85))`.
- **Deterministic weekly seed.** Client and server derive the same stations and map offsets from the ISO week, so there is no cron and no weekly rebuild.
- **Imagery.** ČÚZK orthophoto WMTS (open data), Esri World Imagery as a fallback.
- **Admin.** Stats, guess heatmaps, player reports and per-station axis overrides stored in the database.

## Stack

Vanilla JS + SVG frontend (no framework), a single Cloudflare Worker, Cloudflare D1, and Durable Objects for duel lobbies and matches.

## Running locally

```bash
npm install
npm run migrate:local   # create the local D1 database
npm run dev             # wrangler dev
npm test                # node --test
npm run smoke           # duel smoke tests
```

`npm run build:stations` regenerates `stations.json` from OpenStreetMap. Deployment notes are in [DEPLOY.md](DEPLOY.md), design docs in [`docs/`](docs/).

---

🇨🇿 **Česky:** Hádací hra nad leteckými snímky Prahy — nakresli, kudy pod zemí vede stanice metra. Týdenní výzva s žebříčkem, trénink, živý duel 1v1 a hardcore režim. Osy stanic se počítají automaticky z OpenStreetMap, snímky jsou ortofoto ČÚZK. Běží na Cloudflare Workers + D1.
