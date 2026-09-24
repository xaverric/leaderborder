INSERT OR IGNORE INTO users (id, github_id, login, name, avatar_url, created_at) VALUES
  (1, 1, 'ada', 'Ada Lovelace', 'https://avatars.githubusercontent.com/u/1', strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '-90 days')),
  (2, 2, 'linus', 'Linus Torvalds', 'https://avatars.githubusercontent.com/u/2', strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '-90 days')),
  (3, 3, 'grace', 'Grace Hopper', 'https://avatars.githubusercontent.com/u/3', strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '-80 days')),
  (4, 4, 'ken', 'Ken Thompson', 'https://avatars.githubusercontent.com/u/4', strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '-60 days')),
  (5, 5, 'margaret', 'Margaret Hamilton', 'https://avatars.githubusercontent.com/u/5', strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '-45 days')),
  (6, 6, 'dennis', 'Dennis Ritchie', 'https://avatars.githubusercontent.com/u/6', strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '-20 days'));

INSERT OR IGNORE INTO devices (id, user_id, name, created_at, last_sync_at) VALUES
  ('0b6f3f0e-1a2b-4c3d-8e4f-000000000001', 1, 'Ada''s MacBook Pro', strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '-90 days'), strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '-1 hours')),
  ('0b6f3f0e-1a2b-4c3d-8e4f-000000000002', 1, 'Ada''s Mac mini', strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '-70 days'), strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '-3 hours')),
  ('0b6f3f0e-1a2b-4c3d-8e4f-000000000003', 2, 'linus-mbp', strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '-90 days'), strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '-2 hours')),
  ('0b6f3f0e-1a2b-4c3d-8e4f-000000000004', 2, 'linus-studio', strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '-50 days'), strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '-1 days')),
  ('0b6f3f0e-1a2b-4c3d-8e4f-000000000005', 3, 'Grace''s MacBook Air', strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '-80 days'), strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '-30 minutes')),
  ('0b6f3f0e-1a2b-4c3d-8e4f-000000000006', 4, 'ken-mbp', strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '-60 days'), strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '-5 hours')),
  ('0b6f3f0e-1a2b-4c3d-8e4f-000000000007', 5, 'Margaret''s MacBook Pro', strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '-45 days'), strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '-2 days')),
  ('0b6f3f0e-1a2b-4c3d-8e4f-000000000008', 6, 'dennis-air', strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '-20 days'), strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '-4 hours'));

WITH RECURSIVE
  days(n) AS (SELECT 0 UNION ALL SELECT n + 1 FROM days WHERE n < 89),
  plan(device, client, model, base, rate, since, k) AS (VALUES
    ('0b6f3f0e-1a2b-4c3d-8e4f-000000000001', 'claude', 'claude-opus-5', 90000, 15.0, 89, 1),
    ('0b6f3f0e-1a2b-4c3d-8e4f-000000000001', 'claude', 'claude-sonnet-5', 140000, 3.0, 89, 2),
    ('0b6f3f0e-1a2b-4c3d-8e4f-000000000002', 'codex', 'gpt-5-codex', 110000, 1.25, 69, 3),
    ('0b6f3f0e-1a2b-4c3d-8e4f-000000000003', 'codex', 'gpt-5', 160000, 1.25, 89, 4),
    ('0b6f3f0e-1a2b-4c3d-8e4f-000000000003', 'cursor', 'claude-sonnet-5', 70000, 3.0, 89, 5),
    ('0b6f3f0e-1a2b-4c3d-8e4f-000000000004', 'gemini', 'gemini-3-pro', 80000, 2.0, 49, 6),
    ('0b6f3f0e-1a2b-4c3d-8e4f-000000000005', 'claude', 'claude-sonnet-5', 120000, 3.0, 79, 7),
    ('0b6f3f0e-1a2b-4c3d-8e4f-000000000005', 'cursor', 'gpt-5', 50000, 1.25, 79, 8),
    ('0b6f3f0e-1a2b-4c3d-8e4f-000000000006', 'gemini', 'gemini-3-pro', 100000, 2.0, 59, 9),
    ('0b6f3f0e-1a2b-4c3d-8e4f-000000000006', 'gemini', 'gemini-3-flash', 150000, 0.3, 59, 10),
    ('0b6f3f0e-1a2b-4c3d-8e4f-000000000007', 'claude', 'claude-opus-5', 60000, 15.0, 44, 11),
    ('0b6f3f0e-1a2b-4c3d-8e4f-000000000007', 'codex', 'gpt-5-codex', 90000, 1.25, 44, 12),
    ('0b6f3f0e-1a2b-4c3d-8e4f-000000000008', 'claude', 'claude-haiku-4-5', 130000, 1.0, 19, 13),
    ('0b6f3f0e-1a2b-4c3d-8e4f-000000000008', 'cursor', 'gpt-5', 40000, 1.25, 19, 14)
  ),
  raw AS (
    SELECT p.device, p.client, p.model, p.rate, p.k, d.n,
      date('now', '-' || d.n || ' days') AS day,
      (d.n * 7919 + p.k * 104729) % 100 AS f,
      CAST(p.base * (((d.n * 7919 + p.k * 104729) % 100) + 20) / 100.0 * (1.6 - d.n / 150.0) AS INTEGER) AS input
    FROM plan p CROSS JOIN days d
    WHERE d.n <= p.since
  )
INSERT INTO usage_daily (device_id, day, client, model, input, output, cache_read, cache_write, reasoning, cost_usd, messages, updated_at)
SELECT device, day, client, model,
  input,
  input / 4,
  input * 7,
  input / 3,
  CASE WHEN client IN ('codex', 'gemini') THEN input / 16 ELSE 0 END,
  round((input * rate + (input / 4) * rate * 5 + input * 7 * rate * 0.1 + (input / 3) * rate * 1.25) / 1000000.0, 4),
  1 + f / 3,
  strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
FROM raw
WHERE f >= 18 AND (n + k) % 7 <> 3
ON CONFLICT (device_id, day, client, model) DO UPDATE SET
  input = excluded.input, output = excluded.output, cache_read = excluded.cache_read, cache_write = excluded.cache_write,
  reasoning = excluded.reasoning, cost_usd = excluded.cost_usd, messages = excluded.messages, updated_at = excluded.updated_at;
