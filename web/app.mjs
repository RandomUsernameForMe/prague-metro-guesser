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
let drawn = [], drawing = false; // drawn: [[px,py],...] v px stage
let lines = []; // tahy pro odeslání, [[lat,lng],...] per kolo

const sizePx = () => stage.clientWidth;
const vp = () => roundViewport(rounds[roundIdx]);

// markup níže je vždy statická šablona aplikace + čísla; DOMParser navíc nespouští skripty
const parseHtml = markup => [...new DOMParser().parseFromString(markup, 'text/html').body.childNodes];
const parseSvg = markup => [
  ...new DOMParser().parseFromString(
    `<svg xmlns="http://www.w3.org/2000/svg">${markup}</svg>`, 'image/svg+xml').documentElement.childNodes,
];

// ---------- kreslení ----------
function redraw(extra = '') {
  const pts = drawn.map(p => p.join(',')).join(' ');
  // jen číselné souřadnice z kliků — žádná externí data
  const markup =
    (drawn.length
      ? `<polyline points="${pts}" fill="none" stroke="var(--draw)" stroke-width="4" stroke-linecap="round" stroke-linejoin="round"/>` +
        drawn.map(([x, y]) => `<circle cx="${x}" cy="${y}" r="5" fill="var(--draw)"/>`).join('')
      : '') + extra;
  svg.replaceChildren(...parseSvg(markup));
  $('confirm').disabled = drawn.length < 2;
}

svg.addEventListener('pointerdown', e => {
  if (!overlay.hidden) return;
  hideHint();
  drawing = true;
  svg.setPointerCapture(e.pointerId);
  drawn.push([e.offsetX, e.offsetY]);
  redraw();
});
svg.addEventListener('pointermove', e => {
  if (!drawing) return;
  const [lx, ly] = drawn.at(-1);
  if (Math.hypot(e.offsetX - lx, e.offsetY - ly) > 12 && drawn.length < 200) {
    drawn.push([e.offsetX, e.offsetY]);
    redraw();
  }
});
svg.addEventListener('pointerup', () => { drawing = false; });

$('clear').onclick = () => { drawn = []; redraw(); };
$('home').onclick = () => showIntro();

function hideHint() {
  hintEl.hidden = true;
  localStorage.setItem(hintKey, '1');
}

// ---------- panel ----------
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
  $('round-label').textContent = mode === 'weekly'
    ? `kolo ${roundIdx + 1} z ${rounds.length} · týden ${week}`
    : 'trénink · bez zápisu do žebříčku';
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
  drawn = []; redraw();
  renderTiles(tilesEl, vp(), sizePx());
  paintPanel();
  overlay.hidden = true;
  $('clear').disabled = false;
  document.body.dataset.phase = mode; // 'weekly' | 'training' — v tréninku se skóre nesbírá
  if (!localStorage.getItem(hintKey)) {
    hintEl.textContent = 'Klikni nebo táhni přes snímek — nakresli, kudy stanice vede pod zemí.';
    hintEl.hidden = false;
  }
  // snímek dalšího kola natáhni dopředu, ať je přepnutí okamžité
  const next = mode === 'weekly' ? rounds[roundIdx + 1] : null;
  if (next) prefetchTiles(roundViewport(next), sizePx());
}

$('confirm').onclick = () => {
  const s = sizePx();
  const station = rounds[roundIdx].station;
  const line = drawn.map(([x, y]) => pxToLatLng(x, y, vp(), s));
  const { d, score } = scoreRound(line, station);
  if (mode === 'weekly') { lines.push(line); totalScore += score; setScore(totalScore); }
  hideHint();
  // reveal skutečných os v barvě linky (souřadnice = čísla z vlastních dat)
  const axesSvg = station.axes.map(axis => {
    const pts = axis.map(([lat, lng]) => latLngToPx(lat, lng, vp(), s).join(',')).join(' ');
    return `<polyline points="${pts}" fill="none" stroke="var(--accent)" stroke-width="5" stroke-linecap="round" stroke-dasharray="1000" stroke-dashoffset="1000" style="animation: reveal 1s forwards"/>`;
  }).join('');
  redraw(axesSvg + `<style>@keyframes reveal { to { stroke-dashoffset: 0; } }</style>`);
  setTimeout(() => showCard(`
    <p class="label">${mode === 'weekly' ? `kolo ${roundIdx + 1} z ${rounds.length}` : 'trénink'}</p>
    <h2></h2>
    <div class="big">+${score}</div>
    <p>Průměrná odchylka <strong>${Math.round(d)} m</strong> od skutečné osy stanice.</p>
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
      <li><b>2</b><div>Nakresli čáru, kudy podle tebe vede nástupiště.<br><span>Klikáním body, nebo táhni prstem či myší.</span></div></li>
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
