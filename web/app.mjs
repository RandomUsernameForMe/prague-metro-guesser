import { isoWeek, weeklyChallenge, practiceRounds, roundViewport } from './shared/seed.mjs';
import { scoreRound } from './shared/scoring.mjs';
import { renderTiles, prefetchTiles, pxToLatLng, latLngToPx } from './tiles.mjs';

const $ = id => document.getElementById(id);
const stage = $('stage'), tilesEl = $('tiles'), svg = $('draw'), overlay = $('overlay'), hintEl = $('hint');
const timebar = $('timebar'), clockEl = $('clock');

const stations = await (await fetch('stations.json')).json();
const week = isoWeek(new Date());
const playedKey = `pmg-played-${week}`;
const hintKey = 'pmg-hint-seen';

const SECONDS = { single: 20, transfer: 30 }; // přestup chce dvě úsečky, dostane víc času
const ROUNDS = 10;

// weekly: ostrá výzva se zápisem · warmup: 10 stanic mimo výzvu, na nečisto · casual: bez času a bez konce
let mode = 'weekly';
const timed = () => mode !== 'casual';
let rounds = [], roundIdx = 0, totalScore = 0;
// stanice metra je rovné nástupiště → hráč kreslí úsečky, jednu na každou linku stanice
let segs = [];          // hotové úsečky v px stage: [[[x,y],[x,y]], ...]
let anchor = null;      // začátek rozkreslené úsečky
let cursor = null;      // její aktuální konec (náhled)
let pressing = false;
let lines = [];         // tahy pro odeslání, [[[lat,lng],[lat,lng]], ...] per kolo

const required = () => rounds[roundIdx].station.lines.length;
const roundSeconds = () => (required() > 1 ? SECONDS.transfer : SECONDS.single);

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

// ---------- odpočet ----------
let timerRaf = null, deadline = 0;

function stopTimer() {
  if (timerRaf) cancelAnimationFrame(timerRaf);
  timerRaf = null;
  timebar.hidden = true;
  clockEl.hidden = true;
  timebar.classList.remove('urgent');
  clockEl.classList.remove('urgent');
}

function startTimer() {
  stopTimer();
  if (!timed()) return;
  const total = roundSeconds() * 1000;
  deadline = performance.now() + total;
  timebar.hidden = false;
  clockEl.hidden = false;
  const bar = timebar.firstElementChild;
  const tick = now => {
    const left = Math.max(0, deadline - now);
    bar.style.transform = `scaleX(${left / total})`;
    const secs = Math.ceil(left / 1000);
    $('clock-value').textContent = secs;
    const urgent = left <= 5000;
    timebar.classList.toggle('urgent', urgent);
    clockEl.classList.toggle('urgent', urgent);
    if (left <= 0) { timerRaf = null; finishRound(true); return; }
    timerRaf = requestAnimationFrame(tick);
  };
  timerRaf = requestAnimationFrame(tick);
}

// ---------- panel ----------
// zadání kola + kolik úseček ještě chybí
function updateTask() {
  if (!rounds.length) return;
  const st = rounds[roundIdx].station;
  const where = mode === 'casual' ? 'casual mode'
    : `${mode === 'warmup' ? 'rozehřátí' : 'kolo'} ${roundIdx + 1} z ${rounds.length}`;
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
  $('progress').replaceChildren(...(mode !== 'casual'
    ? Array.from({ length: rounds.length }, (_, i) => {
      const li = document.createElement('li');
      if (i < roundIdx) li.className = 'done';
      else if (i === roundIdx) li.className = 'now';
      return li;
    })
    : []));
  $('home').hidden = mode === 'weekly';
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
  document.body.dataset.phase = mode;
  if (!localStorage.getItem(hintKey)) {
    hintEl.textContent = 'Táhni přes snímek (nebo klikni dvakrát) — nakresli přímou osu nástupiště.';
    hintEl.hidden = false;
  }
  // snímek dalšího kola natáhni dopředu, ať je přepnutí okamžité
  const next = rounds[roundIdx + 1];
  if (next) prefetchTiles(roundViewport(next), sizePx());
  startTimer();
}

