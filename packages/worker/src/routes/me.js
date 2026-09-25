import { isAdmin } from "../access.js";
import { assertSameOrigin, requireAnyUser, requireBearer, requireCookieUser } from "../auth.js";
import { cookieName, isLocalApp, serializeCookie } from "../cookies.js";
import { HttpError, json, noContent } from "../http.js";
import { METRIC_SQL, toRankedTotals } from "../metrics.js";
import { periodRange } from "../periods.js";
import { deleteUser, leaderboardTotals, listDevices, revokeDevice, toUser } from "../queries.js";
import { SESSION_COOKIE } from "../session.js";
import { leaderboardTz } from "./leaderboard.js";

const toDevice = (row) => ({ id: row.id, name: row.name, createdAt: row.created_at, lastSyncAt: row.last_sync_at ?? null });

const weeklyRank = async (db, userId, now, tz) => {
  const ranked = toRankedTotals("tokens", await leaderboardTotals(db, { ...periodRange("week", now, tz), client: null, model: null, metricSql: METRIC_SQL.tokens }));
  const mine = ranked.find((entry) => entry.id === userId);
  return mine ? { period: "week", metric: "tokens", position: mine.rank, of: ranked.length, value: mine.value } : null;
};

export const getMe = async ({ request, env, now }) => {
  const user = await requireAnyUser(request, env, now);
  const [rank, devices] = await Promise.all([weeklyRank(env.DB, user.id, now, leaderboardTz(env)), listDevices(env.DB, user.id)]);
  return json({ user: toUser(user), isAdmin: isAdmin(user.github_id, env), rank, devices: devices.map(toDevice) });
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
