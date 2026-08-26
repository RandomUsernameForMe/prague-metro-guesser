// Klient živého duelu. Stav drží server; tenhle soubor jen kreslí, co přijde.
import * as board from './board.mjs';
import { newCode, CODE_RE } from './shared/code.mjs';

const $ = id => document.getElementById(id);
const overlay = $('overlay');

// token přežije reload stránky → server pozná, že jde o návrat, ne o třetího hráče
let token = sessionStorage.getItem('pmg-duel-token');
if (!token) {
  token = [...crypto.getRandomValues(new Uint8Array(8))].map(b => b.toString(16).padStart(2, '0')).join('');
  sessionStorage.setItem('pmg-duel-token', token);
}

const PING = '{"type":"ping"}';       // MatchDO na tohle odpoví bez probuzení
const PING_MS = 25000;
const RETRY_MS = [400, 800, 1600, 3200, 6400]; // součet < 15 s, aby se vešel do grace

let ws = null, you = null, code = null, roundIdx = 0, showCard = null, onLeave = null;
let iSubmitted = false;  // shot clock se hlásí jen tomu, kdo ještě kreslí
let inRound = false;     // kreslíme právě teď? rozhoduje, jestli se kolo obnoví, nebo přepíše
let closing = false;     // zavíráme sami (konec zápasu) → žádný pokus o návrat
let everOpened = false;  // odlišuje spadlou síť od zápasu, který nás nikdy nepustil dál
let retries = 0, pingTimer = null;

export function initDuel({ card, leave }) {
  showCard = card;   // app.mjs umí vykreslit kartu do overlaye
  onLeave = leave;   // návrat na úvodní obrazovku
}

// Bez tohohle vypadá každé selhání jako mrtvé tlačítko: kliknutí spustí async funkci,
// ta se zhroutí do unhandled rejection a na obrazovce nezůstane vůbec nic.
const failCard = text => waitingCard(`${text} Zkus to prosím znovu.`, true);

export async function findOpponent() {
  let c, host;
  try {
    const res = await fetch('/api/duel/queue', { method: 'POST' });
    if (!res.ok) throw new Error(`server odpověděl ${res.status}`);
    ({ code: c, host } = await res.json());
  } catch (e) {
    return failCard(`Frontu se nepodařilo otevřít (${e.message}).`);
  }
  // i „nalezený" zápas může být prázdný, když protějšek mezitím zavřel kartu — slibovat se to nedá
  connect(c, host ? 'Čekám na soupeře — vydrž, hledám ho ve frontě.' : 'Našel jsem volný zápas, připojuji tě.');
}

export function hostDuel() {
  connect(newCode(), null);
}

export function joinDuel(c) {
  if (!CODE_RE.test(c)) return false;
  connect(c, null);
  return true;
}

function connect(c, note) {
  code = c;
  closing = false;
  everOpened = false;
  retries = 0;
  $('confirm').onclick = submit;   // v duelu potvrzení posílá tip, nevyhodnocuje kolo lokálně
  document.body.dataset.phase = 'duel';
  $('duel').hidden = false;
  waitingCard(note ?? 'Čekám na kamaráda.', false, true);
  openSocket();
}

function openSocket() {
  const nick = localStorage.getItem('pmg-nick') ?? 'hráč';
  const session = localStorage.getItem('pmg-session') ?? '';
  const url = new URL(`/api/duel/${code}`, location.href);
  url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:';
  url.search = new URLSearchParams({ player: token, nick, session });
  try {
    ws = new WebSocket(url);
  } catch (e) {
    // konstruktor umí házet (blokované schéma, mixed content) — pak by karta nikdy nedorazila
    return failCard(`Spojení se nepodařilo otevřít (${e.message}).`);
  }
  ws.onopen = () => {
    everOpened = true;
    clearInterval(pingTimer);
    // nečinný socket zavře kdejaká proxy dřív, než doběhne ready check
    pingTimer = setInterval(() => ws?.readyState === WebSocket.OPEN && ws.send(PING), PING_MS);
  };
  ws.onmessage = e => handle(JSON.parse(e.data));
  ws.onclose = () => {
    clearInterval(pingTimer);
    board.timerStop();
    if (closing) return;
    // socket, který se nikdy neotevřel, není výpadek sítě: DO vrátil 409 nebo 400
    if (!everOpened) return failCard('K zápasu se nejde připojit — kód neplatí, nebo v něm už hrajou dva.');
    reconnect();
  };
}

// Server drží místo 15 vteřin (GRACE_MS v automatu), tak se do nich vejdi.
// Sezení pozná server podle tokenu, takže návrat naváže na rozehrané kolo.
function reconnect() {
  const wait = RETRY_MS[retries];
  if (wait === undefined) return waitingCard('Spojení se serverem spadlo.', true);
  retries++;
  waitingCard(`Spojení spadlo — vracím tě do zápasu (pokus ${retries} z ${RETRY_MS.length})…`);
  setTimeout(openSocket, wait);
}

