import { isoWeek, weeklyChallenge, practiceRounds, roundViewport } from './shared/seed.mjs';
import { scoreRound } from './shared/scoring.mjs';
import * as board from './board.mjs';
import { initDuel, findOpponent, hostDuel, joinDuel } from './duel.mjs';
import {
  hardcoreRound, hardcoreViewport, nextLives, LIVES_MAX, LOSE_M, GAIN_M, MAX_ROUNDS,
} from './shared/hardcore.mjs';

const $ = id => document.getElementById(id);
const overlay = $('overlay');

board.onSegmentsChange((n, req) => {
  $('confirm').disabled = n < req;
  updateTask();
});

const stations = await (await fetch('stations.json')).json();
const week = isoWeek(new Date());
const playedKey = `pmg-played-${week}`;

// pseudonymní ID pro statistiky — nic osobního, hráč ho smaže vyčištěním localStorage
let session = localStorage.getItem('pmg-session');
if (!session) localStorage.setItem('pmg-session', (session = crypto.randomUUID()));

const SECONDS = { single: 20, transfer: 30 }; // přestup chce dvě úsečky, dostane víc času
// hardcore ubírá i čas; přestup si drží stejný poměr, dvě úsečky za 15 s nejdou
const HARDCORE_SECONDS = { single: 15, transfer: 22 };
const secondsOf = tab => (tab === 'hardcore' ? HARDCORE_SECONDS : SECONDS);
const ROUNDS = 10;

// weekly: ostrá výzva se zápisem · warmup: 10 stanic mimo výzvu, na nečisto · casual: bez času a bez konce
let mode = 'weekly';
const timed = () => mode !== 'casual';
let rounds = [], roundIdx = 0, totalScore = 0;
let lines = [];         // tahy pro odeslání, [[[lat,lng],[lat,lng]], ...] per kolo

// hardcore: seed určuje celý run, hcRun se na konci pošle serveru k přepočtu
let hcSeed = 0, hcRun = [], lives = LIVES_MAX, lostThisRound = false;
const hcBestKey = 'pmg-hc-best';

const required = () => rounds[roundIdx].station.lines.length;
const roundSeconds = () => (required() > 1 ? secondsOf(mode).transfer : secondsOf(mode).single);

const vp = () => (mode === 'hardcore'
  ? hardcoreViewport(rounds[roundIdx])   // větší plátno + náhodný úhel
  : roundViewport(rounds[roundIdx]));

// markup níže je vždy statická šablona aplikace + čísla; DOMParser navíc nespouští skripty
const parseHtml = markup => [...new DOMParser().parseFromString(markup, 'text/html').body.childNodes];

