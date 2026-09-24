ALTER TABLE users ADD COLUMN orgs TEXT;

CREATE TABLE access_rules (
  id INTEGER PRIMARY KEY,
  kind TEXT NOT NULL CHECK (kind IN ('login', 'org')),
  value TEXT NOT NULL,
  created_at TEXT NOT NULL,
  created_by TEXT,
  UNIQUE (kind, value)
);

CREATE TABLE access_requests (
  github_id INTEGER PRIMARY KEY,
  login TEXT NOT NULL,
  name TEXT,
  avatar_url TEXT,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'denied')),
  requested_at TEXT NOT NULL,
  last_attempt_at TEXT NOT NULL
);

CREATE INDEX access_requests_status ON access_requests (status, last_attempt_at);

CREATE TABLE settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
