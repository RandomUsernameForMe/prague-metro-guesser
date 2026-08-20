import { isoWeek, weeklyChallenge, roundViewport } from './shared/seed.mjs';
import { scoreRound } from './shared/scoring.mjs';
import { renderTiles, prefetchTiles, pxToLatLng, latLngToPx } from './tiles.mjs';

const $ = id => document.getElementById(id);
const stage = $('stage'), tilesEl = $('tiles'), svg = $('draw'), overlay = $('overlay'), hintEl = $('hint');

const stations = await (await fetch('stations.json')).json();
const week = isoWeek(new Date());
const playedKey = `pmg-played-${week}`;
const hintKey = 'pmg-hint-seen';

let mode = 'weekly'; // 'weekly' | 'training'
let rounds = [], roundIdx = 0, totalScore = 0;
// stanice metra je rovné nástupiště → hráč kreslí úsečky, jednu na každou linku stanice
let segs = [];          // hotové úsečky v px stage: [[[x,y],[x,y]], ...]
let anchor = null;      // začátek rozkreslené úsečky
let cursor = null;      // její aktuální konec (náhled)
let pressing = false;
let lines = [];         // tahy pro odeslání, [[[lat,lng],[lat,lng]], ...] per kolo

const required = () => rounds[roundIdx].station.lines.length;

const sizePx = () => stage.clientWidth;
const vp = () => roundViewport(rounds[roundIdx]);

// markup níže je vždy statická šablona aplikace + čísla; DOMParser navíc nespouští skripty
const parseHtml = markup => [...new DOMParser().parseFromString(markup, 'text/html').body.childNodes];
const parseSvg = markup => [
  ...new DOMParser().parseFromString(
    `<svg xmlns="http://www.w3.org/2000/svg">${markup}</svg>`, 'image/svg+xml').documentElement.childNodes,
];

// ---------- kreslení úseček ----------
const segMarkup = ([[x1, y1], [x2, y2]], preview = false) =>
  `<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" stroke="var(--draw)" stroke-width="4"
     stroke-linecap="round"${preview ? ' stroke-dasharray="8 6" opacity="0.85"' : ''}/>` +
  `<circle cx="${x1}" cy="${y1}" r="5" fill="var(--draw)"/><circle cx="${x2}" cy="${y2}" r="5" fill="var(--draw)"/>`;

function redraw(extra = '') {
  // jen číselné souřadnice z kliků — žádná externí data
  const markup = segs.map(s => segMarkup(s)).join('')
    + (anchor && cursor ? segMarkup([anchor, cursor], true) : '')
    + extra;
  svg.replaceChildren(...parseSvg(markup));
  $('confirm').disabled = segs.length < required();
  updateTask();
}

function commitSegment(a, b) {
  if (segs.length >= required()) segs[segs.length - 1] = [a, b]; // další tah přepíše poslední úsečku
  else segs.push([a, b]);
}

