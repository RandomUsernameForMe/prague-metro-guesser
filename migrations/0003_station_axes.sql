-- Ruční přepis os stanice z adminu — odpověď na hlášení „stanice je zadaná špatně“.
-- Základ zůstává web/stations.json (generovaný z Overpassu), tahle tabulka ho jen
-- překrývá: jeden řádek = jedna stanice, smazání řádku vrací původní osy.
CREATE TABLE IF NOT EXISTS station_axes (
  station_id TEXT PRIMARY KEY,
  axes_json TEXT NOT NULL,      -- [{"line":"A","pts":[[lat,lng],[lat,lng]]}, ...] — stejný tvar jako v stations.json
  note TEXT,                    -- proč se osa měnila (podle kterého hlášení)
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