const svg = d => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"
  stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${d}</svg>`;
const ICON = {
  warn: svg('<path d="M12 3 2 21h20L12 3Z"/><path d="M12 10v4.5"/><path d="M12 17.5h.01"/>'),
  link: svg('<path d="M9.5 14.5 14.5 9.5"/><path d="M11 6.5 12.8 4.7a4 4 0 1 1 5.7 5.7l-1.8 1.8"/>'
    + '<path d="M13 17.5l-1.8 1.8a4 4 0 1 1-5.7-5.7l1.8-1.8"/>'),
  skull: svg('<path d="M12 2c-4.4 0-8 3.4-8 7.6 0 2.6 1.3 4.6 3 5.8V19a1 1 0 0 0 1 1h8a1 1 0 0 0 1-1v-3.6'
    + 'c1.7-1.2 3-3.2 3-5.8C20 5.4 16.4 2 12 2Z"/><circle cx="9" cy="10" r="1.7" fill="currentColor" stroke="none"/>'
    + '<circle cx="15" cy="10" r="1.7" fill="currentColor" stroke="none"/>'
    + '<path d="M12 13v2"/><path d="M9.5 20v-2.6"/><path d="M14.5 20v-2.6"/>'),
  heart: svg('<path d="M12 20S3.5 14.5 3.5 8.9A4.9 4.9 0 0 1 12 5.6a4.9 4.9 0 0 1 8.5 3.3C20.5 14.5 12 20 12 20Z"/>'),
};

$('home').onclick = () => showIntro();

// ---------- lišta s prosbou o podporu ----------
// vysune se sama po dohraném kole, ale jen jednou za návštěvu — pak už si ji hráč otevírá sám
const setSupport = open => {
  document.body.dataset.support = open ? 'open' : 'shut';
  $('support-toggle').setAttribute('aria-expanded', String(open));
};
function nudgeSupport() {
  if (sessionStorage.getItem('pmg-support-shown')) return;
  sessionStorage.setItem('pmg-support-shown', '1');
  setSupport(true);
}
setSupport(false);
$('support-toggle').onclick = () => setSupport(document.body.dataset.support !== 'open');

// ---------- panel ----------
// zadání kola + kolik úseček ještě chybí
function updateTask() {
  // v duelu si popisek kola řídí duel.mjs ze zpráv serveru
  if (!rounds.length || document.body.dataset.phase === 'duel') return;
  if (reportDraw) {
    $('round-label').textContent =
      `oprava · nakresli, kudy osa vede doopravdy (${board.count()}/${required()}) · čas neběží`;
    return;
  }
  const st = rounds[roundIdx].station;
  const hc = mode === 'hardcore';
  const where = mode === 'casual' ? 'casual mode'
    : hc ? `hardcore · kolo ${roundIdx + 1}`
      : `${mode === 'warmup' ? 'rozehřátí' : 'kolo'} ${roundIdx + 1} z ${rounds.length}`;
  const task = st.lines.length > 1
    ? (hc
      // v hardcore se přiznává jen počet úseček, linky ne
      ? `nakresli 2 úsečky (${board.count()}/2)`
      : `přestup ${st.lines.join('+')} · nakresli ${st.lines.length} úsečky (${board.count()}/${st.lines.length})`)
    : 'nakresli osu nástupiště jednou úsečkou';
  $('round-label').textContent = `${where} · ${task}`;
}

// tři lebky místo teček průběhu; zhaslá = ztracený život
const skullRow = () => Array.from({ length: LIVES_MAX }, (_, i) => {
  const li = document.createElement('li');
  const alive = i < lives;
  li.className = `life${alive ? '' : ' lost'}${!alive && lostThisRound && i === lives ? ' just-lost' : ''}`;
  li.append(...parseHtml(ICON.skull));
  return li;
});

function paintPanel() {
  const st = rounds[roundIdx].station;
  const hc = mode === 'hardcore';
  if (!hc) {
    document.documentElement.style.setProperty('--accent', `var(--${st.lines[0].toLowerCase()})`);
    document.documentElement.style.setProperty('--on-accent', st.lines[0] === 'B' ? '#1a1400' : '#fff');
  }
  setBackdrop(hc ? null : st.name); // fotka podle stanice by ji v hardcore prozradila
  $('station-name').textContent = hc ? '???' : st.name;
  $('station-name').classList.toggle('hc-type', hc);
  $('line-badges').replaceChildren(...(hc ? [] : st.lines.map(l => {
    const b = document.createElement('span');
    b.className = `badge ${l}`;
    b.textContent = l;
    return b;
  })));
  updateTask();
  $('progress').replaceChildren(...(hc ? skullRow()
    : mode !== 'casual'
      ? Array.from({ length: rounds.length }, (_, i) => {
        const li = document.createElement('li');
        if (i < roundIdx) li.className = 'done';
        else if (i === roundIdx) li.className = 'now';
        return li;
      })
      : []));
  // v hardcore nejsou body, jediné číslo je počet odehraných kol
  $('score-label').textContent = hc ? 'kola' : 'skóre';
  if (hc) $('score-value').textContent = String(roundIdx + 1);
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

// ---------- sběr dat ----------
// jeden řádek v DB na každé odehrané kolo; skóre si server přepočítá sám z úseček
let roundStartedAt = 0;
const elapsedMs = () => Math.min(600000, Math.max(0, Math.round(performance.now() - roundStartedAt)));

function logGuess({ station, segments, timedOut, forfeited }) {
  const { u, v } = rounds[roundIdx];
  fetch('/api/guess', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      session, mode, stationId: station.id, roundIdx, u, v,
      segments, ms: elapsedMs(), timedOut, forfeited,
    }),
  }).catch(() => {}); // výpadek sítě nesmí sáhnout na průběh hry
}

// ---------- kola ----------
function startRound() {
  roundStartedAt = performance.now();
  reportDraw = null;              // hlášení nikdy nepřežije do dalšího kola
  $('confirm').textContent = 'Potvrdit';
  // hardcore nesmí prozradit linky ani pruhem o přestupu
  board.setRound(vp(), required(), mode === 'hardcore' ? [] : rounds[roundIdx].station.lines);
  paintPanel();
  overlay.hidden = true;
  $('clear').disabled = false;
  document.body.dataset.phase = mode;
  board.maybeShowHint();
  // snímek dalšího kola natáhni dopředu, ať je přepnutí okamžité
  // v hardcore další kolo v rounds ještě není, dá se ale odvodit ze seedu
  if (mode === 'hardcore') board.prefetch(hardcoreViewport(hardcoreRound(hcSeed, roundIdx + 1, stations)));
  else {
    const next = rounds[roundIdx + 1];
    if (next) board.prefetch(roundViewport(next));
  }
  if (timed()) board.timerStart(roundSeconds() * 1000, () => finishRound(true));
}

$('confirm').onclick = () => (reportDraw ? finishReportDraw() : finishRound(false));

// poznámka o životě na výsledkové kartě; Nosifer umí jen ASCII, proto ta znaménka zvlášť
const LIFE_NOTE = {
  lost: '<p class="life-note lost"><span class="hc-type">-1</span>život</p>',
  gained: '<p class="life-note gained"><span class="hc-type">+1</span>život</p>',
  held: '<p class="life-note">držíš se</p>',
};
let lifeNote = '';

// timedOut: vypršel čas — co je nakresleno se počítá, neúplné kolo propadá za 0
function finishRound(timedOut) {
  board.timerStop();
  const station = rounds[roundIdx].station;
  const segments = board.segments();
  if (timedOut && segments.length < required()) return forfeitRound(station, segments);

  const { d, score, perLine } = scoreRound(segments, station);
  logGuess({ station, segments, timedOut, forfeited: false });
  if (mode === 'weekly') { lines.push(segments); }
  if (mode === 'hardcore') { hcRun.push(segments); takeLife(d); }
  if (mode !== 'casual' && mode !== 'hardcore') { totalScore += score; setScore(totalScore); }
  board.hideHint(true);
  const wait = reveal(station);
  const detail = perLine.length > 1
    ? perLine.map(r => `linka ${r.line}: ${Math.round(r.d)} m`).join(' · ')
    : `odchylka ${Math.round(d)} m od skutečné osy`;
  // pod 15 m je trefa nerozeznatelná od přesné, ale metry hráč chce vidět dál
  const line = d < 15 ? `stanice je správně · ${detail}` : detail;
  const big = mode === 'hardcore' ? `${Math.round(d)} m` : `+${score}`;
  showResultCard(wait, station, big, timedOut ? `čas vypršel · ${line}` : line, segments);
}

// d = průměrná odchylka, null = propadlé kolo; přepočítá životy a text na kartě
function takeLife(d) {
  const before = lives;
  lives = nextLives(lives, d);
  lostThisRound = lives < before;
  lifeNote = LIFE_NOTE[lives < before ? 'lost' : lives > before ? 'gained' : 'held'];
  // lebky překresli hned, ne až s dalším kolem — jinak karta hlásí ztrátu a panel drží tři
  $('progress').replaceChildren(...skullRow());
}

// vypršel čas a chybí úsečka → 0 bodů, ale osu ukaž (hráč se má co naučit)
function forfeitRound(station, segments) {
  // i rozkreslené úsečky jsou data — hráč začal a nestihl
  logGuess({ station, segments, timedOut: true, forfeited: true });
  if (mode === 'weekly') lines.push(null);
  if (mode === 'hardcore') { hcRun.push(null); takeLife(null); }
  board.hideHint(true);
  board.clear();
  const wait = reveal(station);
  showResultCard(wait, station, mode === 'hardcore' ? '—' : '0', required() > 1
    ? 'Čas vypršel — u přestupní stanice musíš stihnout obě úsečky.'
    : 'Čas vypršel — nestihl jsi nakreslit úsečku.', null);
}

// hardcore: nejdřív se plátno narovná na sever, teprve pak najede osa
function reveal(station) {
  const wait = board.straighten();
  setTimeout(() => board.revealAxes(station.axes), wait);
  return wait;
}

// reveal osy ještě chvíli běží — kartu ukaž až po něm
const showResultCard = (wait, ...args) => setTimeout(() => {
  renderResult(...args);
  nudgeSupport();
}, 1200 + wait);

function renderResult(station, big, detail, segments) {
  const where = mode === 'weekly' ? `kolo ${roundIdx + 1} z ${rounds.length}`
    : mode === 'warmup' ? `rozehřátí ${roundIdx + 1} z ${rounds.length}`
      : mode === 'hardcore' ? `hardcore · kolo ${roundIdx + 1}` : 'casual';
  showCard(`
    <p class="label">${where}</p>
    <h2></h2>
    <div class="big">${big}</div>
    ${mode === 'hardcore' ? lifeNote : ''}
    <p>${detail}</p>
    <button class="btn btn-primary" id="next">${nextLabel()}</button>
    <button class="btn btn-outline" id="report">${ICON.warn}Stanice je zadaná špatně</button>
    <button class="link-btn" id="peek">prohlédnout mapu →</button>
    ${mode === 'casual' ? '<button class="link-btn" id="back">← zpět na začátek</button>' : ''}
  `, card => {
    card.querySelector('h2').textContent = station.name; // po odpovědi už není co tajit
    $('next').onclick = advance;
    if (mode === 'casual') $('back').onclick = () => showIntro();
    $('report').onclick = () => showReportCard({ station, big, detail, segments });
    $('peek').onclick = () => peekMap(() => renderResult(station, big, detail, segments));
  });
}

// Karta zmizí, ať je odhalená osa vidět celá. Kreslit se přitom nedá — board
// drží revealed. Zpátky se vykreslí ta samá karta.
function peekMap(back) {
  overlay.hidden = true;
  const btn = $('peek-back');
  btn.hidden = false;
  btn.onclick = back;
}

// ---------- hlášení chybné stanice ----------
// Slovní popis polohy je k ničemu — hráč osu rovnou zakreslí do mapy, bez odpočtu.
// ctx = {station, big, detail, segments, note, fix}: co je potřeba k návratu na výsledek i k odeslání.
function showReportCard(ctx) {
  const { station, fix } = ctx;
  showCard(`
    <p class="label">nahlásit chybu</p>
    <h2></h2>
    <p>${fix
      ? 'Osu máš zakreslenou. Přidej komentář, jestli je co dodat, a odešli.'
      : 'Zakresli do mapy, kudy osa nástupiště vede doopravdy. Čas při tom neběží.'}</p>
    <button class="btn ${fix ? 'btn-outline' : 'btn-primary'}" id="draw-fix">
      ${fix ? 'Překreslit osu' : 'Zakreslit správnou osu'}
    </button>
    <textarea id="note" maxlength="1000" rows="3" placeholder="Komentář (nepovinný)"></textarea>
    <p class="error" id="report-err"></p>
    <button class="btn ${fix ? 'btn-primary' : 'btn-outline'}" id="send">Odeslat</button>
    <button class="link-btn" id="cancel">zrušit</button>
  `, card => {
    card.querySelector('h2').textContent = station.name;
    $('note').value = ctx.note ?? '';
    const withNote = () => ({ ...ctx, note: $('note').value });
    $('draw-fix').onclick = () => startReportDraw(withNote());
    $('cancel').onclick = () => renderResult(station, ctx.big, ctx.detail, ctx.segments);
    $('send').onclick = () => sendReport(withNote());
  });
}

// kreslení opravy: karta zmizí, hráč kreslí do stejného výřezu proti vyznačené (chybné) ose
let reportDraw = null;

function startReportDraw(ctx) {
  reportDraw = ctx;
  overlay.hidden = true;
  board.clear();
  board.keepAxes(ctx.station.axes);
  $('clear').disabled = false;
  $('confirm').textContent = 'Uložit osu';
  updateTask();
}

function finishReportDraw() {
  const ctx = reportDraw;
  const fix = board.segments();
  reportDraw = null;
  $('confirm').textContent = 'Potvrdit';
  showReportCard({ ...ctx, fix });
}

async function sendReport(ctx) {
  const { station, fix } = ctx;
  const note = ctx.note.trim();
  if (!fix && note.length < 3) {
    $('report-err').textContent = 'Zakresli správnou osu, nebo aspoň napiš, co je špatně.';
    return;
  }
  $('send').disabled = true;
  $('report-err').textContent = '';
  try {
    const res = await fetch('/api/report', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ stationId: station.id, note, mode, week, segments: ctx.segments, fix }),
    });
    if (!res.ok) throw new Error((await res.json()).error);
  } catch (e) {
    $('report-err').textContent = String(e.message) === 'rate limit'
      ? 'Moc hlášení za sebou — zkus to za chvíli.'
      : 'Odeslání selhalo — zkus znovu';
    $('send').disabled = false;
    return;
  }
  showCard(`
    <p class="label">nahlásit chybu</p>
    <h2>Díky!</h2>
    <p>Hlášení jsme uložili — mrkneme se na to.</p>
    <button class="btn btn-primary" id="next">${nextLabel()}</button>
  `, () => { $('next').onclick = advance; });
}

const nextLabel = () =>
  mode === 'casual' ? 'Další stanice'
    : mode === 'hardcore' ? (lives <= 0 ? 'Konec runu' : 'Další kolo')
      : roundIdx + 1 < rounds.length ? 'Další kolo'
        : mode === 'warmup' ? 'Vyhodnocení rozehřátí' : 'Vyhodnocení';

function advance() {
  if (mode === 'casual') { rounds = [randomRound()]; roundIdx = 0; startRound(); return; }
  if (mode === 'hardcore') {
    // MAX_ROUNDS je strop payloadu při odeslání runu, ne herní pravidlo
    if (lives <= 0 || rounds.length >= MAX_ROUNDS) return endRun();
    rounds.push(hardcoreRound(hcSeed, ++roundIdx, stations));
    startRound();
    return;
  }
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
         <button class="btn btn-outline" id="lb">Žebříček</button>`
      : `<button class="btn btn-primary" id="play">Hrát týdenní výzvu na ostro</button>
         <button class="btn btn-outline" id="again">Ještě jednou na nečisto</button>`}
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