svg.addEventListener('pointerdown', e => {
  if (!overlay.hidden) return;
  hideHint();
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

$('clear').onclick = () => { segs = []; anchor = cursor = null; redraw(); };
$('home').onclick = () => showIntro();

function hideHint() {
  hintEl.hidden = true;
  localStorage.setItem(hintKey, '1');
}

// ---------- panel ----------
// zadání kola + kolik úseček ještě chybí
function updateTask() {
  if (!rounds.length) return;
  const st = rounds[roundIdx].station;
  const where = mode === 'weekly' ? `kolo ${roundIdx + 1} z ${rounds.length}` : 'trénink';
  const task = st.lines.length > 1
    ? `přestup ${st.lines.join('+')} · nakresli ${st.lines.length} úsečky (${segs.length}/${st.lines.length})`
    : 'nakresli osu nástupiště jednou úsečkou';
  $('round-label').textContent = `${where} · ${task}`;
}

function paintPanel() {
  const st = rounds[roundIdx].station;
  document.documentElement.style.setProperty('--accent', `var(--${st.lines[0].toLowerCase()})`);
  document.documentElement.style.setProperty('--on-accent', st.lines[0] === 'B' ? '#1a1400' : '#fff');
  $('station-name').textContent = st.name;
  $('line-badges').replaceChildren(...st.lines.map(l => {
    const b = document.createElement('span');
    b.className = `badge ${l}`;
    b.textContent = l;
    return b;
  }));
  updateTask();
  $('progress').replaceChildren(...(mode === 'weekly'
    ? Array.from({ length: rounds.length }, (_, i) => {
      const li = document.createElement('li');
      if (i < roundIdx) li.className = 'done';
      else if (i === roundIdx) li.className = 'now';
      return li;
    })
    : []));
  $('home').hidden = mode !== 'training';
}

// krátký dopočet skóre, ať číslo neskočí
function setScore(to) {
  const el = $('score-value');
  const from = Number(el.textContent.replace(/\s/g, '')) || 0;
  const start = performance.now();
  const tick = now => {
    const t = Math.min(1, (now - start) / 500);
    const v = Math.round(from + (to - from) * (1 - (1 - t) ** 3));
    el.textContent = v.toLocaleString('cs');
    if (t < 1) requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
}

// ---------- kola ----------
function startRound() {
  segs = []; anchor = cursor = null;
  redraw();
  renderTiles(tilesEl, vp(), sizePx());
  paintPanel();
  overlay.hidden = true;
  $('clear').disabled = false;
  document.body.dataset.phase = mode; // 'weekly' | 'training' — v tréninku se skóre nesbírá
  if (!localStorage.getItem(hintKey)) {
    hintEl.textContent = 'Táhni přes snímek (nebo klikni dvakrát) — nakresli přímou osu nástupiště.';
    hintEl.hidden = false;
  }
  // snímek dalšího kola natáhni dopředu, ať je přepnutí okamžité
  const next = mode === 'weekly' ? rounds[roundIdx + 1] : null;
  if (next) prefetchTiles(roundViewport(next), sizePx());
}

$('confirm').onclick = () => {
  const s = sizePx();
  const station = rounds[roundIdx].station;
  const segments = segs.map(seg => seg.map(([x, y]) => pxToLatLng(x, y, vp(), s)));
  const { d, score, perLine } = scoreRound(segments, station);
  if (mode === 'weekly') { lines.push(segments); totalScore += score; setScore(totalScore); }
  hideHint();
  // reveal skutečných os, každá v barvě své linky (souřadnice = čísla z vlastních dat)
  const axesSvg = station.axes.map(axis => {
    const pts = axis.pts.map(([lat, lng]) => latLngToPx(lat, lng, vp(), s).join(',')).join(' ');
    return `<polyline points="${pts}" fill="none" stroke="var(--${axis.line.toLowerCase()})" stroke-width="5" stroke-linecap="round" stroke-dasharray="1000" stroke-dashoffset="1000" style="animation: reveal 1s forwards"/>`;
  }).join('');
  redraw(axesSvg + `<style>@keyframes reveal { to { stroke-dashoffset: 0; } }</style>`);
  const detail = perLine.length > 1
    ? perLine.map(r => `linka ${r.line}: ${Math.round(r.d)} m`).join(' · ')
    : `odchylka ${Math.round(d)} m od skutečné osy`;
  setTimeout(() => showCard(`
    <p class="label">${mode === 'weekly' ? `kolo ${roundIdx + 1} z ${rounds.length}` : 'trénink'}</p>
    <h2></h2>
    <div class="big">+${score}</div>
    <p>${detail}</p>
    <button class="btn btn-primary" id="next">${nextLabel()}</button>
    ${mode === 'training' ? '<button class="link-btn" id="back">← zpět na začátek</button>' : ''}
  `, card => {
    card.querySelector('h2').textContent = station.name;
    $('next').onclick = advance;
    if (mode === 'training') $('back').onclick = () => showIntro();
  }), 1200);
};

const nextLabel = () =>
  mode === 'training' ? 'Další stanice' : roundIdx + 1 < rounds.length ? 'Další kolo' : 'Vyhodnocení';

function advance() {
  if (mode === 'training') { rounds = [randomRound()]; roundIdx = 0; startRound(); return; }
  roundIdx++;
  roundIdx < rounds.length ? startRound() : finish();
}

// ---------- konec + odeslání ----------
function finish() {
  $('progress').replaceChildren(...Array.from({ length: rounds.length }, () => {
    const li = document.createElement('li');
    li.className = 'done';
    return li;
  }));
  showCard(`
    <p class="label">týden ${week} · hotovo</p>
    <h2>Konečné skóre</h2>
    <div class="big">${totalScore.toLocaleString('cs')}</div>
    <p>z ${(rounds.length * 1000).toLocaleString('cs')} možných</p>
    <input id="nick" maxlength="16" placeholder="přezdívka (3–16 znaků)">
    <p class="error" id="submit-err"></p>
    <button class="btn btn-primary" id="submit">Zapsat do žebříčku</button>
    <button class="link-btn" id="skip">přeskočit</button>
  `, () => {
    $('submit').onclick = submitScore;
    $('skip').onclick = () => showLeaderboard();
  });
}

async function submitScore() {
  const nick = $('nick').value.trim();
  $('submit-err').textContent = '';
  try {
    const res = await fetch('/api/score', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ week, nick, lines }),
    });
    const data = await res.json();
    if (!res.ok) {
      $('submit-err').textContent = data.error === 'nick' ? 'Neplatná přezdívka (3–16 znaků)' : data.error;
      return;
    }
    localStorage.setItem(playedKey, nick);
    showLeaderboard(nick);
  } catch {
    $('submit-err').textContent = 'Odeslání selhalo — zkus znovu';
  }
}

