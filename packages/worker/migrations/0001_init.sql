CREATE TABLE users (
  id INTEGER PRIMARY KEY,
  github_id INTEGER NOT NULL UNIQUE,
  login TEXT NOT NULL,
  name TEXT,
  avatar_url TEXT,
  created_at TEXT NOT NULL
);

CREATE INDEX users_login ON users (login COLLATE NOCASE);

CREATE TABLE devices (
  id TEXT PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  created_at TEXT NOT NULL,
  last_sync_at TEXT,
  revoked_at TEXT
);

CREATE INDEX devices_user_id ON devices (user_id);

CREATE TABLE api_tokens (
  id INTEGER PRIMARY KEY,
  device_id TEXT NOT NULL REFERENCES devices (id) ON DELETE CASCADE,
  token_hash TEXT NOT NULL UNIQUE,
  created_at TEXT NOT NULL,
  last_used_at TEXT,
  revoked_at TEXT
);

CREATE INDEX api_tokens_device_id ON api_tokens (device_id);

CREATE TABLE usage_daily (
  device_id TEXT NOT NULL REFERENCES devices (id) ON DELETE CASCADE,
  day TEXT NOT NULL,
  client TEXT NOT NULL,
  model TEXT NOT NULL,
  input INTEGER NOT NULL DEFAULT 0,
  output INTEGER NOT NULL DEFAULT 0,
  cache_read INTEGER NOT NULL DEFAULT 0,
  cache_write INTEGER NOT NULL DEFAULT 0,
  reasoning INTEGER NOT NULL DEFAULT 0,
  cost_usd REAL NOT NULL DEFAULT 0,
  messages INTEGER NOT NULL DEFAULT 0,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (device_id, day, client, model)
);

CREATE INDEX usage_daily_day ON usage_daily (day);
