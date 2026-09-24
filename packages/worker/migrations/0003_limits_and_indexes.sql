CREATE INDEX usage_daily_client ON usage_daily (client);

CREATE INDEX usage_daily_model ON usage_daily (model);

CREATE UNIQUE INDEX users_login_nocase ON users (login COLLATE NOCASE);

ALTER TABLE users ADD COLUMN blocked_at TEXT;

ALTER TABLE api_tokens ADD COLUMN expires_at TEXT;

UPDATE api_tokens SET expires_at = strftime('%Y-%m-%dT%H:%M:%fZ', created_at, '+90 days') WHERE expires_at IS NULL;
