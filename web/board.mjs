// Kreslení úseček, letecké dlaždice a odpočet. O režimu hry nic neví —
// řízení si drží app.mjs (weekly/warmup/casual) a duel.mjs (duel).
import { renderTiles, prefetchTiles, pxToLatLng, latLngToPx } from './tiles.mjs';

const $ = id => document.getElementById(id);
const stage = $('stage'), tilesEl = $('tiles'), svg = $('draw'), overlay = $('overlay'), hintEl = $('hint');
const transferEl = $('transfer');
const timebar = $('timebar'), clockEl = $('clock');
const hintKey = 'pmg-hint-seen';

let segs = [];          // hotové úsečky v px stage: [[[x,y],[x,y]], ...]
let anchor = null;      // začátek rozkreslené úsečky
let cursor = null;      // její aktuální konec (náhled)
let pressing = false;
let required = 1;
let viewport = null;
let onChange = null;
let lastSize = 0;       // hrana stage při posledním překreslení — podle ní se přepočítává resize
// co se kreslí pod hráčovy úsečky (osy, tip soupeře). Funkce, ne hotový string:
// souřadnice jsou v px, takže se po změně velikosti okna musí spočítat znovu.
let extra = () => '';
let revealed = false;   // osy odhalené = dokresleno, pruh o přestupu už nemá co říct

export const sizePx = () => stage.clientWidth;
export const count = () => segs.length;
export const segments = () => segs.map(seg => seg.map(([x, y]) => pxToLatLng(x, y, viewport, sizePx())));

const parseSvg = markup => [
  ...new DOMParser().parseFromString(
    `<svg xmlns="http://www.w3.org/2000/svg">${markup}</svg>`, 'image/svg+xml').documentElement.childNodes,
];

const segMarkup = ([[x1, y1], [x2, y2]], preview = false) =>
  `<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" stroke="var(--draw)" stroke-width="4"
     stroke-linecap="round"${preview ? ' stroke-dasharray="8 6" opacity="0.85"' : ''}/>` +
  `<circle cx="${x1}" cy="${y1}" r="5" fill="var(--draw)"/><circle cx="${x2}" cy="${y2}" r="5" fill="var(--draw)"/>`;

export function redraw() {
  // jen číselné souřadnice z kliků — žádná externí data
  const markup = segs.map(s => segMarkup(s)).join('')
    + (anchor && cursor ? segMarkup([anchor, cursor], true) : '')
    + extra();
  svg.replaceChildren(...parseSvg(markup));
  paintTransfer();
  onChange?.(segs.length, required);
}

// ---------- přestup: dvě úsečky ----------
// Na přestupu chce kolo jednu úsečku na každou linku. Popisek v panelu to
// hráči neřekl dost nahlas — půlka jich nakreslila jednu čáru a potvrdila.
// Pruh proto sedí přes snímek a drží se, dokud nejsou obě.
let countEl = null;

function buildTransfer(lines) {
  countEl = null;
  transferEl.replaceChildren();
  if (required < 2 || lines.length < 2) return paintTransfer();
  transferEl.style.setProperty('--l1', `var(--${lines[0].toLowerCase()})`);
  transferEl.style.setProperty('--l2', `var(--${lines[1].toLowerCase()})`);

  const badges = document.createElement('span');
  badges.className = 'transfer-badges';
  for (const l of lines) {
    const b = document.createElement('span');
    b.className = `badge ${l}`;
    b.textContent = l;
    badges.append(b);
  }
  const head = document.createElement('strong');
  head.textContent = `Přestup — ${required} úsečky!`;
  const sub = document.createElement('small');
  sub.textContent = `jednu pro ${lines[0]}, druhou pro ${lines[1]}`;
  const text = document.createElement('span');
  text.className = 'transfer-text';
  text.append(head, sub);

  countEl = document.createElement('span');
  countEl.className = 'transfer-count';
  transferEl.replaceChildren(badges, text, countEl);
  paintTransfer();
}

function paintTransfer() {
  transferEl.hidden = !countEl || revealed;
  if (transferEl.hidden) return;
  const done = Math.min(segs.length, required);
  countEl.textContent = `${done}/${required}`;
  transferEl.classList.toggle('full', done >= required);
}

function commitSegment(a, b) {
  if (segs.length >= required) segs[segs.length - 1] = [a, b]; // další tah přepíše poslední úsečku
  else segs.push([a, b]);
}

svg.addEventListener('pointerdown', e => {
  if (!overlay.hidden) return;
  hideHint(true);
  svg.setPointerCapture(e.pointerId);
  const p = [e.offsetX, e.offsetY];
  if (anchor) { commitSegment(anchor, p); anchor = cursor = null; }  // druhý klik dokončí úsečku
  else { anchor = p; cursor = p; pressing = true; }
  redraw();
});
svg.addEventListener('pointermove', e => {
  if (!anchor) return;
  cursor = [e.offsetX, e.offsetY];
  redraw();
});
svg.addEventListener('pointerup', () => {
  // tah = hotová úsečka; pouhé kliknutí nechá začátek viset a čeká na druhý klik
  if (pressing && anchor && cursor && Math.hypot(cursor[0] - anchor[0], cursor[1] - anchor[1]) > 10) {
    commitSegment(anchor, cursor);
    anchor = cursor = null;
  }
  pressing = false;
  redraw();
});

$('clear').onclick = () => clear();

export function clear() {
  segs = []; anchor = cursor = null;
  redraw();
}

export function onSegmentsChange(cb) { onChange = cb; }

