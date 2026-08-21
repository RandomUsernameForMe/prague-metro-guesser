import { roundViewport, VIEW_SIZE } from './seed.mjs';
import { toLocalMeters } from './geo.mjs';

const NICK_RE = /^[\p{L}\p{N} _-]{3,16}$/u;
const MARGIN = 5; // m tolerance na hraně výřezu
const WEEK_RE = /^\d{4}-\d{2}$/;
const MODES = ['weekly', 'warmup', 'casual', 'duel'];
const NOTE = { min: 3, max: 1000 };
const PRAHA = { lat: [49.8, 50.3], lng: [14.0, 14.8] }; // hrubý rám, jen ať do DB nelezou nesmysly

// segments = úsečky jednoho kola, jedna na každou linku stanice: [[[lat,lng],[lat,lng]], ...]
// round: {station, u, v}; allowPartial = propadlé kolo, hráč nemusel stihnout všechny úsečky
export function validateRound(segments, round, { allowPartial = false } = {}) {
  const expected = round.station.lines.length;
  if (!Array.isArray(segments)) return { ok: false, error: 'segments' };
  if (allowPartial ? segments.length > expected : segments.length !== expected) return { ok: false, error: 'segments' };
  const vp = roundViewport(round);
  for (const seg of segments) {
    if (!Array.isArray(seg) || seg.length !== 2) return { ok: false, error: 'points' };
    for (const p of seg) {
      if (!Array.isArray(p) || p.length !== 2 || !p.every(Number.isFinite)) return { ok: false, error: 'points' };
      const [x, y] = toLocalMeters(p[0], p[1], vp);
      if (Math.abs(x) > VIEW_SIZE / 2 + MARGIN || Math.abs(y) > VIEW_SIZE / 2 + MARGIN) return { ok: false, error: 'bounds' };
    }
  }
  return { ok: true };
}

// body: {week, nick, lines}; lines[i] = úsečky kola i, jedna na každou linku stanice:
// [[[lat,lng],[lat,lng]], ...], nebo null = propadlé kolo (vypršel čas) → 0 bodů.
// rounds: výstup weeklyChallenge; currentWeek: isoWeek(now)
export function validateSubmission(body, rounds, currentWeek) {
  if (!body || typeof body !== 'object') return { ok: false, error: 'body' };
  if (typeof body.nick !== 'string' || !NICK_RE.test(body.nick)) return { ok: false, error: 'nick' };
  if (body.week !== currentWeek) return { ok: false, error: 'week' };
  if (!Array.isArray(body.lines) || body.lines.length !== rounds.length) return { ok: false, error: 'lines' };
  for (let i = 0; i < rounds.length; i++) {
    const segments = body.lines[i];
    if (segments === null) continue; // propadlé kolo
    const r = validateRound(segments, rounds[i]);
    if (!r.ok) return { ok: false, error: `${r.error} round ${i}` };
  }
  return { ok: true };
}

// body: {stationId, note, mode, week, segments}; segments = co hráč nakreslil v tom kole
// (jedna úsečka na linku), nebo null u propadlého kola. Vrací i osekaná data k zápisu.
export function validateReport(body, stations) {
  if (!body || typeof body !== 'object') return { ok: false, error: 'body' };
  const station = stations.find(s => s.id === body.stationId);
  if (!station) return { ok: false, error: 'station' };
  const note = typeof body.note === 'string' ? body.note.trim() : '';
  if (note.length < NOTE.min || note.length > NOTE.max) return { ok: false, error: 'note' };
  if (!MODES.includes(body.mode)) return { ok: false, error: 'mode' };
  if (!WEEK_RE.test(body.week)) return { ok: false, error: 'week' };

  const segments = body.segments ?? null;
  if (segments !== null) {
    if (!Array.isArray(segments) || !segments.length || segments.length > 3) return { ok: false, error: 'segments' };
    for (const seg of segments) {
      if (!Array.isArray(seg) || seg.length !== 2) return { ok: false, error: 'segments' };
      for (const p of seg) {
        if (!Array.isArray(p) || p.length !== 2 || !p.every(Number.isFinite)) return { ok: false, error: 'segments' };
        if (p[0] < PRAHA.lat[0] || p[0] > PRAHA.lat[1]) return { ok: false, error: 'segments' };
        if (p[1] < PRAHA.lng[0] || p[1] > PRAHA.lng[1]) return { ok: false, error: 'segments' };
      }
    }
  }
  return { ok: true, station, note, segments };
}
