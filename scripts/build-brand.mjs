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
import { layout, latLngToPx } from '../web/tiles.mjs';

const web = fileURLToPath(new URL('../web/', import.meta.url));
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';

// stanice pro OG: náměstí Míru je z ptačí perspektivy nezaměnitelné (kostel
// sv. Ludmily uprostřed radiálního náměstí) a osa vede přes celé náměstí
const STATION = 'Náměstí Míru';
const MAP = 630;                       // hrana leteckého čtverce = výška OG
const OG_W = 1200, OG_H = 630;

const LINE = { A: '#009f4d', B: '#ffd400', C: '#d6001c' };
const CONCRETE = '#0f1113', TEXT = '#eef1f3', MUTED = '#8c969e', HAIRLINE = '#2c3238';
const DRAW = '#ff2d6f';                // hráčova čára, stejně jako ve hře
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

const station = JSON.parse(readFileSync(join(web, 'stations.json'), 'utf8'))
  .find(s => s.name === STATION);
if (!station) throw new Error(`stanice ${STATION} není ve stations.json`);

const vp = { lat: station.lat, lng: station.lng };
const tiles = layout(vp, MAP)
  .map(t => `<img src="${t.url}" style="left:${t.left}px;top:${t.top}px;width:${t.w}px;height:${t.h}px">`)
  .join('');

// skutečná osa nástupiště, tak jak ji hra odhalí po potvrzení tipu
const axis = station.axes[0];
const truth = axis.pts.map(([lat, lng]) => latLngToPx(lat, lng, vp, MAP));

// hráčův tip: osa pootočená, protaženou a posunutá — ať je vidět, že se trefil těsně vedle
const rot = -13 * Math.PI / 180, stretch = 1.18, shift = [14, -34];
const cx = (truth[0][0] + truth[1][0]) / 2, cy = (truth[0][1] + truth[1][1]) / 2;
const guess = truth.map(([x, y]) => {
  const [dx, dy] = [(x - cx) * stretch, (y - cy) * stretch];
  return [cx + shift[0] + dx * Math.cos(rot) - dy * Math.sin(rot),
          cy + shift[1] + dx * Math.sin(rot) + dy * Math.cos(rot)];
});
const seg = ([[x1, y1], [x2, y2]]) =>
  `<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" stroke="${DRAW}" stroke-width="5" stroke-linecap="round"/>
   <circle cx="${x1}" cy="${y1}" r="6" fill="${DRAW}"/><circle cx="${x2}" cy="${y2}" r="6" fill="${DRAW}"/>`;

const accent = LINE[axis.line];
const badges = station.lines.map(l =>
  `<span class="badge" style="background:${LINE[l]};color:${l === 'B' ? '#1a1400' : '#fff'}">${l}</span>`).join('');

shot(`<meta charset="utf-8"><style>
${family('Anton', 400, 'anton')}
${family('Archivo', '500 800', 'archivo')}
*{margin:0;box-sizing:border-box}
body{width:${OG_W}px;height:${OG_H}px;display:flex;overflow:hidden;
  background:#0e1b17;color:${TEXT};font:600 16px/1.45 Archivo,sans-serif}
#map{position:relative;width:${MAP}px;height:${MAP}px;flex:none;background:${CONCRETE}}
#map img{position:absolute;display:block}
#map svg{position:absolute;inset:0;width:100%;height:100%}
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
h1{font:400 58px/0.98 Anton,sans-serif;letter-spacing:.01em;text-wrap:balance}
.tagline{font-size:21px;color:${TEXT};opacity:.85;max-width:19ch}
footer{margin-top:auto;display:grid;gap:6px;font-size:14px;color:${MUTED}}
footer b{color:${TEXT};font:400 17px/1 Anton,sans-serif;letter-spacing:.04em}
</style>
<div id="map">${tiles}
  <svg viewBox="0 0 ${MAP} ${MAP}">
    ${seg(guess)}
    <polyline points="${truth.map(p => p.join(',')).join(' ')}" fill="none"
      stroke="${accent}" stroke-width="6" stroke-linecap="round"/>
  </svg>
</div>
<div id="panel">
  <div class="brand"><span class="brand-mark">M</span><span class="brand-name">Metro<br>Guesser</span></div>
  <div class="task">
    <span class="badges">${badges}</span>
    <h1>${STATION}</h1>
    <p class="tagline">Nakresli, kudy pod tím vede nástupiště.</p>
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
