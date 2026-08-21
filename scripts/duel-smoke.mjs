// Dva WebSocket klienti odehrají jedno kolo proti běžícímu `wrangler dev`.
// Spuštění: node scripts/duel-smoke.mjs [base-url]
// Vyžaduje Node 22+ (globální WebSocket).
const base = (process.argv[2] ?? 'http://localhost:8787').replace(/^http/, 'ws');
// kód je nový při každém běhu — jinak by druhý běh narazil na dohraný zápas ve storage
const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const code = Array.from({ length: 6 }, () => ALPHABET[Math.floor(Math.random() * 32)]).join('');
const seen = { a: [], b: [] };
// session musí být UUID, jinak MatchDO kolo do `guesses` nezapíše
const session = crypto.randomUUID();

const open = (who, token) => new Promise(resolve => {
  const ws = new WebSocket(`${base}/api/duel/${code}?player=${token}&nick=${who}&session=${session}`);
  ws.addEventListener('message', e => {
    const msg = JSON.parse(e.data);
    seen[who].push(msg.type === 'state' ? `state:${msg.phase}` : msg.type);
    // zápas se bez potvrzení obou nerozjede — ready check je brána před prvním kolem
    if (msg.type === 'state' && msg.phase === 'ready') {
      setTimeout(() => ws.send(JSON.stringify({ type: 'ready' })), who === 'a' ? 100 : 600);
    }
    if (msg.type === 'round') {
      // kolo přišlo i s výřezem → nakresli úsečku doprostřed a odevzdej
      const { lat, lng } = msg.viewport;
      const lines = msg.lines.map(() => [[lat - 0.0005, lng], [lat + 0.0005, lng]]);
      setTimeout(() => ws.send(JSON.stringify({ type: 'submit', i: msg.i, lines })), who === 'a' ? 200 : 4000);
    }
  });
  ws.addEventListener('open', () => resolve(ws));
});

const a = await open('a', 'aaaaaaaaaaaaaaaa');
const b = await open('b', 'bbbbbbbbbbbbbbbb');
await new Promise(r => setTimeout(r, 12000));
a.close(); b.close();

console.log('kód:', code);
console.log('a:', seen.a.join(' → '));
console.log('b:', seen.b.join(' → '));
const need = ['state:ready', 'state:countdown', 'round', 'deadline', 'reveal'];
const missing = need.filter(t => !seen.a.includes(t));
console.log(missing.length ? `CHYBA: chybí ${missing.join(', ')}` : 'OK');
const ok = !missing.length;
process.exit(ok ? 0 : 1);
