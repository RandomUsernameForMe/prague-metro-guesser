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
