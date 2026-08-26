const json = (obj, status = 200) =>
  new Response(JSON.stringify(obj), { status, headers: { 'content-type': 'application/json' } });

// Vrací dvacítku nejlepších a k tomu řádek hráče ?nick=, i když je až někde dole —
// pořadí počítá SQL, klient ho jen vypíše, takže po přeskočené dvacítce sedí číslo.
export async function onRequestGet({ request, env }) {
  const params = new URL(request.url).searchParams;
  const week = params.get('week');
  if (!/^\d{4}-\d{2}$/.test(week || '')) return json({ error: 'week' }, 400);
  const { results } = await env.DB.prepare(
    `SELECT nick, score, pos FROM (
       SELECT nick, score, ROW_NUMBER() OVER (ORDER BY score DESC, created_at ASC) AS pos
       FROM scores WHERE week = ?
     ) WHERE pos <= 20 OR nick = ?
     ORDER BY pos`
  ).bind(week, params.get('nick') ?? '').all();
  return json({ week, entries: results });
}
