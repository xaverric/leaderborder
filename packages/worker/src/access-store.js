import { EMPTY_RULES, isAdmin } from "./access.js";

const PUBLIC_ACCESS_KEY = "public_access";

const all = async (statement) => (await statement.all()).results;

export const loadRules = async (db) => {
  if (!db) return EMPTY_RULES;
  const [rules, setting] = await db.batch([
    db.prepare("SELECT kind, value FROM access_rules"),
    db.prepare("SELECT value FROM settings WHERE key = ?1").bind(PUBLIC_ACCESS_KEY),
  ]);
  const values = (kind) => rules.results.filter((rule) => rule.kind === kind).map((rule) => rule.value);
  return { public: setting.results[0]?.value === "1", logins: values("login"), orgs: values("org") };
};

export const saveUserOrgs = (db, userId, orgs) =>
  db.prepare("UPDATE users SET orgs = ?2 WHERE id = ?1").bind(userId, JSON.stringify(orgs.map((org) => org.toLowerCase()))).run();

export const recordAccessRequest = (db, { githubId, login, name, avatarUrl }, nowIso) =>
  db
    .prepare(
      `INSERT INTO access_requests (github_id, login, name, avatar_url, requested_at, last_attempt_at) VALUES (?1, ?2, ?3, ?4, ?5, ?5)
       ON CONFLICT (github_id) DO UPDATE SET login = excluded.login, name = excluded.name, avatar_url = excluded.avatar_url,
         last_attempt_at = excluded.last_attempt_at`,
    )
    .bind(githubId, login, name, avatarUrl, nowIso)
    .run();

export const clearAccessRequest = (db, githubId) => db.prepare("DELETE FROM access_requests WHERE github_id = ?1").bind(githubId).run();

export const addRule = (db, { kind, value, nowIso, createdBy }) =>
  db
    .prepare(
      `INSERT INTO access_rules (kind, value, created_at, created_by) VALUES (?1, ?2, ?3, ?4)
       ON CONFLICT (kind, value) DO UPDATE SET kind = excluded.kind
       RETURNING id, kind, value, created_at, created_by`,
    )
    .bind(kind, value.toLowerCase(), nowIso, createdBy)
    .first();

export const deleteRule = async (db, id) => (await db.prepare("DELETE FROM access_rules WHERE id = ?1").bind(id).run()).meta.changes > 0;

export const approveRequest = async (db, { login, nowIso, createdBy }) => {
  const request = await db.prepare("SELECT github_id, login FROM access_requests WHERE login = ?1 COLLATE NOCASE").bind(login).first();
  if (!request) return false;
  await db.batch([
    db
      .prepare("INSERT INTO access_rules (kind, value, created_at, created_by) VALUES ('login', ?1, ?2, ?3) ON CONFLICT (kind, value) DO NOTHING")
      .bind(request.login.toLowerCase(), nowIso, createdBy),
    db.prepare("DELETE FROM access_requests WHERE github_id = ?1").bind(request.github_id),
  ]);
  return true;
};

export const denyRequest = async (db, login) =>
  (await db.prepare("UPDATE access_requests SET status = 'denied' WHERE login = ?1 COLLATE NOCASE").bind(login).run()).meta.changes > 0;

export const setBlocked = async (db, { login, blocked, nowIso }) =>
  (
    await db
      .prepare("UPDATE users SET blocked_at = ?2 WHERE login = ?1 COLLATE NOCASE")
      .bind(login, blocked ? nowIso : null)
      .run()
  ).meta.changes > 0;

export const setPublicAccess = (db, enabled) =>
  db
    .prepare("INSERT INTO settings (key, value) VALUES (?1, ?2) ON CONFLICT (key) DO UPDATE SET value = excluded.value")
    .bind(PUBLIC_ACCESS_KEY, enabled ? "1" : "0")
    .run();

const toRequest = (row) => ({
  login: row.login,
  name: row.name ?? row.login,
  avatarUrl: row.avatar_url ?? null,
  status: row.status,
  requestedAt: row.requested_at,
  lastAttemptAt: row.last_attempt_at,
});

export const toRule = (row) => ({ id: row.id, kind: row.kind, value: row.value, createdAt: row.created_at, createdBy: row.created_by ?? null });

const toAdminUser = (env) => (row) => ({
  login: row.login,
  name: row.name ?? row.login,
  avatarUrl: row.avatar_url ?? null,
  isAdmin: isAdmin(row.login, env),
  blocked: row.blocked_at !== null,
  createdAt: row.created_at,
  devices: row.devices,
  lastSyncAt: row.last_sync_at ?? null,
});

export const adminOverview = async (db, env) => {
  const [requests, rules, users, rulesState] = await Promise.all([
    all(db.prepare("SELECT * FROM access_requests ORDER BY status = 'denied', last_attempt_at DESC")),
    all(db.prepare("SELECT * FROM access_rules ORDER BY kind, value")),
    all(
      db.prepare(
        `SELECT u.login, u.name, u.avatar_url, u.blocked_at, u.created_at,
           COUNT(d.id) FILTER (WHERE d.revoked_at IS NULL) AS devices, MAX(d.last_sync_at) AS last_sync_at
         FROM users u LEFT JOIN devices d ON d.user_id = u.id
         GROUP BY u.id ORDER BY u.login COLLATE NOCASE`,
      ),
    ),
    loadRules(db),
  ]);
  return {
    requests: requests.map(toRequest),
    rules: rules.map(toRule),
    users: users.map(toAdminUser(env)),
    settings: { publicAccess: rulesState.public },
  };
};
