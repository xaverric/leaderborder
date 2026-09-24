import { requireCookieUser } from "../auth.js";
import { HttpError, json } from "../http.js";
import { denseSeries, roundCost } from "../metrics.js";
import { addDays, dayRange, localDay } from "../periods.js";
import { getUserByLogin, listDevices, toUser, userByClientModel, userDaily, userTotals } from "../queries.js";
import { leaderboardTz } from "./leaderboard.js";

const totalsOf = (row) => ({ tokens: row?.tokens ?? 0, tokensNoCache: row?.tokens_nocache ?? 0, costUsd: roundCost(row?.cost_usd) });

export const getUserDetail = async ({ request, env, params, now }) => {
  const viewer = await requireCookieUser(request, env, now);
  const user = await getUserByLogin(env.DB, params.login);
  if (!user) throw new HttpError(404, "not_found", "User not found");
  const isSelf = viewer.id === user.id;
  const end = localDay(now, leaderboardTz(env));
  const start = addDays(end, -364);
  const [totals, daily, byClientModel, devices] = await Promise.all([
    userTotals(env.DB, user.id),
    userDaily(env.DB, { userId: user.id, start, end }),
    userByClientModel(env.DB, user.id),
    listDevices(env.DB, user.id),
  ]);
  return json({
    user: toUser(user),
    totals: { ...totalsOf(totals), messages: totals?.messages ?? 0, activeDays: totals?.active_days ?? 0 },
    daily: denseSeries(dayRange(start, end), daily, (day, row) => ({ day, ...totalsOf(row) })),
    byClientModel: byClientModel.map((row) => ({ client: row.client, model: row.model, ...totalsOf(row) })),
    deviceCount: devices.length,
    devices: isSelf ? devices.map((device) => ({ name: device.name, lastSyncAt: device.last_sync_at ?? null })) : [],
  });
};
