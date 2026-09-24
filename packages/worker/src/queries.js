export const toUser = (row) => ({ login: row.login, name: row.name ?? row.login, avatarUrl: row.avatar_url ?? null });

export const upsertUser = async (db, { githubId, login, name, avatarUrl }, nowIso) => {
  const [, inserted] = await db.batch([
    db.prepare("UPDATE users SET login = login || '#' || github_id WHERE login = ?1 COLLATE NOCASE AND github_id != ?2").bind(login, githubId),
    db
      .prepare(
        `INSERT INTO users (github_id, login, name, avatar_url, created_at) VALUES (?1, ?2, ?3, ?4, ?5)
         ON CONFLICT (github_id) DO UPDATE SET login = excluded.login, name = excluded.name, avatar_url = excluded.avatar_url
         RETURNING id, login, name, avatar_url, blocked_at`,
      )
      .bind(githubId, login, name, avatarUrl, nowIso),
  ]);
  return inserted.results[0];
};

export const deleteUser = (db, id) => db.prepare("DELETE FROM users WHERE id = ?1").bind(id).run();

export const countActiveDevices = async (db, userId) =>
  (await db.prepare("SELECT COUNT(*) AS n FROM devices WHERE user_id = ?1 AND revoked_at IS NULL").bind(userId).first()).n;

export const usageCardinality = async (db, deviceId) => {
  const [pairs, total] = await db.batch([
    db.prepare("SELECT DISTINCT client, model FROM usage_daily WHERE device_id = ?1").bind(deviceId),
    db.prepare("SELECT COUNT(*) AS n FROM usage_daily WHERE device_id = ?1").bind(deviceId),
  ]);
  return { pairs: pairs.results.map((r) => `${r.client}\u0000${r.model}`), total: total.results[0].n };
};

export const getUserById = (db, id) => db.prepare("SELECT id, login, name, avatar_url FROM users WHERE id = ?1").bind(id).first();

export const getUserByLogin = (db, login) =>
  db.prepare("SELECT id, login, name, avatar_url FROM users WHERE login = ?1 COLLATE NOCASE ORDER BY id LIMIT 1").bind(login).first();

export const getDevice = (db, id) => db.prepare("SELECT id, user_id, revoked_at FROM devices WHERE id = ?1").bind(id).first();

export const registerDevice = (db, { deviceId, userId, name, tokenHash, nowIso, accessPolicy = "", expiresAt }) =>
  db.batch([
    db
      .prepare(
        `INSERT INTO devices (id, user_id, name, created_at) VALUES (?1, ?2, ?3, ?4)
         ON CONFLICT (id) DO UPDATE SET name = excluded.name, revoked_at = NULL WHERE devices.user_id = excluded.user_id`,
      )
      .bind(deviceId, userId, name, nowIso),
    db.prepare("UPDATE api_tokens SET revoked_at = ?1 WHERE device_id = ?2 AND revoked_at IS NULL AND EXISTS (SELECT 1 FROM devices WHERE id = ?2 AND user_id = ?3)").bind(nowIso, deviceId, userId),
    db.prepare("INSERT INTO api_tokens (device_id, token_hash, created_at, access_policy, expires_at) SELECT id, ?2, ?3, ?4, ?6 FROM devices WHERE id = ?1 AND user_id = ?5")
      .bind(deviceId, tokenHash, nowIso, accessPolicy, userId, expiresAt ?? null),
  ]);

export const findTokenAuth = (db, tokenHash, nowIso) =>
  db
    .prepare(
      `SELECT t.id AS token_id, t.token_hash, t.access_policy, d.id AS device_id, u.id, u.login, u.name, u.avatar_url
       FROM api_tokens t JOIN devices d ON d.id = t.device_id JOIN users u ON u.id = d.user_id
       WHERE t.token_hash = ?1 AND t.revoked_at IS NULL AND d.revoked_at IS NULL AND u.blocked_at IS NULL
         AND (t.expires_at IS NULL OR t.expires_at > ?2)`,
    )
    .bind(tokenHash, nowIso)
    .first();