// „3–16 znaků" hráči s tečkou v přezdívce nic neřekne — hláška musí jmenovat i povolené znaky
const NICK_HELP = 'Přezdívka smí mít 3–16 znaků: písmena, číslice, mezera, pomlčka a podtržítko.';

async function submitScore() {
  const nick = $('nick').value.trim();
  $('submit-err').textContent = '';
  $('submit').disabled = true;   // dvojklik na mobilu jinak pošle dva zápisy, druhý spadne na 409
  try {
    const res = await fetch('/api/score', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ week, nick, lines }),
    });
    const data = await res.json();
    if (!res.ok) {
      $('submit-err').textContent = data.error === 'nick' ? NICK_HELP
        : data.error === 'already played' ? 'Týdenní výzvu už jsi pod touhle přezdívkou zapsal — platí první pokus.'
          : data.error === 'nick taken' ? 'Tuhle přezdívku už tenhle týden zabralo moc lidí — zvol jinou.'
            : data.error === 'rate limit' ? 'Moc zápisů za sebou — zkus to za chvíli.'
              : `Zápis se nepovedl (${data.error}) — zkus to znovu.`;
      $('submit').disabled = false;
      return;
    }
    // pod obsazenou přezdívkou zapisuje server jako „Maty (2)" — v žebříčku se
    // musí zvýraznit ten řádek, ne ten cizí
    localStorage.setItem(playedKey, data.nick);
    showLeaderboard(data.nick);
  } catch {
    $('submit-err').textContent = 'Odeslání selhalo — zkus znovu';
    $('submit').disabled = false;
  }
}

