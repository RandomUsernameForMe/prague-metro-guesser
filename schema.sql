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
-- rate limit se ptá „kolik zápisů má tahle IP za poslední hodinu"; bez indexu se čte celá tabulka
CREATE INDEX IF NOT EXISTS idx_scores_ip ON scores(ip_hash, created_at);

-- hlášení „stanice je v aplikaci zadaná špatně" z výsledkové karty
CREATE TABLE IF NOT EXISTS reports (
  station_id TEXT NOT NULL,
  station_name TEXT NOT NULL,   -- jak se stanice jmenovala v době hlášení
  note TEXT NOT NULL,           -- komentář hráče; prázdný, když jen zakreslil osu
  mode TEXT NOT NULL,
  week TEXT NOT NULL,
  segments_json TEXT,           -- úsečky, které hráč nakreslil v kole; NULL u propadlého kola
  fix_json TEXT,                -- kudy podle hráče osa vede doopravdy; NULL = jen slovní hlášení
  -- migrace existující DB: ALTER TABLE reports ADD COLUMN fix_json TEXT;
  ip_hash TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_reports_created ON reports(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_reports_ip ON reports(ip_hash, created_at);

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
CREATE INDEX IF NOT EXISTS idx_guesses_ip ON guesses(ip_hash, created_at);

-- jeden řádek = jeden dohraný duel; zapisuje MatchDO na konci zápasu
CREATE TABLE IF NOT EXISTS duels (
  code TEXT PRIMARY KEY,        -- kód zápasu, zároveň jméno Durable Objectu
  nick_a TEXT NOT NULL,
  nick_b TEXT NOT NULL,
  score_a INTEGER NOT NULL,
  score_b INTEGER NOT NULL,
  winner TEXT,                  -- 'a' | 'b' | NULL při remíze
  ended_reason TEXT NOT NULL,   -- 'complete' | 'forfeit' | 'noshow' | 'alone' (soupeř nikdy nedorazil)
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_duels_created ON duels(created_at DESC);
