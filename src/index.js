import * as score from './api/score.js';
import * as leaderboard from './api/leaderboard.js';
import * as guess from './api/guess.js';
import * as hardcore from './api/hardcore.js';
import * as report from './api/report.js';
import * as stats from './api/stats.js';
import * as exportCsv from './api/export.js';
import * as adminIndex from './admin/index.js';
import * as adminStats from './admin/stats.js';
import * as adminReports from './admin/reports.js';
import * as adminHeatmap from './admin/heatmap.js';
import { guard } from './admin/auth.js';

export { MatchDO } from './match-do.js';
export { LobbyDO } from './lobby-do.js';

// cesta → metoda → handler; podpis zůstal z Pages Functions: ({ request, env })
const ROUTES = {
  '/api/score': { POST: score.onRequestPost },
  '/api/leaderboard': { GET: leaderboard.onRequestGet },
  '/api/guess': { POST: guess.onRequestPost },
  '/api/hardcore': { GET: hardcore.onRequestGet, POST: hardcore.onRequestPost },
  '/api/report': { POST: report.onRequestPost },
  '/api/stats': { GET: stats.onRequestGet },
  '/api/export': { GET: exportCsv.onRequestGet },
};

// celý /admin/* je za Basic Authem; '/admin' i '/admin/' vedou na přehled
const ADMIN_ROUTES = {
  '/admin': { GET: adminIndex.onRequestGet },
  '/admin/': { GET: adminIndex.onRequestGet },
  '/admin/stats': { GET: adminStats.onRequestGet },
  '/admin/reports': { GET: adminReports.onRequestGet },
  '/admin/heatmap': { GET: adminHeatmap.onRequestGet },   // ?station=<id>
};

const MATCH_PATH = /^\/api\/duel\/([ABCDEFGHJKLMNPQRSTUVWXYZ23456789]{6})$/;

// Cizí stránka umí poslat prostý POST bez preflightu (content-type: text/plain) a zapsat
// tak data pod IP návštěvníka. Origin je jediné, čím se od našeho formuláře liší;
// požadavky bez Origin (curl, smoke skript) prohlížeč neposílá, takže CSRF to nejsou.
const sameOrigin = (request, url) => {
  const origin = request.headers.get('origin');
  return !origin || origin === url.origin;
};

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (request.method === 'POST' && !sameOrigin(request, url)) {
      return new Response('bad origin', { status: 403 });
    }

    if (url.pathname === '/api/duel/queue' && request.method === 'POST') {
      return env.LOBBY.get(env.LOBBY.idFromName('global')).fetch(request);
    }
    const match = url.pathname.match(MATCH_PATH);
    if (match) {
      // kód zápasu je zároveň jméno objektu — žádná mapovací tabulka
      return env.MATCH.get(env.MATCH.idFromName(match[1])).fetch(request);
    }

    // heslo se ověřuje pro celý podstrom, ne jen pro známé routy
    if (url.pathname === '/admin' || url.pathname.startsWith('/admin/')) {
      const denied = await guard(request, env);
      if (denied) return denied;
      const admin = ADMIN_ROUTES[url.pathname]?.[request.method];
      return admin ? admin({ request, env }) : new Response('not found', { status: 404 });
    }

    const handler = ROUTES[url.pathname]?.[request.method];
    // statické soubory řeší [assets] dřív, než se sem request dostane
    if (!handler) return new Response('not found', { status: 404 });
    return handler({ request, env });
  },
};