// jeden seznam pro oba žebříčky; nick je nedůvěryhodný → jen textContent
function boardList(entries, me, valueOf) {
  const ol = document.createElement('ol');
  ol.className = 'board';
  entries.forEach(e => {
    const li = document.createElement('li');
    if (e.nick === me) li.className = 'me';
    const rank = document.createElement('span');
    rank.className = 'rank';
    rank.textContent = `${e.pos}.`;   // pořadí ze serveru — po dvacítce může být díra
    const nick = document.createElement('span');
    nick.textContent = e.nick;
    const value = document.createElement('span');
    value.textContent = valueOf(e);
    li.append(rank, nick, value);
    ol.appendChild(li);
  });
  return ol;
}

// naplní box seznamem, nebo hláškou; fetch je jediný zdroj chyb
async function fillBoard(box, url, me, valueOf, empty) {
  try {
    const { entries } = await (await fetch(url)).json();
    if (!entries.length) { box.firstElementChild.textContent = empty; return; }
    box.replaceChildren(boardList(entries, me, valueOf));
  } catch {
    box.firstElementChild.textContent = 'Žebříček se nepodařilo načíst.';
  }
}

async function showLeaderboard(me) {
  showCard(`
    <p class="label">žebříček</p>
    <h2>Týden ${week}</h2>
    <div id="lb-list"><p>Načítám…</p></div>
    <button class="btn btn-outline" id="train">Casual mode</button>
    <button class="link-btn" id="back">← zpět na začátek</button>
  `, () => {
    $('train').onclick = startCasual;
    $('back').onclick = () => showIntro();
  });
  fillBoard($('lb-list'), `/api/leaderboard?week=${week}${me ? `&nick=${encodeURIComponent(me)}` : ''}`, me,
    e => `${e.score.toLocaleString('cs')} b.`,
    'Tenhle týden zatím nikdo nehrál. Jsi první!');
}