const UPSERT_USAGE = `INSERT INTO usage_daily (device_id, day, client, model, input, output, cache_read, cache_write, reasoning, cost_usd, messages, updated_at)
  SELECT ?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12
  WHERE EXISTS (SELECT 1 FROM api_tokens t JOIN devices d ON d.id = t.device_id
    WHERE t.id = ?13 AND t.device_id = ?1 AND t.revoked_at IS NULL AND d.revoked_at IS NULL)
  ON CONFLICT (device_id, day, client, model) DO UPDATE SET
    input = excluded.input, output = excluded.output, cache_read = excluded.cache_read, cache_write = excluded.cache_write,
    reasoning = excluded.reasoning, cost_usd = excluded.cost_usd, messages = excluded.messages, updated_at = excluded.updated_at`;

export const upsertUsage = (db, { deviceId, tokenId, rows, nowIso }) => {
  const upsert = db.prepare(UPSERT_USAGE);
  return db.batch([
    ...rows.map((r) =>
      upsert.bind(deviceId, r.day, r.client, r.model, r.input, r.output, r.cacheRead, r.cacheWrite, r.reasoning, r.costUsd, r.messages, nowIso, tokenId),
    ),
    db.prepare("UPDATE devices SET last_sync_at = ?1 WHERE id = ?2 AND revoked_at IS NULL AND EXISTS (SELECT 1 FROM api_tokens WHERE id = ?3 AND device_id = ?2 AND revoked_at IS NULL)").bind(nowIso, deviceId, tokenId),
    db.prepare("UPDATE api_tokens SET last_used_at = ?1 WHERE id = ?2 AND revoked_at IS NULL").bind(nowIso, tokenId),
  ]);
};

export const upsertDevUser = async (db, login, nowIso) =>
  (await getUserByLogin(db, login)) ??
  db
    .prepare(
      `INSERT INTO users (github_id, login, name, avatar_url, created_at)
       VALUES ((SELECT MIN(0, COALESCE(MIN(github_id), 0)) - 1 FROM users), ?1, ?1, NULL, ?2)
       RETURNING id, login, name, avatar_url`,
    )
    .bind(login, nowIso)
    .first();

const USAGE_JOIN = "FROM usage_daily ud JOIN devices d ON d.id = ud.device_id JOIN users u ON u.id = d.user_id";

const FILTERED = "ud.day BETWEEN ?1 AND ?2 AND (?3 IS NULL OR ud.client = ?3) AND (?4 IS NULL OR ud.model = ?4)";

const TOTAL_COLUMNS = `TOTAL(ud.input + ud.output + ud.cache_read + ud.cache_write) AS tokens,
  TOTAL(ud.input + ud.output) AS tokens_nocache, TOTAL(ud.cost_usd) AS cost_usd`;

const all = async (statement) => (await statement.all()).results;

export const minUsageDay = async (db) => (await db.prepare("SELECT MIN(day) AS day FROM usage_daily").first())?.day ?? null;

export const leaderboardTotals = (db, { start, end, client, model }) =>
  all(
    db
      .prepare(`SELECT u.id, u.login, u.name, u.avatar_url, ${TOTAL_COLUMNS} ${USAGE_JOIN} WHERE ${FILTERED} GROUP BY u.id`)
      .bind(start, end, client, model),
  );

export const leaderboardByClient = (db, { start, end, client, model, metricSql }) =>
  all(
    db
      .prepare(`SELECT d.user_id, ud.client, TOTAL(${metricSql}) AS value ${USAGE_JOIN} WHERE ${FILTERED} GROUP BY d.user_id, ud.client ORDER BY ud.client`)
      .bind(start, end, client, model),
  );

export const leaderboardDaily = (db, { start, end, client, model, metricSql }) =>
  all(
    db
      .prepare(`SELECT d.user_id, ud.day, TOTAL(${metricSql}) AS value ${USAGE_JOIN} WHERE ${FILTERED} GROUP BY d.user_id, ud.day`)
      .bind(start, end, client, model),
  );

