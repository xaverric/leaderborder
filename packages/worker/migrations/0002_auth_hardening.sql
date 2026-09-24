ALTER TABLE api_tokens ADD COLUMN access_policy TEXT NOT NULL DEFAULT '';

CREATE TABLE web_sessions (
  token_hash TEXT PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  expires_at INTEGER NOT NULL,
  access_policy TEXT NOT NULL
);

CREATE INDEX web_sessions_expires_at ON web_sessions (expires_at);
