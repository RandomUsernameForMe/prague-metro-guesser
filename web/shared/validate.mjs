import { roundViewport, VIEW_SIZE } from './seed.mjs';
import { toLocalMeters } from './geo.mjs';

const NICK_RE = /^[\p{L}\p{N} _-]{3,16}$/u;
const MARGIN = 5; // m tolerance na hraně výřezu

// body: {week, nick, lines}; rounds: výstup weeklyChallenge; currentWeek: isoWeek(now)
export function validateSubmission(body, rounds, currentWeek) {
  if (!body || typeof body !== 'object') return { ok: false, error: 'body' };
  if (typeof body.nick !== 'string' || !NICK_RE.test(body.nick)) return { ok: false, error: 'nick' };
  if (body.week !== currentWeek) return { ok: false, error: 'week' };
  if (!Array.isArray(body.lines) || body.lines.length !== rounds.length) return { ok: false, error: 'lines' };
  for (let i = 0; i < rounds.length; i++) {
    const line = body.lines[i];
    if (!Array.isArray(line) || line.length < 2 || line.length > 200) return { ok: false, error: `points round ${i}` };
    const vp = roundViewport(rounds[i]);
    for (const p of line) {
      if (!Array.isArray(p) || p.length !== 2 || !p.every(Number.isFinite)) return { ok: false, error: `points round ${i}` };
      const [x, y] = toLocalMeters(p[0], p[1], vp);
      if (Math.abs(x) > VIEW_SIZE / 2 + MARGIN || Math.abs(y) > VIEW_SIZE / 2 + MARGIN) return { ok: false, error: `bounds round ${i}` };
    }
  }
  return { ok: true };
}