async function showLeaderboard(me) {
  showCard(`
    <p class="label">žebříček</p>
    <h2>Týden ${week}</h2>
    <div id="lb-list"><p>Načítám…</p></div>
    <button class="btn btn-ghost" id="train">Trénovat dál</button>
    <button class="link-btn" id="back">← zpět na začátek</button>
  `, () => {
    $('train').onclick = startTraining;
    $('back').onclick = () => showIntro();
  });
  const box = $('lb-list');
  try {
    const { entries } = await (await fetch(`/api/leaderboard?week=${week}`)).json();
    if (!entries.length) { box.firstElementChild.textContent = 'Tenhle týden zatím nikdo nehrál. Jsi první!'; return; }
    const ol = document.createElement('ol');
    ol.className = 'board';
    entries.forEach((e, i) => {
      const li = document.createElement('li');
      if (e.nick === me) li.className = 'me';
      const rank = document.createElement('span');
      rank.className = 'rank';
      rank.textContent = `${i + 1}.`;
      const nick = document.createElement('span');
      nick.textContent = e.nick; // nick je nedůvěryhodný → jen textContent
      const score = document.createElement('span');
      score.textContent = `${e.score.toLocaleString('cs')} b.`;
      li.append(rank, nick, score);
      ol.appendChild(li);
    });
    box.replaceChildren(ol);
  } catch {
    box.firstElementChild.textContent = 'Žebříček se nepodařilo načíst.';
  }
}

// ---------- režimy ----------
function randomRound() {
  const station = stations[Math.floor(Math.random() * stations.length)];
  return { station, u: 0.15 + Math.random() * 0.7, v: 0.15 + Math.random() * 0.7 };
}

function startTraining() {
  mode = 'training';
  rounds = [randomRound()]; roundIdx = 0;
  startRound();
}

function startWeekly() {
  mode = 'weekly';
  rounds = weeklyChallenge(week, stations);
  roundIdx = 0; totalScore = 0; lines = [];
  setScore(0); $('score-value').textContent = '0';
  startRound();
}

// ---------- helpers ----------
function showCard(staticHtml, wire) {
  const card = document.createElement('div');
  card.className = 'card';
  card.append(...parseHtml(staticHtml));
  overlay.replaceChildren(card);
  overlay.hidden = false;
  hintEl.hidden = true;
  // overlay kryje jen mapu — tlačítka v panelu se musí zamknout ručně
  $('confirm').disabled = true;
  $('clear').disabled = true;
  wire?.(card);
}

// ---------- úvod + tutoriál ----------
function showIntro() {
  const played = localStorage.getItem(playedKey);
  document.body.dataset.phase = 'intro';
  $('station-name').textContent = 'Kde vede metro?';
  $('line-badges').replaceChildren();
  $('round-label').textContent = 'týdenní výzva o 10 stanicích';
  $('progress').replaceChildren();
  $('home').hidden = true;
  $('confirm').disabled = true;
  showCard(`
    <p class="label">pražské metro · týden ${week}</p>
    <h2>Metro Guesser</h2>
    <ol class="steps">
      <li><b>1</b><div>Dostaneš letecký snímek 600 × 600 m a jméno stanice.<br><span>Stanice je někde uvnitř, ale pod zemí ji nevidíš.</span></div></li>
      <li><b>2</b><div>Nakresli úsečku, kudy vede nástupiště.<br><span>Táhni prstem či myší, nebo klikni na začátek a konec. U přestupní stanice kreslíš úsečku pro každou linku.</span></div></li>
      <li><b>3</b><div>Potvrdíš a uvidíš skutečnou osu kolejí.<br><span>Čím blíž jsi trefil, tím víc bodů — max 1000 za kolo.</span></div></li>
    </ol>
    ${played
      ? `<p>Týdenní výzvu už jsi tenhle týden odehrál jako <strong id="played-nick"></strong>.</p>
         <button class="btn btn-primary" id="lb">Žebříček</button>
         <button class="btn btn-ghost" id="train">Trénink</button>`
      : `<button class="btn btn-primary" id="play">Hrát týdenní výzvu</button>
         <button class="btn btn-ghost" id="train">Trénink bez zápisu</button>`}
  `, card => {
    if (played) {
      card.querySelector('#played-nick').textContent = played;
      $('lb').onclick = () => showLeaderboard(played);
    } else {
      $('play').onclick = startWeekly;
    }
    $('train').onclick = startTraining;
  });
}

// ---------- start ----------
renderTiles(tilesEl, { lat: 50.0755, lng: 14.4303 }, sizePx());
showIntro();
