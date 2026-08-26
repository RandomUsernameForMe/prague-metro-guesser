// Vygeneruje OG obrázek a ikony do web/. Pouští se ručně, výsledné PNG jsou
// v gitu — build krok to není. Znovu spusť, když se změní barvy nebo ikona:
//   node scripts/build-brand.mjs
//
// Rasterizuje se headless Chromem, protože Anton musí sednout přesně tak jako
// v aplikaci a žádný z rasterizérů, co má člověk na Macu po ruce (sharp/librsvg),
// text ve fontu ze souboru spolehlivě nevykreslí.
import { readFileSync, writeFileSync, mkdtempSync, rmSync, existsSync, statSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { layout } from '../web/tiles.mjs';

const web = fileURLToPath(new URL('../web/', import.meta.url));
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';

// Čtyři stanice do mřížky. Osa nástupiště se nekreslí — OG nesmí prozradit
// odpověď. Všechny čtyři jsou podzemní: u nadzemních (Vyšehrad, Černý Most) je
// nástupiště na snímku vidět a otázka „kudy vede pod tím" ztrácí smysl.
// Jinak vybrané na kontrast textur (jádro, křižovatka, kolejiště, sídliště)
// a tak, aby padla A i B i C.
const STATIONS = ['Staroměstská', 'Anděl', 'Hlavní nádraží', 'Háje'];
const MAP = 630;                       // hrana leteckého čtverce = výška OG
const GAP = 2, CELL = (MAP - GAP) / 2;
const OG_W = 1200, OG_H = 630;

const LINE = { A: '#009f4d', B: '#ffd400', C: '#d6001c' };
const CONCRETE = '#0f1113', TEXT = '#eef1f3', MUTED = '#8c969e', HAIRLINE = '#2c3238';
const ICON_RED = '#c8102e';            // sladěno s web/favicon.svg

const tmp = mkdtempSync(join(tmpdir(), 'pmg-brand-'));

// Chrome 151 v novém headless snímek zapíše, ale sám neskončí. Necháme ho tedy
// doběhnout do timeoutu a úspěch poznáme podle toho, že PNG na disku je.
const shot = (html, out, w, h, waitMs) => {
  const page = join(tmp, 'page.html');
  const dest = join(web, out);
  writeFileSync(page, html);
  rmSync(dest, { force: true });
  spawnSync(CHROME, [
    '--headless', '--disable-gpu', '--hide-scrollbars',
    `--user-data-dir=${join(tmp, 'profile')}`,   // ať to nekoliduje s běžícím Chromem
    '--no-first-run', '--no-default-browser-check',
    '--disable-background-networking', '--disable-component-update',
    '--force-device-scale-factor=1',
    `--window-size=${w},${h}`,
    `--screenshot=${dest}`,
    `file://${page}`,
  ], { stdio: 'ignore', timeout: waitMs, killSignal: 'SIGKILL' });
  if (!existsSync(dest)) throw new Error(`Chrome nevyrobil ${out}`);
  console.log(`${out}  ${w}×${h}  ${(statSync(dest).size / 1024).toFixed(0)} kB`);
};

// OG obrázek je ze tří čtvrtin letecká fotka, PNG na něj sedne přes 800 kB.
// Chrome umí uložit jen PNG, převod dělá sips (je v macOS).
const toJpeg = (png, jpg, quality) => {
  const dest = join(web, jpg);
  spawnSync('sips', ['-s', 'format', 'jpeg', '-s', 'formatOptions', String(quality),
    join(web, png), '--out', dest], { stdio: 'ignore' });
  if (!existsSync(dest)) throw new Error(`sips nevyrobil ${jpg}`);
  rmSync(join(web, png));
  console.log(`${jpg}  ${(statSync(dest).size / 1024).toFixed(0)} kB`);
};

// ---------- OG obrázek ----------

// Fonty jdou do stránky jako data: URI — file:// stránka by si soubor vedle sebe
// kvůli CORS nenačetla. unicode-range musí sedět se style.css, jinak háčky a
// čárky spadnou do fallbacku (a `ě` vypadá jako z jiného fontu).
const RANGE = {
  latin: 'U+0000-00FF,U+0131,U+0152-0153,U+02BB-02BC,U+02C6,U+02DA,U+02DC,U+0304,U+0308,U+0329,U+2000-206F,U+20AC,U+2122,U+2191,U+2193,U+2212,U+2215,U+FEFF,U+FFFD',
  ext: 'U+0100-02BA,U+02BD-02C5,U+02C7-02CC,U+02CE-02D7,U+02DD-02FF,U+0304,U+0308,U+0329,U+1D00-1DBF,U+1E00-1E9F,U+1EF2-1EFF,U+2020,U+20A0-20AB,U+20AD-20C0,U+2113,U+2C60-2C7F,U+A720-A7FF',
};
const face = (name, weight, file, range) =>
  `@font-face{font-family:'${name}';font-weight:${weight};unicode-range:${range};` +
  `src:url(data:font/woff2;base64,${readFileSync(join(web, 'fonts', file)).toString('base64')}) format('woff2')}`;
const family = (name, weight, stem) =>
  face(name, weight, `${stem}-latin.woff2`, RANGE.latin) + face(name, weight, `${stem}-latin-ext.woff2`, RANGE.ext);

const all = JSON.parse(readFileSync(join(web, 'stations.json'), 'utf8'));
const picked = STATIONS.map(name => {
  const s = all.find(x => x.name === name);
  if (!s) throw new Error(`stanice ${name} není ve stations.json`);
  return s;
});

const badge = l =>
  `<span class="badge" style="background:${LINE[l]};color:${l === 'B' ? '#1a1400' : '#fff'}">${l}</span>`;

const cells = picked.map(s => {
  const tiles = layout({ lat: s.lat, lng: s.lng }, CELL)
    .map(t => `<img src="${t.url}" style="left:${t.left}px;top:${t.top}px;width:${t.w}px;height:${t.h}px">`)
    .join('');
  return `<div class="cell">${tiles}
    <span class="label">${s.lines.map(badge).join('')}${s.name}</span>
  </div>`;
}).join('');

const accent = LINE.A;

shot(`<meta charset="utf-8"><style>
${family('Anton', 400, 'anton')}
${family('Archivo', '500 800', 'archivo')}
*{margin:0;box-sizing:border-box}
body{width:${OG_W}px;height:${OG_H}px;display:flex;overflow:hidden;
  background:#0e1b17;color:${TEXT};font:600 16px/1.45 Archivo,sans-serif}
#map{width:${MAP}px;height:${MAP}px;flex:none;background:${CONCRETE};
  display:grid;grid-template:repeat(2,1fr)/repeat(2,1fr);gap:${GAP}px}
.cell{position:relative;overflow:hidden}
.cell img{position:absolute;display:block}
.label{position:absolute;left:10px;bottom:10px;display:flex;align-items:center;gap:7px;
  padding:5px 11px 5px 6px;border-radius:999px;background:rgba(15,17,19,.82);
  font:700 15px/1 Archivo,sans-serif;letter-spacing:.01em}
.label .badge{width:22px;height:22px;font-size:14px}
#panel{flex:1;display:flex;flex-direction:column;gap:30px;padding:44px 42px 36px;
  background:#172624;border-left:1px solid ${HAIRLINE};position:relative}
#panel::before{content:'';position:absolute;left:0;top:0;bottom:0;width:4px;background:${accent}}
.brand{display:flex;align-items:center;gap:14px}
.brand-mark{display:grid;place-items:center;width:52px;height:52px;
  font:400 34px/1 Anton,sans-serif;color:#fff;background:${accent}}
.brand-name{font:400 22px/0.95 Anton,sans-serif;letter-spacing:.06em;text-transform:uppercase}
.task{display:grid;gap:14px;margin-top:auto}
.badges{display:flex;gap:8px}
.badge{display:grid;place-items:center;width:34px;height:34px;border-radius:50%;
  font:400 21px/1 Anton,sans-serif}
h1{font:400 62px/0.96 Anton,sans-serif;letter-spacing:.01em;text-wrap:balance}
.tagline{font-size:21px;color:${TEXT};opacity:.85;max-width:21ch}
footer{margin-top:auto;display:grid;gap:6px;font-size:14px;color:${MUTED}}
footer b{color:${TEXT};font:400 17px/1 Anton,sans-serif;letter-spacing:.04em}
</style>
<div id="map">${cells}</div>
<div id="panel">
  <div class="brand"><span class="brand-mark">M</span><span class="brand-name">Metro<br>Guesser</span></div>
  <div class="task">
    <span class="badges">${['A', 'B', 'C'].map(badge).join('')}</span>
    <h1>Kudy pod tím vede metro?</h1>
    <p class="tagline">${all.length} stanic z ptačí perspektivy. Nakresli osu nástupiště — nebo duel 1v1.</p>
  </div>
  <footer><b>kdejemetro.guth.workers.dev</b><span>ortofoto © ČÚZK</span></footer>
</div>`, 'og.png', OG_W, OG_H, 25000);
toJpeg('og.png', 'og.jpg', 78);

// ---------- ikony ----------

// Ikona je favicon bez zaoblení: iOS i Android si čtverec ořežou po svém a
// maskable navíc do kruhu, takže se M zmenší na 88 %, ať se vejde do safe zóny.
const iconSvg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32">
  <rect width="32" height="32" fill="${ICON_RED}"/>
  <path transform="translate(16 16) scale(.88) translate(-16 -16)"
    d="M7 24V8h4l5 8 5-8h4v16h-4v-9l-5 8-5-8v9z" fill="#fff"/>
</svg>`;

for (const [name, size] of [['icon-192.png', 192], ['icon-512.png', 512], ['apple-touch-icon.png', 180]]) {
  shot(`<meta charset="utf-8"><style>*{margin:0}svg{display:block;width:${size}px;height:${size}px}</style>${iconSvg}`,
    name, size, size, 8000);
}

rmSync(tmp, { recursive: true, force: true });
