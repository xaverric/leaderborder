import { requireCookieUser } from "../auth.js";
import { HttpError, json } from "../http.js";
import { denseSeries, roundCost } from "../metrics.js";
import { addDays, dayRange, localDay } from "../periods.js";
import { getUserByLogin, listDevices, toUser, userActivityDays, userByClientModel, userClientActivity, userDaily, userTotals, userUsage } from "../queries.js";
import { leaderboardTz } from "./leaderboard.js";

const totalsOf = (row) => ({ tokens: row?.tokens ?? 0, tokensNoCache: row?.tokens_nocache ?? 0, costUsd: roundCost(row?.cost_usd) });

const toUsage = (row) => ({ day: row.day, client: row.client, model: row.model, ...totalsOf(row), messages: row.messages, genMs: row.gen_ms ?? null });

const toActivityDay = (row) => ({ day: row.day, activeMs: row.active_ms, longestMs: row.longest_ms, sessions: row.sessions, maxConcurrent: row.max_concurrent });

const addHours = (a, b) => a.map((bucket, hour) => bucket.map((value, index) => value + b[hour][index]));

const mergeClientActivity = (rows) => [
  ...rows
    .reduce((merged, row) => {
      const key = `${row.day}\u0000${row.client}`;
      const hours = JSON.parse(row.hours);
      const previous = merged.get(key);
      return merged.set(
        key,
        previous ? { ...previous, prompts: previous.prompts + row.prompts, hours: addHours(previous.hours, hours) } : { day: row.day, client: row.client, prompts: row.prompts, hours },
      );
    }, new Map())
    .values(),
];

export const getUserDetail = async ({ request, env, params, now }) => {
  const viewer = await requireCookieUser(request, env, now);
  const user = await getUserByLogin(env.DB, params.login);
  if (!user) throw new HttpError(404, "not_found", "User not found");
  const isSelf = viewer.id === user.id;
  const end = localDay(now, leaderboardTz(env));
  const start = addDays(end, -364);
  const window = { userId: user.id, start, end };
  const [totals, daily, byClientModel, devices, usage, activityDays, clientActivity] = await Promise.all([
    userTotals(env.DB, user.id),
    userDaily(env.DB, window),
    userByClientModel(env.DB, user.id),
    listDevices(env.DB, user.id),
    userUsage(env.DB, window),
    userActivityDays(env.DB, window),
    userClientActivity(env.DB, window),
  ]);
  return json({
    user: toUser(user),
    totals: { ...totalsOf(totals), messages: totals?.messages ?? 0, activeDays: totals?.active_days ?? 0 },
    daily: denseSeries(dayRange(start, end), daily, (day, row) => ({ day, ...totalsOf(row) })),
    byClientModel: byClientModel.map((row) => ({ client: row.client, model: row.model, ...totalsOf(row) })),
    usage: usage.map(toUsage),
    activity: { days: activityDays.map(toActivityDay), clients: mergeClientActivity(clientActivity) },
    deviceCount: devices.length,
    devices: isSelf ? devices.map((device) => ({ name: device.name, lastSyncAt: device.last_sync_at ?? null })) : [],
  });
};