$('confirm').onclick = () => finishRound(false);

// timedOut: vypršel čas — co je nakresleno se počítá, neúplné kolo propadá za 0
function finishRound(timedOut) {
  stopTimer();
  const s = sizePx();
  const station = rounds[roundIdx].station;
  const forfeited = segs.length < required();
  if (timedOut && forfeited) return forfeitRound(station, s);

  const segments = segs.map(seg => seg.map(([x, y]) => pxToLatLng(x, y, vp(), s)));
  const { d, score, perLine } = scoreRound(segments, station);
  if (mode === 'weekly') { lines.push(segments); }
  if (mode !== 'casual') { totalScore += score; setScore(totalScore); }
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
  showResultCard(station, `+${score}`, timedOut ? `čas vypršel · ${detail}` : detail);
}

// vypršel čas a chybí úsečka → 0 bodů, ale osu ukaž (hráč se má co naučit)
function forfeitRound(station, s) {
  if (mode === 'weekly') lines.push(null);
  hideHint();
  segs = []; anchor = cursor = null;
  const axesSvg = station.axes.map(axis => {
    const pts = axis.pts.map(([lat, lng]) => latLngToPx(lat, lng, vp(), s).join(',')).join(' ');
    return `<polyline points="${pts}" fill="none" stroke="var(--${axis.line.toLowerCase()})" stroke-width="5" stroke-linecap="round" stroke-dasharray="1000" stroke-dashoffset="1000" style="animation: reveal 1s forwards"/>`;
  }).join('');
  redraw(axesSvg + `<style>@keyframes reveal { to { stroke-dashoffset: 0; } }</style>`);
  showResultCard(station, '0', required() > 1
    ? 'Čas vypršel — u přestupní stanice musíš stihnout obě úsečky.'
    : 'Čas vypršel — nestihl jsi nakreslit úsečku.');
}

function showResultCard(station, big, detail) {
  const where = mode === 'weekly' ? `kolo ${roundIdx + 1} z ${rounds.length}`
    : mode === 'warmup' ? `rozehřátí ${roundIdx + 1} z ${rounds.length}` : 'casual';
  setTimeout(() => showCard(`
    <p class="label">${where}</p>
    <h2></h2>
    <div class="big">${big}</div>
    <p>${detail}</p>
    <button class="btn btn-primary" id="next">${nextLabel()}</button>
    ${mode === 'casual' ? '<button class="link-btn" id="back">← zpět na začátek</button>' : ''}
  `, card => {
    card.querySelector('h2').textContent = station.name;
    $('next').onclick = advance;
    if (mode === 'casual') $('back').onclick = () => showIntro();
  }), 1200);
}

const nextLabel = () =>
  mode === 'casual' ? 'Další stanice'
    : roundIdx + 1 < rounds.length ? 'Další kolo'
      : mode === 'warmup' ? 'Vyhodnocení rozehřátí' : 'Vyhodnocení';

function advance() {
  if (mode === 'casual') { rounds = [randomRound()]; roundIdx = 0; startRound(); return; }
  roundIdx++;
  roundIdx < rounds.length ? startRound() : (mode === 'warmup' ? finishWarmup() : finish());
}

