ALTER TABLE usage_daily ADD COLUMN gen_ms INTEGER;

ALTER TABLE usage_daily ADD COLUMN gen_samples INTEGER;

CREATE TABLE activity_daily (
  device_id TEXT NOT NULL REFERENCES devices (id) ON DELETE CASCADE,
  day TEXT NOT NULL,
  active_ms INTEGER NOT NULL,
  longest_ms INTEGER NOT NULL,
  sessions INTEGER NOT NULL,
  max_concurrent INTEGER NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (device_id, day)
);

CREATE INDEX activity_daily_day ON activity_daily (day);

CREATE TABLE client_activity_daily (
  device_id TEXT NOT NULL REFERENCES devices (id) ON DELETE CASCADE,
  day TEXT NOT NULL,
  client TEXT NOT NULL,
  prompts INTEGER NOT NULL,
  hours TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (device_id, day, client)
);

CREATE INDEX client_activity_daily_day ON client_activity_daily (day);
