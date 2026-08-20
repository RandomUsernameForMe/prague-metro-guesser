import { isoWeek, weeklyChallenge, roundViewport } from './shared/seed.mjs';
import { scoreRound } from './shared/scoring.mjs';
import { renderTiles, pxToLatLng, latLngToPx } from './tiles.mjs';

const $ = id => document.getElementById(id);
const stage = $('stage'), tilesEl = $('tiles'), svg = $('draw'), overlay = $('overlay');

const stations = await (await fetch('stations.json')).json();
const week = isoWeek(new Date());
const playedKey = `pmg-played-${week}`;

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
      ? `<polyline points="${pts}" fill="none" stroke="var(--line)" stroke-width="4" stroke-linecap="round" stroke-linejoin="round"/>` +
        drawn.map(([x, y]) => `<circle cx="${x}" cy="${y}" r="5" fill="var(--line)"/>`).join('')
      : '') + extra;
  svg.replaceChildren(...parseSvg(markup));
  $('confirm').disabled = drawn.length < 2;
}

svg.addEventListener('pointerdown', e => {
  if (!overlay.hidden) return;
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

// ---------- kola ----------
function startRound() {
  drawn = []; redraw();
  renderTiles(tilesEl, vp(), sizePx());
  $('hud-station').textContent = rounds[roundIdx].station.name;
  $('hud-round').textContent = mode === 'weekly' ? `${roundIdx + 1}/${rounds.length}` : 'trénink';
  $('hud-score').textContent = mode === 'weekly' ? `${totalScore} b.` : '';
  overlay.hidden = true;
}

$('confirm').onclick = () => {
  const s = sizePx();
  const line = drawn.map(([x, y]) => pxToLatLng(x, y, vp(), s));
  const { d, score } = scoreRound(line, rounds[roundIdx].station);
  if (mode === 'weekly') { lines.push(line); totalScore += score; }
  // reveal skutečných os (souřadnice = čísla z vlastních dat)
  const axesSvg = rounds[roundIdx].station.axes.map(axis => {
    const pts = axis.map(([lat, lng]) => latLngToPx(lat, lng, vp(), s).join(',')).join(' ');
    return `<polyline points="${pts}" fill="none" stroke="var(--truth)" stroke-width="5" stroke-linecap="round" stroke-dasharray="1000" stroke-dashoffset="1000" style="animation: reveal 1s forwards"/>`;
  }).join('');
  redraw(axesSvg + `<style>@keyframes reveal { to { stroke-dashoffset: 0; } }</style>`);
  $('hud-score').textContent = mode === 'weekly' ? `${totalScore} b.` : '';
  const name = rounds[roundIdx].station.name;
  setTimeout(() => showPanel(`
    <h2></h2>
    <div class="big">+${score}</div>
    <p class="muted">průměrná odchylka ${Math.round(d)} m</p>
    <button class="btn-primary" id="next">${nextLabel()}</button>
  `, panel => {
    panel.querySelector('h2').textContent = name;
    $('next').onclick = advance;
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
  showPanel(`
    <h2>Hotovo!</h2>
    <div class="big">${totalScore} b.</div>
    <p>z ${rounds.length * 1000} možných</p>
    <input id="nick" maxlength="16" placeholder="přezdívka (3–16 znaků)">
    <p class="error" id="submit-err"></p>
    <button class="btn-primary" id="submit">Zapsat na leaderboard</button>
    <button class="btn-ghost" id="skip">Přeskočit</button>
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
  showPanel(`
    <h2>Týden ${week}</h2>
    <div id="lb-list"><p class="muted">Načítám…</p></div>
    <button class="btn-ghost" id="train">Trénink</button>
  `, () => { $('train').onclick = startTraining; });
  const box = $('lb-list');
  try {
    const { entries } = await (await fetch(`/api/leaderboard?week=${week}`)).json();
    if (!entries.length) { box.firstElementChild.textContent = 'Tenhle týden zatím nikdo nehrál. Jsi první!'; return; }
    const ol = document.createElement('ol');
    for (const e of entries) {
      const li = document.createElement('li');
      li.textContent = `${e.nick} — ${e.score} b.`; // nick je nedůvěryhodný → jen textContent
      if (e.nick === me) li.className = 'me';
      ol.appendChild(li);
    }
    box.replaceChildren(ol);
  } catch {
    box.firstElementChild.textContent = 'Leaderboard se nepodařilo načíst.';
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
  startRound();
}

// ---------- helpers ----------
function showPanel(staticHtml, wire) {
  const panel = document.createElement('div');
  panel.className = 'panel';
  panel.append(...parseHtml(staticHtml));
  overlay.replaceChildren(panel);
  overlay.hidden = false;
  wire?.(panel);
}

// ---------- start ----------
renderTiles(tilesEl, { lat: 50.0755, lng: 14.4303 }, sizePx());
if (localStorage.getItem(playedKey)) {
  showPanel(`
    <h2>Metro Guesser</h2>
    <p>Týdenní výzvu ${week} už jsi odehrál.</p>
    <button class="btn-primary" id="lb">Leaderboard</button>
    <button class="btn-ghost" id="train">Trénink</button>
  `, () => {
    $('lb').onclick = () => showLeaderboard(localStorage.getItem(playedKey));
    $('train').onclick = startTraining;
  });
} else {
  showPanel(`
    <h2>Metro Guesser</h2>
    <p>Uvidíš letecký snímek a jméno stanice metra. Nakresli čárou, kudy pod zemí vede. 10 stanic, jeden pokus týdně.</p>
    <button class="btn-primary" id="play">Hrát týdenní výzvu</button>
    <button class="btn-ghost" id="train">Trénink</button>
  `, () => {
    $('play').onclick = startWeekly;
    $('train').onclick = startTraining;
  });
}
