// Reload uprostřed kola. Stavový automat na tohle nestačí — obojí se rozhoduje
// až v Durable Objectu, takže se to musí projet proti běžícímu workeru:
//   1) návrat doprostřed kola dostane zadání (výřez, jméno, linky), jinak hráč kreslí naslepo
//   2) close starého socketu zápas nepauzne, když už je připojený nový
// Spuštění: node scripts/duel-reconnect-smoke.mjs [base-url]
// Vyžaduje Node 22+ (globální WebSocket).
const base = (process.argv[2] ?? 'http://localhost:8787').replace(/^http/, 'ws');
const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const code = Array.from({ length: 6 }, () => ALPHABET[Math.floor(Math.random() * 32)]).join('');
const session = crypto.randomUUID();
const log = [];

const open = (who, token) => new Promise(resolve => {
  const ws = new WebSocket(`${base}/api/duel/${code}?player=${token}&nick=${who}&session=${session}`);
  ws.addEventListener('message', e => log.push({ who, msg: JSON.parse(e.data) }));
  ws.addEventListener('open', () => resolve(ws));
});

const seen = (who, ok) => log.find(l => l.who === who && ok(l.msg));

const waitFor = (who, ok, ms) => new Promise((resolve, reject) => {
  const started = Date.now();
  const iv = setInterval(() => {
    if (seen(who, ok)) { clearInterval(iv); resolve(); }
    else if (Date.now() - started > ms) { clearInterval(iv); reject(new Error(`čekání na zprávu (${who}) vypršelo`)); }
  }, 50);
});

const a = await open('a', 'a'.repeat(16));
const b = await open('b', 'b'.repeat(16));
await waitFor('b', m => m.type === 'state' && m.phase === 'ready', 5000);
a.send(JSON.stringify({ type: 'ready' }));
b.send(JSON.stringify({ type: 'ready' }));
await waitFor('b', m => m.type === 'round', 10000);

// reload: nový socket se připojí dřív, než dorazí close toho starého
const a2 = await open('a2', 'a'.repeat(16));
a.close();
await waitFor('a2', m => m.type === 'state' && m.phase === 'drawing', 5000).catch(() => {});
await new Promise(r => setTimeout(r, 1000)); // ať stihne dorazit i případná pauza

const resumed = seen('a2', m => m.type === 'state' && m.phase === 'drawing')?.msg;
const dropped = seen('b', m => m.type === 'opponent' && m.connected === false)?.msg;

const fails = [];
if (!resumed) fails.push('vrácený hráč nedostal state s běžícím kolem');
else {
  if (!resumed.viewport) fails.push('state kola nenese výřez');
  if (!Array.isArray(resumed.lines) || !resumed.name) fails.push('state kola nenese jméno stanice ani linky');
  if (!(resumed.msLeft > 0)) fails.push('state kola nenese zbývající čas');
}
if (dropped) fails.push('close starého socketu zápas pauzl, i když byl nový připojený');

// 2. výpadek sítě: socket spadne a hráč se vrací do grace okna. Opačné pořadí než
// reload — nejdřív zmizí spojení, teprve pak se otevře nové.
a2.close();
await waitFor('b', m => m.type === 'state' && m.phase === 'paused', 5000)
  .catch(() => fails.push('soupeř se nedozvěděl, že se zápas pauzuje'));
const a3 = await open('a3', 'a'.repeat(16));
await waitFor('a3', m => m.type === 'state' && m.phase === 'drawing', 5000)
  .catch(() => fails.push('návrat do grace okna zápas nerozjel'));
if (seen('a3', m => m.type === 'end')) fails.push('zápas skončil, i když se hráč vrátil včas');

// 3. keepalive: MatchDO na ping odpovídá autoresponsem, bez probuzení objektu
a3.send('{"type":"ping"}');
await waitFor('a3', m => m.type === 'pong', 3000)
  .catch(() => fails.push('server neodpověděl na ping — keepalive nefunguje'));

a3.close(); b.close();
console.log('kód:', code);
const trace = who => log.filter(l => l.who === who)
  .map(l => (l.msg.type === 'state' ? `state:${l.msg.phase}` : l.msg.type)).join(' → ');
console.log('po reloadu  (a2):', trace('a2'));
console.log('po výpadku  (a3):', trace('a3'));
console.log('soupeř      (b) :', trace('b'));
console.log(fails.length ? `CHYBA: ${fails.join('; ')}` : 'OK');
process.exit(fails.length ? 1 : 0);