async function submitRun() {
  const nick = $('nick').value.trim();
  $('submit-err').textContent = '';
  $('submit').disabled = true;
  try {
    const res = await fetch('/api/hardcore', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ nick, seed: hcSeed, rounds: hcRun }),
    });
    const data = await res.json();
    if (!res.ok) {
      $('submit-err').textContent = data.error === 'nick' ? NICK_HELP
        : data.error === 'nick taken' ? 'Tuhle přezdívku už zabralo moc lidí — zvol jinou.'
          : data.error === 'rate limit' ? 'Moc runů za sebou — zkus to za chvíli.'
            : `Zápis se nepovedl (${data.error}) — zkus to znovu.`;
      $('submit').disabled = false;
      return;
    }
    // pmg-nick se předvyplňuje do dalšího runu i do duelu, takže tam patří jméno bez
    // čísla — pod jakým jménem hráč visí na žebříčku, si drží klíč vedle
    localStorage.setItem('pmg-nick', nick);
    localStorage.setItem('pmg-hc-nick', data.nick);
    showSurvivors(data.nick);
  } catch {
    $('submit-err').textContent = 'Odeslání selhalo — zkus znovu';
    $('submit').disabled = false;
  }
}

function showSurvivors(me) {
  showCard(`
    <p class="label">hardcore</p>
    <h2 class="hc-type">SURVIVORS</h2>
    <div id="lb-list"><p>Načítám…</p></div>
    <button class="btn btn-primary" id="again">Hrát hardcore</button>
    <button class="link-btn" id="back">← zpět na začátek</button>
  `, () => {
    $('again').onclick = startHardcore;
    $('back').onclick = () => showIntro();
  });
  fillBoard($('lb-list'), `/api/hardcore${me ? `?nick=${encodeURIComponent(me)}` : ''}`, me,
    e => `${e.rounds} ${kola(e.rounds)}`,
    'Zatím nikdo nepřežil. Buď první!');
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

// hardcore: seed si losuje klient, server z něj celý run zrekonstruuje
function startHardcore() {
  mode = 'hardcore';
  hcSeed = (Math.random() * 2 ** 32) >>> 0;
  hcRun = []; lives = LIVES_MAX; lostThisRound = false;
  roundIdx = 0; totalScore = 0;
  rounds = [hardcoreRound(hcSeed, 0, stations)];
  startRound();
}

const kola = n => (n === 1 ? 'kolo' : n < 5 ? 'kola' : 'kol');

function endRun() {
  const played = rounds.length;   // fatální kolo se počítá
  const best = Math.max(Number(localStorage.getItem(hcBestKey) || 0), played);
  localStorage.setItem(hcBestKey, String(best));
  showCard(`
    <p class="label">hardcore · konec</p>
    <h2 class="hc-type">KONEC</h2>
    <div class="big hc-type">${played}</div>
    <p>Přežil jsi ${played} ${kola(played)}. Tvůj rekord je ${best}.</p>
    <input id="nick" maxlength="16" placeholder="přezdívka (3–16 znaků)">
    <p class="error" id="submit-err"></p>
    <button class="btn btn-primary" id="submit">Zapsat mezi přeživší</button>
    <button class="btn btn-outline" id="again">Hrát znovu</button>
    <button class="link-btn" id="back">← zpět na začátek</button>
  `, () => {
    $('nick').value = localStorage.getItem('pmg-nick') ?? '';
    $('submit').onclick = submitRun;
    $('again').onclick = startHardcore;
    $('back').onclick = () => showIntro();
  });
}

// ---------- helpers ----------
function showCard(staticHtml, wire) {
  const card = document.createElement('div');
  card.className = 'card';
  card.append(...parseHtml(staticHtml));
  overlay.replaceChildren(card);
  overlay.hidden = false;
  $('peek-back').hidden = true;   // ať prohlížení nepřežije do jiné karty (třeba ← zpět na začátek)
  board.hideHint();
  board.timerStop(); // odpočet nikdy neběží pod otevřenou kartou
  // overlay kryje jen mapu — tlačítka v panelu se musí zamknout ručně
  $('confirm').disabled = true;
  $('clear').disabled = true;
  wire?.(card);
}

initDuel({ card: showCard, leave: () => location.href = '/' });

// nick musí být znám dřív než v duelu — soupeř ho vidí v čekárně
function askNick(then) {
  showCard(`
    <p class="label">duel</p>
    <h2>Jak ti mám říkat?</h2>
    <input id="duel-nick" maxlength="16" placeholder="přezdívka (3–16 znaků)">
    <p class="error" id="nick-err"></p>
    <button class="btn btn-primary" id="go">Pokračovat</button>
    <button class="link-btn" id="back">← zpět</button>
  `, () => {
    $('duel-nick').value = localStorage.getItem('pmg-nick') ?? '';
    $('go').onclick = () => {
      const nick = $('duel-nick').value.trim();
      if (!/^[\p{L}\p{N} _-]{3,16}$/u.test(nick)) {
        $('nick-err').textContent = 'Neplatná přezdívka (3–16 znaků)';
        return;
      }
      localStorage.setItem('pmg-nick', nick);
      then();
    };
    $('back').onclick = () => showIntro();
  });
}

// ---------- úvod + tutoriál ----------
// tři režimy = tři barvy linek: standard červená (C), duel žlutá (B), casual zelená (A)
const TABS = ['standard', 'duel', 'casual'];
const TAB_META = {
  standard: `${ROUNDS} stanic · na čas · zápis do žebříčku`,
  duel: '1v1 · stejná kola · kdo je blíž',
  casual: 'bez času · bez konce · bez zápisu',
  hardcore: `${LIVES_MAX} životy · ${HARDCORE_SECONDS.single} s · pootočená mapa · bez jména`,
};
let introTab = 'standard';

// v hardcore jsou ostatní režimy přeškrtnuté a zamčené — ven vede jen tlačítko softcore
const tabBtn = (id, name) =>
  `<button class="tab ${id}" role="tab" id="tab-${id}" data-tab="${id}"
     aria-selected="${id === introTab}" tabindex="${id === introTab ? 0 : -1}"
     ${introTab === 'hardcore' ? 'disabled' : ''}>${name}</button>`;

// mezi režimy se liší text kroků — casual nemá odpočet, hardcore nemá jméno stanice
// jak se kreslí říká hint v prvním kole (board.maybeShowHint), tady se to neopakuje
const step1 = tab => (tab === 'hardcore'
  ? 'Dostaneš letecký snímek 600 × 600 m — pootočený o náhodný úhel.<br><span>Která stanice to je, se nedozvíš.</span>'
  : 'Dostaneš letecký snímek 600 × 600 m a jméno stanice.<br><span>Stanice je někde uvnitř, ale pod zemí ji nevidíš.</span>');
const step2 = tab => (tab === 'casual'
  ? 'Nakresli úsečku, kudy vede nástupiště.'
  : `Za ${secondsOf(tab).single} sekund nakresli úsečku, kudy vede nástupiště.`);
const step3 = tab => (tab === 'hardcore'
  // prahy se táhnou z konstant, ať text nezůstane pozadu, když se pravidlo doladí
  ? `Potvrdíš, mapa se narovná a uvidíš skutečnou osu.<br><span>Odchylka nad ${LOSE_M} m bere život,
     pod ${GAIN_M} m ho vrací. Máš ${LIVES_MAX}.</span>`
  : 'Potvrdíš a uvidíš skutečnou osu kolejí.<br><span>Čím blíž jsi trefil, tím víc bodů — max 1000 za kolo.</span>');

// bez úvodních odstavců — co který režim je, stojí v TAB_META nad kartou
const introCta = (tab, played) => {
  if (tab === 'hardcore') return `
    <button class="btn btn-primary" id="hc-play">Hrát hardcore</button>
    <button class="btn btn-outline" id="hc-lb">Žebříček přeživších</button>`;
  if (tab === 'casual') return `
    <button class="btn btn-primary" id="casual">Hrát casual</button>`;
  if (tab === 'duel') return `
    <button class="btn btn-primary" id="duel-find">Najít soupeře ve frontě</button>
    <button class="btn btn-outline" id="duel-host">${ICON.link}Pozvat kamaráda odkazem</button>`;
  return played
    ? `<p>Týdenní výzvu už jsi tenhle týden odehrál jako <strong id="played-nick"></strong>.</p>
       <button class="btn btn-primary" id="warmup">Rozehřátí — ${ROUNDS} stanic na nečisto</button>
       <button class="btn btn-outline" id="lb">Žebříček</button>`
    : `<button class="btn btn-primary" id="play">Hrát týdenní výzvu</button>
       <button class="btn btn-outline" id="warmup">Rozehřátí — ${ROUNDS} stanic na nečisto</button>`;
};

// tlačítko na patě panelu: do hardcore lebkou, ven duhovým srdcem
function setModeSwitch(tab) {
  const hc = tab === 'hardcore';
  const btn = $('go-hc');
  btn.className = hc ? 'skull softcore' : 'skull';
  btn.title = btn.ariaLabel = hc ? 'Softcore mode' : 'Hardcore mode';
  btn.replaceChildren(...parseHtml(`${hc ? ICON.heart : ICON.skull}<span>${hc ? 'softcore' : 'hardcore'}</span>`));
  btn.onclick = () => showIntro(hc ? 'standard' : 'hardcore');
}

function showIntro(tab = introTab) {
  const switching = tab !== introTab; // přepnutí tabu nemá kartu znovu rozanimovat
  introTab = tab;
  const played = localStorage.getItem(playedKey);
  reportDraw = null;
  board.timerStop();
  document.body.dataset.phase = 'intro';
  document.body.dataset.mode = tab;
  setBackdrop(); // úvod dostane fotku bez stanice
  document.title = tab === 'hardcore'
    ? 'Metro Guesser Hardcore — přežiješ?'
    : 'Metro Guesser — kde vede pražské metro?';
  $('station-name').textContent = 'Kde vede metro?';
  $('line-badges').replaceChildren();
  $('round-label').textContent = TAB_META[tab];
  $('progress').replaceChildren();
  $('duel').hidden = true;
  $('home').hidden = true;
  $('confirm').disabled = true;
  setModeSwitch(tab);
  showCard(`
    <p class="label">pražské metro · týden ${week}</p>
    <h2>Metro Guesser${tab === 'hardcore' ? ' Hardcore' : ''}</h2>
    <div class="tabs" role="tablist" aria-label="režim hry">
      ${tabBtn('standard', 'Standard')}${tabBtn('duel', 'Duel')}${tabBtn('casual', 'Casual')}
    </div>
    <ol class="steps">
      <li><b>1</b><div>${step1(tab)}</div></li>
      <li><b>2</b><div>${step2(tab)}</div></li>
      <li><b>3</b><div>${step3(tab)}</div></li>
    </ol>
    <div class="cta">${introCta(tab, played)}</div>
  `, card => {
    if (switching) card.style.animation = 'none';
    card.querySelectorAll('.tab').forEach(t => {
      t.onclick = () => showIntro(t.dataset.tab);
      t.onkeydown = e => {
        const dir = { ArrowLeft: -1, ArrowRight: 1 }[e.key];
        if (!dir) return;
        const next = TABS[(TABS.indexOf(introTab) + dir + TABS.length) % TABS.length];
        showIntro(next);
        $(`tab-${next}`).focus();
      };
    });
    if (tab === 'hardcore') {
      $('hc-play').onclick = startHardcore;
      $('hc-lb').onclick = () => showSurvivors(localStorage.getItem('pmg-hc-nick') ?? undefined);
    } else if (tab === 'casual') $('casual').onclick = startCasual;
    else if (tab === 'duel') {
      $('duel-find').onclick = () => askNick(findOpponent);
      $('duel-host').onclick = () => askNick(hostDuel);
    } else {
      $('warmup').onclick = startWarmup;
      if (played) {
        card.querySelector('#played-nick').textContent = played;
        $('lb').onclick = () => showLeaderboard(played);
      } else $('play').onclick = startWeekly;
    }
  });
}

// ---------- pozadí: jedna fotka obkladu na stanici ----------
const bgLayers = [document.createElement('div'), document.createElement('div')];
$('bg').append(...bgLayers);
let photos = [], bgStation = null, bgFile = null, bgTop = 0;

// stanice si drží svou fotku po celé kolo; kde fotku dané stanice máme, ukážeme ji
function pickPhoto(station) {
  const own = photos.find(p => p.station === station);
  if (own) return own;
  const sum = [...(station || '')].reduce((a, c) => a + c.codePointAt(0), 0);
  return photos[sum % photos.length];
}

function setBackdrop(station = null) {
  bgStation = station;
  if (!photos.length) return; // fotky se ještě stahují, dožene to fetch níž
  const p = pickPhoto(station);
  if (p.file === bgFile) return;
  bgFile = p.file;
  const img = new Image(); // ukaž až po načtení, ať se neprolíná do prázdna
  img.onload = () => {
    const next = bgLayers[bgTop ^= 1];
    next.style.backgroundImage = `url("bg/${p.file}")`;
    next.classList.add('on');
    bgLayers[bgTop ^ 1].classList.remove('on');
    const credit = $('photo-credit');
    credit.textContent = `foto ${p.author} / Wikimedia Commons, ${p.lic}`;
    credit.href = p.page;
  };
  img.src = `bg/${p.file}`;
}

// ---------- start ----------
fetch('bg/CREDITS.json').then(r => r.json()).then(list => { photos = list; setBackdrop(bgStation); });
board.setRound({ lat: 50.0755, lng: 14.4303, size: 600 }, 1);
showIntro();

// /?duel=K7P2M9 z odkazu od kamaráda, /?duel=new z tlačítka „Nový duel"
const fromLink = new URLSearchParams(location.search).get('duel');
if (fromLink === 'new') askNick(hostDuel);
else if (fromLink) askNick(() => joinDuel(fromLink) || showIntro());