function handle(msg) {
  retries = 0;   // po skutečném provozu, ne po pouhém otevření — jinak by flapping socket cyklil
  you = msg.you ?? you;
  switch (msg.type) {
    case 'state': return onState(msg);
    case 'round': return onRound(msg);
    case 'deadline': return onShotClock(msg);
    case 'opponent': return onOpponent(msg);
    case 'reveal': return onReveal(msg);
    case 'end': return onEnd(msg);
    case 'error': return waitingCard(msg.error === 'ended'
      ? 'Tenhle zápas už skončil. Založ si nový.'
      : 'Zápas je plný — tenhle kód už hrajou dva lidi.', true);
  }
}

// dlaždice příštího kola se stáhnou, dokud běží odhalení nebo odpočet do startu
const prefetchNext = msg => { if (msg.nextViewport) board.prefetch(msg.nextViewport); };

// soupeř odevzdal → do konce kola zbývá jen shot clock, ať to hráč nepřehlédne
function onShotClock(msg) {
  board.timerSetLeft(msg.msLeft);
  if (iSubmitted) return;
  const el = $('duel-shot');
  el.textContent = `Soupeř už odevzdal — máš posledních ${Math.ceil(msg.msLeft / 1000)} s!`;
  el.hidden = false;
}

function onState(msg) {
  const them = msg.players.find(p => p.id !== you);
  $('duel-name').textContent = them?.nick ?? 'soupeř';
  $('duel-me').textContent = (msg.players.find(p => p.id === you)?.total ?? 0).toLocaleString('cs');
  $('duel-them').textContent = (them?.total ?? 0).toLocaleString('cs');
  $('duel-flag').className = `duel-flag ${them && !them.connected ? 'gone' : ''}`;
  if (msg.phase === 'waiting') waitingCard('Čekám na soupeře.', false, true);
  if (msg.phase === 'ready') readyCard(msg);
  if (msg.phase === 'countdown') { waitingCard(`${them?.nick ?? 'Soupeř'} je tu. Začínáme!`); prefetchNext(msg); }
  if (msg.phase === 'paused') waitingCard(`Soupeř se odpojil — čekám ${Math.ceil((msg.msLeft ?? 15000) / 1000)} vteřin.`);
  if (msg.phase === 'ended') waitingCard('Zápas už skončil.', true); // reload až po konci
  if (msg.phase === 'drawing') resumeRound(msg);
}

// state:drawing dorazí po reloadu i po odpauzování, a to oběma hráčům — kolo, které
// zrovna kreslíme, se nesmí přepsat, jinak by soupeřův výpadek smazal naši úsečku
function resumeRound(msg) {
  if (!inRound || msg.i !== roundIdx) return onRound(msg); // vstup doprostřed kola: zadání jsme neviděli
  overlay.hidden = true;
  if (iSubmitted) return;
  $('clear').disabled = false;
  $('confirm').disabled = board.count() < msg.lines.length;
  board.timerStart(msg.msLeft, submit);
}

// oba museli potvrdit, že sedí u počítače — jinak zápas začne bez jednoho z nich
function readyCard(msg) {
  const me = msg.players.find(p => p.id === you);
  const them = msg.players.find(p => p.id !== you);
  showCard(`
    <p class="label">duel · ${code}</p>
    <h2>Soupeř nalezen</h2>
    <p id="duel-note"></p>
    <button class="btn btn-primary" id="ready-btn">Jsem připraven</button>
  `, card => {
    card.querySelector('#duel-note').textContent = them?.ready
      ? `${them.nick} je připraven a čeká na tebe.`
      : `${them?.nick ?? 'Soupeř'} zatím nepotvrdil. Zápas začne, až potvrdíte oba.`;
    const btn = $('ready-btn');
    if (me?.ready) return waitForOpponent(btn);
    btn.onclick = () => {
      waitForOpponent(btn);
      ws?.send(JSON.stringify({ type: 'ready' }));
    };
  });
}

const waitForOpponent = btn => {
  btn.disabled = true;
  btn.textContent = 'Čekám na soupeře…';
};

function onRound(msg) {
  roundIdx = msg.i;
  iSubmitted = false;
  inRound = true;
  $('duel-shot').hidden = true;
  $('duel-legend').hidden = true;
  overlay.hidden = true;
  $('station-name').textContent = msg.name;
  $('round-label').textContent = `kolo ${msg.i + 1} z 10 · ${msg.lines.length > 1
    ? `přestup ${msg.lines.join('+')} · nakresli ${msg.lines.length} úsečky` : 'nakresli osu nástupiště'}`;
  $('line-badges').replaceChildren(...msg.lines.map(l => {
    const b = document.createElement('span');
    b.className = `badge ${l}`;
    b.textContent = l;
    return b;
  }));
  $('duel-flag').className = 'duel-flag waiting';
  $('clear').disabled = false;
  board.setRound(msg.viewport, msg.lines.length, msg.lines);
  board.maybeShowHint();
  board.timerStart(msg.msLeft, submit); // vypršení = odevzdej, co je nakresleno
}

