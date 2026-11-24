DROP TABLE entries;
--> statement-breakpoint
CREATE TABLE ip_checks (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  ip TEXT NOT NULL UNIQUE,
  score INTEGER NOT NULL,
  grade TEXT NOT NULL,
  ip_type TEXT NOT NULL,
  country TEXT NOT NULL DEFAULT '',
  city TEXT NOT NULL DEFAULT '',
  isp TEXT NOT NULL DEFAULT '',
  report_json TEXT NOT NULL,
  checked_at INTEGER NOT NULL
);
