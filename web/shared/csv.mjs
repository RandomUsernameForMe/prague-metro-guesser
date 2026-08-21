// RFC 4180: buňku obal uvozovkami, jen když obsahuje oddělovač, uvozovku nebo konec řádku
const cell = v => {
  if (v === null || v === undefined) return '';
  const s = String(v);
  return /[",\r\n]/.test(s) ? `"${s.replaceAll('"', '""')}"` : s;
};

export const csvRow = values => values.map(cell).join(',');
