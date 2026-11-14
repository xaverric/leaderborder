CREATE VIEW usage_effective AS
SELECT device_id, day, client, model, input, output, cache_read, cache_write, reasoning, cost_usd, messages, updated_at, gen_ms, gen_samples
FROM usage_daily
WHERE client <> 'cursor'
UNION ALL
SELECT device_id, day, client, model, input, output, cache_read, cache_write, reasoning, cost_usd, messages, updated_at, gen_ms, gen_samples
FROM (
  SELECT ud.*, ROW_NUMBER() OVER (
    PARTITION BY d.user_id, ud.day, ud.model
    ORDER BY ud.input + ud.output + ud.cache_read + ud.cache_write DESC, ud.updated_at DESC, ud.device_id
  ) AS pick
  FROM usage_daily ud JOIN devices d ON d.id = ud.device_id
  WHERE ud.client = 'cursor'
)
WHERE pick = 1;
