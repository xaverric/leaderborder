import { isAdmin } from "../access.js";
import { assertSameOrigin, requireAnyUser, requireBearer, requireCookieUser } from "../auth.js";
import { cookieName, isLocalApp, serializeCookie } from "../cookies.js";
import { HttpError, json, noContent } from "../http.js";
import { METRIC_SQL, toRankedTotals } from "../metrics.js";
import { periodRange } from "../periods.js";
import { deleteUser, leaderboardTotals, listDevices, revokeDevice, toUser, userUsage } from "../queries.js";
import { SESSION_COOKIE } from "../session.js";
import { leaderboardTz } from "./leaderboard.js";

const toDevice = (row) => ({ id: row.id, name: row.name, createdAt: row.created_at, lastSyncAt: row.last_sync_at ?? null });

const weeklyRank = async (db, userId, now, tz) => {
  const ranked = toRankedTotals("tokens", await leaderboardTotals(db, { ...periodRange("week", now, tz), client: null, model: null, metricSql: METRIC_SQL.tokens }));
  const mine = ranked.find((entry) => entry.id === userId);
  return mine ? { period: "week", metric: "tokens", position: mine.rank, of: ranked.length, value: mine.value } : null;
};

const roundCost = (value) => Math.round(value * 1e6) / 1e6;

const sumUsage = (rows) => ({
  tokens: rows.reduce((sum, row) => sum + row.tokens, 0),
  costUsd: roundCost(rows.reduce((sum, row) => sum + row.cost_usd, 0)),
});

const topModel = (rows) => {
  const byModel = rows.reduce((acc, row) => acc.set(row.model, (acc.get(row.model) ?? 0) + row.tokens), new Map());
  return [...byModel.entries()].reduce((best, entry) => (!best || entry[1] > best[1] ? entry : best), null)?.[0] ?? null;
};

export const toAccountTotals = (rows, today) => ({
  today: sumUsage(rows.filter((row) => row.day === today)),
  week: sumUsage(rows),
  topModel: topModel(rows),
});

const accountTotals = async (db, userId, now, tz) => {
  const range = periodRange("week", now, tz);
  return toAccountTotals(await userUsage(db, { userId, ...range }), range.end);
};

export const getMe = async ({ request, env, now }) => {
  const user = await requireAnyUser(request, env, now);
  const tz = leaderboardTz(env);
  const [rank, totals, devices] = await Promise.all([
    weeklyRank(env.DB, user.id, now, tz),
    accountTotals(env.DB, user.id, now, tz),
    listDevices(env.DB, user.id),
  ]);
  return json({ user: toUser(user), isAdmin: isAdmin(user.github_id, env), rank, totals, devices: devices.map(toDevice) });
};

export const deleteMe = async ({ request, env, now }) => {
  const user = await requireCookieUser(request, env, now);
  assertSameOrigin(request);
  await deleteUser(env.DB, user.id);
  const cleared = serializeCookie(cookieName(SESSION_COOKIE, env), "", { maxAge: 0, path: "/", httpOnly: true, secure: !isLocalApp(env), sameSite: "Lax" });
  return noContent(new Headers({ "set-cookie": cleared }));
};

const revokeSelf = async ({ request, env, now }) => {
  const auth = await requireBearer(request, env, now);
  await revokeDevice(env.DB, { userId: auth.id, deviceId: auth.device_id, nowIso: now.toISOString() });
  return noContent();
};

export const deleteMyDevice = async ({ request, env, params, now }) => {
  if (params.id === "self") return revokeSelf({ request, env, now });
  const user = await requireCookieUser(request, env, now);
  assertSameOrigin(request);
  const revoked = await revokeDevice(env.DB, { userId: user.id, deviceId: params.id.toLowerCase(), nowIso: now.toISOString() });
  if (!revoked) throw new HttpError(404, "not_found", "Device not found");
  return noContent();
};