function submit() {
  board.timerStop();
  iSubmitted = true;
  $('duel-shot').hidden = true;
  $('confirm').disabled = true;
  $('clear').disabled = true;
  ws?.send(JSON.stringify({ type: 'submit', i: roundIdx, lines: board.segments() }));
}

// legenda dává smysl jen když jsou v mapě obě čáry — soupeř mohl kolo prošvihnout
function showLegend(hasRival) {
  const el = $('duel-legend');
  el.hidden = !hasRival;
  if (!hasRival) return;
  const chip = (cls, text) => {
    const s = document.createElement('span');
    s.className = cls;
    s.textContent = text;   // nese nick soupeře → nikdy ne innerHTML
    return s;
  };
  el.replaceChildren(chip('mine', 'tvůj tip'), chip('rival', $('duel-name').textContent));
}

function onOpponent(msg) {
  if (msg.id === you) return;
  $('duel-flag').className = `duel-flag ${!msg.connected ? 'gone' : msg.submitted ? 'submitted' : 'waiting'}`;
}

function onReveal(msg) {
  board.timerStop();
  inRound = false;
  prefetchNext(msg);
  $('duel-shot').hidden = true;
  $('duel-me').textContent = msg.totals[you].toLocaleString('cs');
  const themId = Object.keys(msg.totals).find(id => id !== you);
  const rival = msg.guesses?.[themId];
  board.revealAxes(msg.axes, rival);
  showLegend(rival?.length > 0);
  $('duel-them').textContent = msg.totals[themId].toLocaleString('cs');
  const mine = msg.scores[you], theirs = msg.scores[themId];
  const verdict = mine === theirs ? 'Remíza v kole' : mine > theirs ? 'Kolo pro tebe' : 'Kolo pro soupeře';
  setTimeout(() => showCard(`
    <p class="label">kolo ${msg.i + 1} z 10</p>
    <h2>${verdict}</h2>
    <div class="big">${mine} : ${theirs}</div>
    <p>Další kolo za chvíli…</p>
  `), 1200);
}

function onEnd(msg) {
  board.timerStop();
  inRound = false;
  closing = true;              // zápas skončil — návrat po výpadku už nedává smysl
  clearInterval(pingTimer);
  $('duel-shot').hidden = true;
  $('duel-legend').hidden = true;
  const themId = Object.keys(msg.totals).find(id => id !== you);
  const verdict = msg.reason === 'alone'
    ? 'Nikdo nedorazil — zkus to znovu'
    : msg.reason === 'noshow'
    ? (msg.winner === null ? 'Nikdo nepotvrdil — zápas zrušen'
      : msg.winner === you ? 'Soupeř nepotvrdil — vyhrál jsi' : 'Nepotvrdil jsi včas — zápas propadl')
    : msg.reason === 'forfeit'
      ? (msg.winner === you ? 'Soupeř se odpojil — vyhrál jsi' : 'Odpojil ses — zápas propadl')
      : msg.winner === null ? 'Remíza' : msg.winner === you ? 'Vyhrál jsi!' : 'Prohrál jsi';
  showCard(`
    <p class="label">konec zápasu · ${code}</p>
    <h2>${verdict}</h2>
    <div class="big">${msg.totals[you]} : ${msg.totals[themId] ?? 0}</div>
    <button class="btn btn-primary" id="again">Nový duel</button>
    <button class="link-btn" id="back">← zpět na začátek</button>
  `, () => {
    $('again').onclick = () => { sessionStorage.removeItem('pmg-duel-token'); location.href = '/?duel=new'; };
    $('back').onclick = () => onLeave();
  });
  ws?.close();   // dřív se jen zahodila reference a socket zůstal viset otevřený
  ws = null;
}

// invite = čekáme na soupeře a hráč má co poslat kamarádovi
function waitingCard(text, dead = false, invite = false) {
  showCard(`
    <p class="label">duel</p>
    <h2>${dead ? 'Konec' : 'Duel'}</h2>
    <p id="duel-note"></p>
    ${invite ? `<p class="label">pošli kamarádovi tenhle odkaz</p>
      <input id="duel-link" readonly>
      <button class="btn btn-outline" id="duel-copy">Kopírovat odkaz</button>` : ''}
    ${dead ? '<button class="link-btn" id="back">← zpět na začátek</button>' : ''}
  `, card => {
    card.querySelector('#duel-note').textContent = text; // text může nést nick → jen textContent
    if (invite) wireInvite();
    if (dead) $('back').onclick = () => onLeave();
  });
}

function wireInvite() {
  const url = new URL(`/?duel=${code}`, location.href).href;
  const btn = $('duel-copy');
  $('duel-link').value = url;
  btn.onclick = async () => {
    try {
      // clipboard API je jen v zabezpečeném kontextu a může ho odmítnout i uživatel
      await navigator.clipboard.writeText(url);
      btn.textContent = 'Zkopírováno ✓';
    } catch {
      $('duel-link').select();
      btn.textContent = 'Označeno — zkopíruj ručně';
    }
  };
}
