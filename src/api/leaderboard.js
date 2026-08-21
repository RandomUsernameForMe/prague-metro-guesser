const json = (obj, status = 200) =>
  new Response(JSON.stringify(obj), { status, headers: { 'content-type': 'application/json' } });

export async function onRequestGet({ request, env }) {
  const week = new URL(request.url).searchParams.get('week');
  if (!/^\d{4}-\d{2}$/.test(week || '')) return json({ error: 'week' }, 400);
  const { results } = await env.DB.prepare(
    'SELECT nick, score FROM scores WHERE week = ? ORDER BY score DESC, created_at ASC LIMIT 100'
  ).bind(week).all();
  return json({ week, entries: results });
}
