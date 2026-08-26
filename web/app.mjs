import { isoWeek, weeklyChallenge, practiceRounds, roundViewport } from './shared/seed.mjs';
import { scoreRound } from './shared/scoring.mjs';
import * as board from './board.mjs';
import { initDuel, findOpponent, hostDuel, joinDuel } from './duel.mjs';

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
const ROUNDS = 10;

// weekly: ostrá výzva se zápisem · warmup: 10 stanic mimo výzvu, na nečisto · casual: bez času a bez konce
let mode = 'weekly';
const timed = () => mode !== 'casual';
let rounds = [], roundIdx = 0, totalScore = 0;
let lines = [];         // tahy pro odeslání, [[[lat,lng],[lat,lng]], ...] per kolo

const required = () => rounds[roundIdx].station.lines.length;
const roundSeconds = () => (required() > 1 ? SECONDS.transfer : SECONDS.single);

const vp = () => roundViewport(rounds[roundIdx]);

// markup níže je vždy statická šablona aplikace + čísla; DOMParser navíc nespouští skripty
const parseHtml = markup => [...new DOMParser().parseFromString(markup, 'text/html').body.childNodes];

const svg = d => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"
  stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${d}</svg>`;
const ICON = {
  warn: svg('<path d="M12 3 2 21h20L12 3Z"/><path d="M12 10v4.5"/><path d="M12 17.5h.01"/>'),
  link: svg('<path d="M9.5 14.5 14.5 9.5"/><path d="M11 6.5 12.8 4.7a4 4 0 1 1 5.7 5.7l-1.8 1.8"/>'
    + '<path d="M13 17.5l-1.8 1.8a4 4 0 1 1-5.7-5.7l1.8-1.8"/>'),
};

$('home').onclick = () => showIntro();

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
  const where = mode === 'casual' ? 'casual mode'
    : `${mode === 'warmup' ? 'rozehřátí' : 'kolo'} ${roundIdx + 1} z ${rounds.length}`;
  const task = st.lines.length > 1
    ? `přestup ${st.lines.join('+')} · nakresli ${st.lines.length} úsečky (${board.count()}/${st.lines.length})`
    : 'nakresli osu nástupiště jednou úsečkou';
  $('round-label').textContent = `${where} · ${task}`;
}

function paintPanel() {
  const st = rounds[roundIdx].station;
  document.documentElement.style.setProperty('--accent', `var(--${st.lines[0].toLowerCase()})`);
  document.documentElement.style.setProperty('--on-accent', st.lines[0] === 'B' ? '#1a1400' : '#fff');
  setBackdrop(st.name);
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
  board.setRound(vp(), required(), rounds[roundIdx].station.lines);
  paintPanel();
  overlay.hidden = true;
  $('clear').disabled = false;
  document.body.dataset.phase = mode;
  board.maybeShowHint();
  // snímek dalšího kola natáhni dopředu, ať je přepnutí okamžité
  const next = rounds[roundIdx + 1];
  if (next) board.prefetch(roundViewport(next));
  if (timed()) board.timerStart(roundSeconds() * 1000, () => finishRound(true));
}

$('confirm').onclick = () => (reportDraw ? finishReportDraw() : finishRound(false));

// timedOut: vypršel čas — co je nakresleno se počítá, neúplné kolo propadá za 0
function finishRound(timedOut) {
  board.timerStop();
  const station = rounds[roundIdx].station;
  const segments = board.segments();
  if (timedOut && segments.length < required()) return forfeitRound(station, segments);

  const { d, score, perLine } = scoreRound(segments, station);
  logGuess({ station, segments, timedOut, forfeited: false });
  if (mode === 'weekly') { lines.push(segments); }
  if (mode !== 'casual') { totalScore += score; setScore(totalScore); }
  board.hideHint(true);
  board.revealAxes(station.axes);
  const detail = perLine.length > 1
    ? perLine.map(r => `linka ${r.line}: ${Math.round(r.d)} m`).join(' · ')
    : `odchylka ${Math.round(d)} m od skutečné osy`;
  showResultCard(station, `+${score}`, timedOut ? `čas vypršel · ${detail}` : detail, segments);
}

// vypršel čas a chybí úsečka → 0 bodů, ale osu ukaž (hráč se má co naučit)
function forfeitRound(station, segments) {
  // i rozkreslené úsečky jsou data — hráč začal a nestihl
  logGuess({ station, segments, timedOut: true, forfeited: true });
  if (mode === 'weekly') lines.push(null);
  board.hideHint(true);
  board.clear();
  board.revealAxes(station.axes);
  showResultCard(station, '0', required() > 1
    ? 'Čas vypršel — u přestupní stanice musíš stihnout obě úsečky.'
    : 'Čas vypršel — nestihl jsi nakreslit úsečku.', null);
}

// reveal osy ještě chvíli běží — kartu ukaž až po něm
const showResultCard = (...args) => setTimeout(() => renderResult(...args), 1200);

function renderResult(station, big, detail, segments) {
  const where = mode === 'weekly' ? `kolo ${roundIdx + 1} z ${rounds.length}`
    : mode === 'warmup' ? `rozehřátí ${roundIdx + 1} z ${rounds.length}` : 'casual';
  showCard(`
    <p class="label">${where}</p>
    <h2></h2>
    <div class="big">${big}</div>
    <p>${detail}</p>
    <button class="btn btn-primary" id="next">${nextLabel()}</button>
    <button class="btn btn-outline" id="report">${ICON.warn}Stanice je zadaná špatně</button>
    <button class="link-btn" id="peek">prohlédnout mapu →</button>
    ${mode === 'casual' ? '<button class="link-btn" id="back">← zpět na začátek</button>' : ''}
  `, card => {
    card.querySelector('h2').textContent = station.name;
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
    <button class="btn btn-outline" id="train">Casual mode</button>
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
};
let introTab = 'standard';

const tabBtn = (id, name) =>
  `<button class="tab ${id}" role="tab" id="tab-${id}" data-tab="${id}"
     aria-selected="${id === introTab}" tabindex="${id === introTab ? 0 : -1}">${name}</button>`;

// mezi režimy se liší jen druhý krok — casual nemá odpočet
// jak se kreslí říká hint v prvním kole (board.maybeShowHint), tady se to neopakuje
const step2 = tab => (tab === 'casual'
  ? 'Nakresli úsečku, kudy vede nástupiště.'
  : `Za ${SECONDS.single} sekund nakresli úsečku, kudy vede nástupiště.`);

// bez úvodních odstavců — co který režim je, stojí v TAB_META nad kartou
const introCta = (tab, played) => {
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

function showIntro(tab = introTab) {
  const switching = tab !== introTab; // přepnutí tabu nemá kartu znovu rozanimovat
  introTab = tab;
  const played = localStorage.getItem(playedKey);
  reportDraw = null;
  board.timerStop();
  document.body.dataset.phase = 'intro';
  document.body.dataset.mode = tab;
  setBackdrop(); // úvod dostane fotku bez stanice
  $('station-name').textContent = 'Kde vede metro?';
  $('line-badges').replaceChildren();
  $('round-label').textContent = TAB_META[tab];
  $('progress').replaceChildren();
  $('duel').hidden = true;
  $('home').hidden = true;
  $('confirm').disabled = true;
  showCard(`
    <p class="label">pražské metro · týden ${week}</p>
    <h2>Metro Guesser</h2>
    <div class="tabs" role="tablist" aria-label="režim hry">
      ${tabBtn('standard', 'Standard')}${tabBtn('duel', 'Duel')}${tabBtn('casual', 'Casual')}
    </div>
    <ol class="steps">
      <li><b>1</b><div>Dostaneš letecký snímek 600 × 600 m a jméno stanice.<br><span>Stanice je někde uvnitř, ale pod zemí ji nevidíš.</span></div></li>
      <li><b>2</b><div>${step2(tab)}</div></li>
      <li><b>3</b><div>Potvrdíš a uvidíš skutečnou osu kolejí.<br><span>Čím blíž jsi trefil, tím víc bodů — max 1000 za kolo.</span></div></li>
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
    if (tab === 'casual') $('casual').onclick = startCasual;
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
