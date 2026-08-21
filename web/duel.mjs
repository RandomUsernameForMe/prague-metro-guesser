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

let ws = null, you = null, code = null, roundIdx = 0, showCard = null, onLeave = null;

export function initDuel({ card, leave }) {
  showCard = card;   // app.mjs umí vykreslit kartu do overlaye
  onLeave = leave;   // návrat na úvodní obrazovku
}

export async function findOpponent() {
  const res = await fetch('/api/duel/queue', { method: 'POST' });
  const { code: c, host } = await res.json();
  connect(c, host ? 'Čekám na soupeře — vydrž, hledám ho ve frontě.' : 'Soupeř nalezen!');
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
  const nick = localStorage.getItem('pmg-nick') ?? 'hráč';
  const session = localStorage.getItem('pmg-session') ?? '';
  const url = new URL(`/api/duel/${code}`, location.href);
  url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:';
  url.search = new URLSearchParams({ player: token, nick, session });
  ws = new WebSocket(url);
  ws.onmessage = e => handle(JSON.parse(e.data));
  ws.onclose = () => { board.timerStop(); waitingCard('Spojení se serverem spadlo.', true); };
  $('confirm').onclick = submit;   // v duelu potvrzení posílá tip, nevyhodnocuje kolo lokálně
  document.body.dataset.phase = 'duel';
  $('duel').hidden = false;
  waitingCard(note ?? `Pošli kamarádovi odkaz — kód zápasu je ${code}.`);
}

function handle(msg) {
  you = msg.you ?? you;
  switch (msg.type) {
    case 'state': return onState(msg);
    case 'round': return onRound(msg);
    case 'deadline': return board.timerSetLeft(msg.msLeft);
    case 'opponent': return onOpponent(msg);
    case 'reveal': return onReveal(msg);
    case 'end': return onEnd(msg);
    case 'error': return waitingCard('Zápas je plný — tenhle kód už hrajou dva lidi.', true);
  }
}

function onState(msg) {
  const them = msg.players.find(p => p.id !== you);
  $('duel-name').textContent = them?.nick ?? 'soupeř';
  $('duel-me').textContent = (msg.players.find(p => p.id === you)?.total ?? 0).toLocaleString('cs');
  $('duel-them').textContent = (them?.total ?? 0).toLocaleString('cs');
  $('duel-flag').className = `duel-flag ${them && !them.connected ? 'gone' : ''}`;
  if (msg.phase === 'waiting') waitingCard(`Čekám na soupeře. Kód zápasu: ${code}`);
  if (msg.phase === 'countdown') waitingCard(`${them?.nick ?? 'Soupeř'} je tu. Začínáme!`);
  if (msg.phase === 'paused') waitingCard('Soupeř se odpojil — čekám 15 vteřin.');
  if (msg.phase === 'drawing' && !overlay.hidden) overlay.hidden = true; // návrat doprostřed kola
}

function onRound(msg) {
  roundIdx = msg.i;
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
  board.setRound(msg.viewport, msg.lines.length);
  board.maybeShowHint();
  board.timerStart(msg.msLeft, submit); // vypršení = odevzdej, co je nakresleno
}

function submit() {
  board.timerStop();
  $('confirm').disabled = true;
  $('clear').disabled = true;
  ws?.send(JSON.stringify({ type: 'submit', i: roundIdx, lines: board.segments() }));
}

function onOpponent(msg) {
  if (msg.id === you) return;
  $('duel-flag').className = `duel-flag ${!msg.connected ? 'gone' : msg.submitted ? 'submitted' : 'waiting'}`;
}

function onReveal(msg) {
  board.timerStop();
  board.revealAxes(msg.axes);
  $('duel-me').textContent = msg.totals[you].toLocaleString('cs');
  const themId = Object.keys(msg.totals).find(id => id !== you);
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
  const themId = Object.keys(msg.totals).find(id => id !== you);
  const verdict = msg.reason === 'forfeit'
    ? (msg.winner === you ? 'Soupeř se odpojil — vyhrál jsi' : 'Odpojil ses — zápas propadl')
    : msg.winner === null ? 'Remíza' : msg.winner === you ? 'Vyhrál jsi!' : 'Prohrál jsi';
  showCard(`
    <p class="label">konec zápasu · ${code}</p>
    <h2>${verdict}</h2>
    <div class="big">${msg.totals[you]} : ${msg.totals[themId] ?? 0}</div>
    <button class="btn btn-primary" id="again">Nový duel</button>
    <button class="link-btn" id="back">← zpět na začátek</button>
  `, () => {
    $('again').onclick = () => { ws?.close(); sessionStorage.removeItem('pmg-duel-token'); location.href = '/?duel=new'; };
    $('back').onclick = () => { ws?.close(); onLeave(); };
  });
  ws = null;
}

function waitingCard(text, dead = false) {
  showCard(`
    <p class="label">duel</p>
    <h2>${dead ? 'Konec' : 'Duel'}</h2>
    <p id="duel-note"></p>
    ${dead ? '<button class="link-btn" id="back">← zpět na začátek</button>' : ''}
  `, card => {
    card.querySelector('#duel-note').textContent = text; // text může nést nick → jen textContent
    if (dead) $('back').onclick = () => onLeave();
  });
}
