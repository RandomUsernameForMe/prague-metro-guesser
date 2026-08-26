// Sdílené pro všechny stránky pod /admin/. Soubory s podtržítkem Pages neroutuje,
// takže tenhle modul nemá veřejné URL.

export const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

// Čísla formátujeme ručně, ne přes Intl — Node a Workers by se na locale mohly lišit
// a tabulka s tisíci oddělenými jinak v testu než v produkci je zbytečná past.
export const int = n => (n === null || n === undefined ? '—' : String(Math.round(n)));

export const fix1 = n => (n === null || n === undefined ? '—' : String(Math.round(n * 10) / 10).replace('.', ','));

// prázdná databáze je normální stav: bez kol není co dělit
export const pct = (part, total) => (!total ? '—' : `${Math.round((part / total) * 100)} %`);

export const secs = ms => (ms === null || ms === undefined ? '—' : `${fix1(ms / 1000)} s`);

// '2026-08-21' → '21. 8.'; cokoli jiného projde beze změny
export const den = iso => {
  const m = String(iso).match(/^\d{4}-(\d{2})-(\d{2})$/);
  return m ? `${Number(m[2])}. ${Number(m[1])}.` : String(iso);
};

const NAV = [
  ['/admin/', 'přehled'],
  ['/admin/stats', 'statistiky'],
  ['/admin/reports', 'hlášení'],
];

const CSS = `
  body { font: 14px/1.5 system-ui, sans-serif; margin: 24px; background: #121416; color: #e8e8e8; }
  h1 { font-size: 20px; }
  h2 { font-size: 16px; margin-top: 32px; }
  a { color: #8ab4f8; }
  table { border-collapse: collapse; width: 100%; }
  th, td { text-align: left; padding: 8px 10px; border-bottom: 1px solid #2b2f33; vertical-align: top; }
  th { color: #9aa0a6; font-weight: 600; }
  td.num, th.num { text-align: right; font-variant-numeric: tabular-nums; }
  td.note { white-space: pre-wrap; max-width: 40ch; }
  small, i { color: #9aa0a6; }
  .l { color: #121416; background: #e8e8e8; padding: 0 5px; border-radius: 3px; font-weight: 700; }
  nav { display: flex; gap: 4px; margin-bottom: 20px; }
  nav a { padding: 6px 12px; border-radius: 4px; text-decoration: none; background: #1c1f22; }
  nav a[aria-current] { background: #e8e8e8; color: #121416; font-weight: 600; }
  .cards { display: flex; flex-wrap: wrap; gap: 12px; margin: 16px 0; }
  .card { background: #1c1f22; border-radius: 6px; padding: 12px 18px; min-width: 130px; }
  .card b { display: block; font-size: 26px; font-weight: 600; font-variant-numeric: tabular-nums; }
  .card span { color: #9aa0a6; font-size: 12px; }
  button { font: inherit; color: inherit; background: #1c1f22; border: 1px solid #2b2f33;
    border-radius: 4px; padding: 5px 12px; cursor: pointer; }
  button[aria-current] { background: #e8e8e8; color: #121416; font-weight: 600; }
  input { font: inherit; color: inherit; background: #1c1f22; border: 1px solid #2b2f33;
    border-radius: 4px; padding: 5px 8px; }
  code { color: #9aa0a6; }
  .err { color: #ff8080; }
`;

export const card = (label, value) => `<div class="card"><b>${esc(value)}</b><span>${esc(label)}</span></div>`;

export function page(title, path, body) {
  const nav = NAV.map(([href, label]) =>
    `<a href="${href}"${href === path ? ' aria-current="page"' : ''}>${label}</a>`).join('');
  return `<!DOCTYPE html>
<html lang="cs"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(title)} · metro guesser</title>
<style>${CSS}</style></head><body>
<nav>${nav}</nav>
<h1>${esc(title)}</h1>
${body}
</body></html>`;
}

export const html = body => new Response(body, {
  headers: {
    'content-type': 'text/html; charset=utf-8',
    'cache-control': 'no-store',
    'x-robots-tag': 'noindex',
  },
});
