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
