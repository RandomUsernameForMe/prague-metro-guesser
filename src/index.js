import * as score from './api/score.js';
import * as leaderboard from './api/leaderboard.js';
import * as guess from './api/guess.js';
import * as report from './api/report.js';
import * as stats from './api/stats.js';
import * as exportCsv from './api/export.js';
import * as adminReports from './admin/reports.js';

// cesta → metoda → handler; podpis zůstal z Pages Functions: ({ request, env })
const ROUTES = {
  '/api/score': { POST: score.onRequestPost },
  '/api/leaderboard': { GET: leaderboard.onRequestGet },
  '/api/guess': { POST: guess.onRequestPost },
  '/api/report': { POST: report.onRequestPost },
  '/api/stats': { GET: stats.onRequestGet },
  '/api/export': { GET: exportCsv.onRequestGet },
  '/admin/reports': { GET: adminReports.onRequestGet },
};

export default {
  async fetch(request, env) {
    const { pathname } = new URL(request.url);
    const handler = ROUTES[pathname]?.[request.method];
    // statické soubory řeší [assets] dřív, než se sem request dostane
    if (!handler) return new Response('not found', { status: 404 });
    return handler({ request, env });
  },
};