export const MAX_FILTER_VALUES = 500;

export const distinctValues = async (db, column) =>
  (await all(db.prepare(`SELECT DISTINCT ${column} AS value FROM usage_daily ORDER BY ${column} LIMIT ?1`).bind(MAX_FILTER_VALUES))).map((r) => r.value);

export const listDevices = (db, userId) =>
  all(
    db
      .prepare("SELECT id, name, created_at, last_sync_at FROM devices WHERE user_id = ?1 AND revoked_at IS NULL ORDER BY created_at, name")
      .bind(userId),
  );

export const revokeDevice = async (db, { userId, deviceId, nowIso }) => {
  const [device] = await db.batch([
    db.prepare("UPDATE devices SET revoked_at = ?1 WHERE id = ?2 AND user_id = ?3 AND revoked_at IS NULL").bind(nowIso, deviceId, userId),
    db
      .prepare(
        "UPDATE api_tokens SET revoked_at = ?1 WHERE device_id = ?2 AND revoked_at IS NULL AND device_id IN (SELECT id FROM devices WHERE user_id = ?3)",
      )
      .bind(nowIso, deviceId, userId),
  ]);
  return device.meta.changes > 0;
};

export const userTotals = (db, userId) =>
  db
    .prepare(`SELECT ${TOTAL_COLUMNS}, TOTAL(ud.messages) AS messages, COUNT(DISTINCT ud.day) AS active_days ${USAGE_JOIN} WHERE u.id = ?1`)
    .bind(userId)
    .first();

export const userDaily = (db, { userId, start, end }) =>
  all(db.prepare(`SELECT ud.day, ${TOTAL_COLUMNS} ${USAGE_JOIN} WHERE u.id = ?1 AND ud.day BETWEEN ?2 AND ?3 GROUP BY ud.day`).bind(userId, start, end));

export const userByClientModel = (db, userId) =>
  all(
    db
      .prepare(`SELECT ud.client, ud.model, ${TOTAL_COLUMNS} ${USAGE_JOIN} WHERE u.id = ?1 GROUP BY ud.client, ud.model ORDER BY tokens DESC, ud.client, ud.model`)
      .bind(userId),
  );

export const publicTotals = (db, { start, end }) =>
  db
    .prepare(
      `SELECT
        (SELECT COALESCE(TOTAL(input + output + cache_read + cache_write), 0) FROM usage_daily) AS tokens_all_time,
        (SELECT COALESCE(TOTAL(input + output + cache_read + cache_write), 0) FROM usage_daily WHERE day BETWEEN ?1 AND ?2) AS tokens_week,
        (SELECT COALESCE(TOTAL(cost_usd), 0) FROM usage_daily WHERE day BETWEEN ?1 AND ?2) AS cost_week,
        (SELECT COUNT(*) FROM users) AS players,
        (SELECT COUNT(DISTINCT d.user_id) FROM usage_daily ud JOIN devices d ON d.id = ud.device_id WHERE ud.day BETWEEN ?1 AND ?2) AS active_week`,
    )
    .bind(start, end)
    .first();

export const topBy = (db, column, { start, end, limit = 5, minUsers = 1 }) =>
  all(
    db
      .prepare(
        `SELECT ud.${column} AS value, TOTAL(ud.input + ud.output + ud.cache_read + ud.cache_write) AS tokens
         FROM usage_daily ud JOIN devices d ON d.id = ud.device_id
         WHERE ud.day BETWEEN ?1 AND ?2 GROUP BY ud.${column} HAVING COUNT(DISTINCT d.user_id) >= ?4
         ORDER BY tokens DESC, value LIMIT ?3`,
      )
      .bind(start, end, limit, minUsers),
  );

export const dailyTokens = (db, { start, end }) =>
  all(
    db
      .prepare("SELECT day, TOTAL(input + output + cache_read + cache_write) AS tokens FROM usage_daily WHERE day BETWEEN ?1 AND ?2 GROUP BY day")
      .bind(start, end),
  );
