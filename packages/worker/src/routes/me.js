import { assertSameOrigin, requireAnyUser, requireCookieUser } from "../auth.js";
import { HttpError, json, noContent } from "../http.js";
import { toRankedTotals } from "../metrics.js";
import { periodRange } from "../periods.js";
import { leaderboardTotals, listDevices, revokeDevice, toUser } from "../queries.js";
import { leaderboardTz } from "./leaderboard.js";

const toDevice = (row) => ({ id: row.id, name: row.name, createdAt: row.created_at, lastSyncAt: row.last_sync_at ?? null });

const weeklyRank = async (db, userId, now, tz) => {
  const ranked = toRankedTotals("tokens", await leaderboardTotals(db, { ...periodRange("week", now, tz), client: null, model: null }));
  const mine = ranked.find((entry) => entry.id === userId);
  return mine ? { period: "week", metric: "tokens", position: mine.rank, of: ranked.length, value: mine.value } : null;
};

export const getMe = async ({ request, env, now }) => {
  const user = await requireAnyUser(request, env, now);
  const [rank, devices] = await Promise.all([weeklyRank(env.DB, user.id, now, leaderboardTz(env)), listDevices(env.DB, user.id)]);
  return json({ user: toUser(user), rank, devices: devices.map(toDevice) });
};

export const deleteMyDevice = async ({ request, env, params, now }) => {
  const user = await requireCookieUser(request, env, now);
  assertSameOrigin(request);
  const revoked = await revokeDevice(env.DB, { userId: user.id, deviceId: params.id.toLowerCase(), nowIso: now.toISOString() });
  if (!revoked) throw new HttpError(404, "not_found", "Device not found");
  return noContent();
};
