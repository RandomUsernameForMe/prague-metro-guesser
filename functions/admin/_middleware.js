// Basic Auth pro celý /admin/*. Pages spouští _middleware.js před každou routou
// v adresáři, takže heslo se ověřuje na jednom místě pro všechny admin stránky.
// Heslo: `npx wrangler pages secret put ADMIN_PASSWORD` (lokálně řádek v .dev.vars)

async function sha256(s) {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s));
  return [...new Uint8Array(buf)].map(b => b.toString(16).padStart(2, '0')).join('');
}

// hesla porovnáváme jako otisky stejné délky — na délku ani obsah se tím nedá hádat
async function authorized(request, env) {
  const expected = env.ADMIN_PASSWORD;
  if (!expected) return false; // nenastavený secret admin nikdy neotevře
  const header = request.headers.get('authorization') || '';
  if (!header.startsWith('Basic ')) return false;
  let given;
  try {
    given = atob(header.slice(6)).split(':').slice(1).join(':');
  } catch {
    return false;
  }
  return await sha256(given) === await sha256(expected);
}

export async function onRequest(context) {
  if (!await authorized(context.request, context.env)) {
    return new Response('401', {
      status: 401,
      headers: {
        'www-authenticate': 'Basic realm="metro-guesser admin", charset="UTF-8"',
        'cache-control': 'no-store',
        'x-robots-tag': 'noindex',
      },
    });
  }
  return context.next();
}