// vp: {lat,lng,size} střed výřezu; req: kolik úseček kolo chce; lines: linky stanice
export function setRound(vp, req, lines = []) {
  viewport = vp;
  required = req;
  extra = () => '';
  revealed = false;
  segs = []; anchor = cursor = null;
  lastSize = sizePx();
  buildTransfer(lines);
  renderTiles(tilesEl, vp, lastSize);
  redraw();
}

// Otočení telefonu mění hranu stage, ale úsečky i dlaždice jsou v px té staré.
// Bez přepočtu by kresba ujela od mapy, takže se všechno přeškáluje poměrem stran.
// Tažení za roh okna sype resize dávkami — dlaždice tahá až ten poslední.
let resizeTimer = null;
addEventListener('resize', () => {
  clearTimeout(resizeTimer);
  resizeTimer = setTimeout(() => {
    const size = sizePx();
    if (!viewport || !size || !lastSize || size === lastSize) return;
    const k = size / lastSize;
    const scale = ([x, y]) => [x * k, y * k];
    segs = segs.map(seg => seg.map(scale));
    if (anchor) anchor = scale(anchor);
    if (cursor) cursor = scale(cursor);
    lastSize = size;
    renderTiles(tilesEl, viewport, size);
    redraw();
  }, 150);
});

export function prefetch(vp) { prefetchTiles(vp, sizePx()); }

// remember = hráč nápovědu opravdu viděl a už ji nikdy nechceme; bez něj se jen schová
export function hideHint(remember = false) {
  hintEl.hidden = true;
  if (remember) localStorage.setItem(hintKey, '1');
}

export function maybeShowHint() {
  if (localStorage.getItem(hintKey)) return;
  hintEl.textContent = 'Táhni přes snímek (nebo klikni dvakrát) — nakresli přímou osu nástupiště.';
  hintEl.hidden = false;
}

// osy stanice, každá v barvě své linky; animate = najet zleva doprava
const axesMarkup = (axes, animate) => axes.map(axis => {
  const pts = axis.pts.map(([lat, lng]) => latLngToPx(lat, lng, viewport, sizePx()).join(',')).join(' ');
  const reveal = animate
    ? ' stroke-dasharray="1000" stroke-dashoffset="1000" style="animation: reveal 1s forwards"'
    : ' opacity="0.5"'; // jen reference pod kreslením — nesmí přebít hráčovu úsečku
  return `<polyline points="${pts}" fill="none" stroke="var(--${axis.line.toLowerCase()})"
            stroke-width="5" stroke-linecap="round"${reveal}/>`;
}).join('');

// soupeřův tip: úsečky v lat/lng, čárkovaně a v jiné barvě než hráčova čára
const rivalMarkup = segs => (segs ?? []).map(seg => {
  const [[x1, y1], [x2, y2]] = seg.map(([lat, lng]) => latLngToPx(lat, lng, viewport, sizePx()));
  return `<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" stroke="var(--rival)" stroke-width="4"
            stroke-linecap="round" stroke-dasharray="10 7" opacity="0.9"/>`;
}).join('');

// dokreslí skutečné osy po potvrzení kola, případně i tip soupeře
export function revealAxes(axes, rival) {
  revealed = true;
  extra = () => rivalMarkup(rival) + axesMarkup(axes, true)
    + `<style>@keyframes reveal { to { stroke-dashoffset: 0; } }</style>`;
  redraw();
}

// osy zůstanou pod dalším kreslením jako předloha (hráč opravuje chybnou stanici)
export function keepAxes(axes) {
  revealed = false;              // hráč zase kreslí, pruh o přestupu se vrací
  extra = axes ? () => axesMarkup(axes, false) : () => '';
  redraw();
}

// ---------- odpočet ----------
let timerRaf = null, timerTimeout = null, deadline = 0, total = 0, expired = null;

export function timerStop() {
  if (timerRaf) cancelAnimationFrame(timerRaf);
  clearTimeout(timerTimeout);
  timerRaf = timerTimeout = null;
  timebar.hidden = true;
  clockEl.hidden = true;
  timebar.classList.remove('urgent');
  clockEl.classList.remove('urgent');
}

// vypršení musí padnout právě jednou, ať přijde z rAF nebo ze záložního timeoutu
function fire() {
  const onExpire = expired;
  timerStop();
  onExpire?.();
}

// totalMs: plná délka kola. onExpire se zavolá, až doběhne.
export function timerStart(totalMs, onExpire) {
  timerStop();
  total = totalMs;
  deadline = performance.now() + totalMs;
  expired = onExpire;
  timebar.hidden = false;
  clockEl.hidden = false;
  const bar = timebar.firstElementChild;
  const tick = now => {
    const left = Math.max(0, deadline - now);
    bar.style.transform = `scaleX(${left / total})`;   // pruh se poměřuje s původní délkou kola,
    $('clock-value').textContent = Math.ceil(left / 1000); // takže při shot clocku viditelně skočí dolů
    const urgent = left <= 5000;
    timebar.classList.toggle('urgent', urgent);
    clockEl.classList.toggle('urgent', urgent);
    if (left <= 0) return fire();
    timerRaf = requestAnimationFrame(tick);
  };
  timerRaf = requestAnimationFrame(tick);
  timerTimeout = setTimeout(fire, totalMs); // rAF na skryté kartě stojí, kolo by nikdy nedoběhlo
}

// shot clock: server řekl, kolik ms zbývá — hodiny klienta se neptáme
export function timerSetLeft(msLeft) {
  if (!timerRaf) return;
  deadline = performance.now() + msLeft;
  clearTimeout(timerTimeout);
  timerTimeout = setTimeout(fire, msLeft);
}
