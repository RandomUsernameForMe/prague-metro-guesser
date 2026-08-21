// Kreslení úseček, letecké dlaždice a odpočet. O režimu hry nic neví —
// řízení si drží app.mjs (weekly/warmup/casual) a duel.mjs (duel).
import { renderTiles, prefetchTiles, pxToLatLng, latLngToPx } from './tiles.mjs';

const $ = id => document.getElementById(id);
const stage = $('stage'), tilesEl = $('tiles'), svg = $('draw'), overlay = $('overlay'), hintEl = $('hint');
const timebar = $('timebar'), clockEl = $('clock');
const hintKey = 'pmg-hint-seen';

let segs = [];          // hotové úsečky v px stage: [[[x,y],[x,y]], ...]
let anchor = null;      // začátek rozkreslené úsečky
let cursor = null;      // její aktuální konec (náhled)
let pressing = false;
let required = 1;
let viewport = null;
let onChange = null;
let axesExtra = '';     // osy, které mají zůstat i pod dalším kreslením

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

export function redraw(extra = axesExtra) {
  // jen číselné souřadnice z kliků — žádná externí data
  const markup = segs.map(s => segMarkup(s)).join('')
    + (anchor && cursor ? segMarkup([anchor, cursor], true) : '')
    + extra;
  svg.replaceChildren(...parseSvg(markup));
  onChange?.(segs.length, required);
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

// vp: {lat,lng,size} střed výřezu; req: kolik úseček kolo chce
export function setRound(vp, req) {
  viewport = vp;
  required = req;
  axesExtra = '';
  segs = []; anchor = cursor = null;
  renderTiles(tilesEl, vp, sizePx());
  redraw();
}

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
  redraw(rivalMarkup(rival) + axesMarkup(axes, true)
    + `<style>@keyframes reveal { to { stroke-dashoffset: 0; } }</style>`);
}

// osy zůstanou pod dalším kreslením jako předloha (hráč opravuje chybnou stanici)
export function keepAxes(axes) {
  axesExtra = axes ? axesMarkup(axes, false) : '';
  redraw();
}

// ---------- odpočet ----------
let timerRaf = null, deadline = 0, total = 0, expired = null;

export function timerStop() {
  if (timerRaf) cancelAnimationFrame(timerRaf);
  timerRaf = null;
  timebar.hidden = true;
  clockEl.hidden = true;
  timebar.classList.remove('urgent');
  clockEl.classList.remove('urgent');
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
    if (left <= 0) { timerRaf = null; expired?.(); return; }
    timerRaf = requestAnimationFrame(tick);
  };
  timerRaf = requestAnimationFrame(tick);
}

// shot clock: server řekl, kolik ms zbývá — hodiny klienta se neptáme
export function timerSetLeft(msLeft) {
  if (!timerRaf) return;
  deadline = performance.now() + msLeft;
}