// ---------- konec rozehřátí ----------
function finishWarmup() {
  const played = localStorage.getItem(playedKey);
  const max = rounds.length * 1000;
  showCard(`
    <p class="label">rozehřátí · na nečisto</p>
    <h2>${totalScore.toLocaleString('cs')} z ${max.toLocaleString('cs')}</h2>
    <p>Tyhle stanice v týdenní výzvě nebudou — teď víš, na čem jsi.</p>
    ${played
      ? `<button class="btn btn-primary" id="again">Rozehřát znovu</button>
         <button class="btn btn-ghost" id="lb">Žebříček</button>`
      : `<button class="btn btn-primary" id="play">Hrát týdenní výzvu na ostro</button>
         <button class="btn btn-ghost" id="again">Ještě jednou na nečisto</button>`}
    <button class="link-btn" id="back">← zpět na začátek</button>
  `, () => {
    if (played) $('lb').onclick = () => showLeaderboard(played);
    else $('play').onclick = startWeekly;
    $('again').onclick = startWarmup;
    $('back').onclick = () => showIntro();
  });
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
    <button class="btn btn-ghost" id="train">Casual mode</button>
    <button class="link-btn" id="back">← zpět na začátek</button>
  `, () => {
    $('train').onclick = startCasual;
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

function startCasual() {
  mode = 'casual';
  rounds = [randomRound()]; roundIdx = 0;
  startRound();
}

// rozehřátí: 10 stanic, které v týdenní výzvě nepadnou
function startWarmup() {
  mode = 'warmup';
  const weeklyIds = new Set(weeklyChallenge(week, stations).map(r => r.station.id));
  rounds = practiceRounds(stations, ROUNDS, weeklyIds);
  roundIdx = 0; totalScore = 0;
  $('score-value').textContent = '0';
  startRound();
}

function startWeekly() {
  mode = 'weekly';
  rounds = weeklyChallenge(week, stations);
  roundIdx = 0; totalScore = 0; lines = [];
  $('score-value').textContent = '0';
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
  stopTimer(); // odpočet nikdy neběží pod otevřenou kartou
  // overlay kryje jen mapu — tlačítka v panelu se musí zamknout ručně
  $('confirm').disabled = true;
  $('clear').disabled = true;
  wire?.(card);
}

// ---------- úvod + tutoriál ----------
function showIntro() {
  const played = localStorage.getItem(playedKey);
  stopTimer();
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
      <li><b>2</b><div>Za ${SECONDS.single} sekund nakresli úsečku, kudy vede nástupiště.<br><span>Táhni prstem či myší, nebo klikni na začátek a konec. U přestupní stanice kreslíš úsečku pro každou linku a máš ${SECONDS.transfer} s. Nestihneš to → 0 bodů.</span></div></li>
      <li><b>3</b><div>Potvrdíš a uvidíš skutečnou osu kolejí.<br><span>Čím blíž jsi trefil, tím víc bodů — max 1000 za kolo.</span></div></li>
    </ol>
    ${played
      ? `<p>Týdenní výzvu už jsi tenhle týden odehrál jako <strong id="played-nick"></strong>.</p>
         <button class="btn btn-primary" id="warmup">Rozehřátí (${ROUNDS} stanic na nečisto)</button>
         <button class="btn btn-ghost" id="lb">Žebříček</button>`
      : `<button class="btn btn-primary" id="warmup">Rozehřátí — ${ROUNDS} stanic na nečisto</button>
         <button class="btn btn-ghost" id="play">Rovnou týdenní výzva na ostro</button>`}
    <button class="link-btn" id="casual">casual mode — bez času, bez konce, bez zápisu</button>
  `, card => {
    if (played) {
      card.querySelector('#played-nick').textContent = played;
      $('lb').onclick = () => showLeaderboard(played);
    } else {
      $('play').onclick = startWeekly;
    }
    $('warmup').onclick = startWarmup;
    $('casual').onclick = startCasual;
  });
}

// ---------- pozadí: fotky obkladů se střídají ----------
function startBackdrop(photos) {
  const layers = [document.createElement('div'), document.createElement('div')];
  $('bg').append(...layers);
  let i = Math.floor(Math.random() * photos.length), top = 0;
  const show = () => {
    const p = photos[i++ % photos.length];
    const img = new Image(); // ukaž až po načtení, ať se neprolíná do prázdna
    img.onload = () => {
      const next = layers[top ^= 1];
      next.style.backgroundImage = `url("bg/${p.file}")`;
      next.classList.add('on');
      layers[top ^ 1].classList.remove('on');
      const credit = $('photo-credit');
      credit.textContent = `foto ${p.author} / Wikimedia Commons, ${p.lic}`;
      credit.href = p.page;
    };
    img.src = `bg/${p.file}`;
  };
  show();
  setInterval(show, 14000);
}

// ---------- start ----------
fetch('bg/CREDITS.json').then(r => r.json()).then(startBackdrop);
renderTiles(tilesEl, { lat: 50.0755, lng: 14.4303 }, sizePx());
showIntro();
