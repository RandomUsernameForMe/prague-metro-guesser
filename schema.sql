CREATE TABLE IF NOT EXISTS scores (
  week TEXT NOT NULL,
  nick TEXT NOT NULL,
  score INTEGER NOT NULL,
  lines_json TEXT NOT NULL,
  ip_hash TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(week, nick)
);
CREATE INDEX IF NOT EXISTS idx_scores_week ON scores(week, score DESC);

-- hlášení „stanice je v aplikaci zadaná špatně" z výsledkové karty
CREATE TABLE IF NOT EXISTS reports (
  station_id TEXT NOT NULL,
  station_name TEXT NOT NULL,   -- jak se stanice jmenovala v době hlášení
  note TEXT NOT NULL,           -- jak to podle hráče má být správně
  mode TEXT NOT NULL,
  week TEXT NOT NULL,
  segments_json TEXT,           -- úsečky, které hráč nakreslil; NULL u propadlého kola
  ip_hash TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_reports_created ON reports(created_at DESC);

-- jeden řádek = jedno odehrané kolo, ve všech režimech; podklad pro exporty a statistiky
CREATE TABLE IF NOT EXISTS guesses (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  session TEXT NOT NULL,        -- náhodné UUID z localStorage, pseudonymní
  mode TEXT NOT NULL,           -- weekly | warmup | casual
  week TEXT NOT NULL,
  station_id TEXT NOT NULL,
  round_idx INTEGER NOT NULL,
  u REAL NOT NULL,              -- kde ve výřezu stanice ležela: zlomek zleva
  v REAL NOT NULL,              -- zlomek shora
  segments_json TEXT NOT NULL,  -- co hráč nakreslil: [[[lat,lng],[lat,lng]], ...]
  dist_m REAL,                  -- NULL u propadlého kola
  score INTEGER NOT NULL,
  per_line_json TEXT,           -- [{"line":"A","d":42.1}, ...]; NULL u propadlého kola
  ms INTEGER NOT NULL,          -- jak dlouho hráč kreslil
  timed_out INTEGER NOT NULL,
  forfeited INTEGER NOT NULL,   -- nestihl všechny úsečky → 0 bodů
  ip_hash TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_guesses_station ON guesses(station_id);
CREATE INDEX IF NOT EXISTS idx_guesses_created ON guesses(created_at);
