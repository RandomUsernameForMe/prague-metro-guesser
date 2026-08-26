-- hardcore: jeden řádek na hráče, drží jeho nejdelší run (all-time, ne po týdnech)
CREATE TABLE IF NOT EXISTS hardcore (
  nick TEXT NOT NULL UNIQUE,
  rounds INTEGER NOT NULL,      -- kolik kol přežil; počítá server z run_json, ne klient
  seed INTEGER NOT NULL,        -- z něj se dají kola runu zrekonstruovat
  run_json TEXT NOT NULL,       -- úsečky po kolech; null = propadlé kolo
  ip_hash TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_hardcore_rounds ON hardcore(rounds DESC);
CREATE INDEX IF NOT EXISTS idx_hardcore_ip ON hardcore(ip_hash, created_at);
