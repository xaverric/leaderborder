import { json } from "../http.js";
import { denseSeries, roundCost } from "../metrics.js";
import { addDays, dayRange, periodRange } from "../periods.js";
import { dailyTokens, publicTotals, topBy } from "../queries.js";
import { leaderboardTz } from "./leaderboard.js";

const CACHE_SECONDS = 60;
export const MIN_PUBLIC_GROUP = 3;
export const MIN_PUBLIC_USERS_PER_VALUE = 2;

const roundPublic = (value) => (Math.abs(value ?? 0) < 1000 ? (value ?? 0) : Number(Number(value).toPrecision(3)));

const computeStats = async (env, now) => {
  const week = periodRange("week", now, leaderboardTz(env));
  const dailyStart = addDays(week.end, -89);
  const [totals, topModels, topClients, daily] = await Promise.all([
    publicTotals(env.DB, week),
    topBy(env.DB, "model", { ...week, minUsers: MIN_PUBLIC_USERS_PER_VALUE }),
    topBy(env.DB, "client", { ...week, minUsers: MIN_PUBLIC_USERS_PER_VALUE }),
    dailyTokens(env.DB, { start: dailyStart, end: week.end }),
  ]);
  const suppressed = totals.active_week < MIN_PUBLIC_GROUP;
  const days = dayRange(dailyStart, week.end);
  return {
    tokensAllTime: roundPublic(totals.tokens_all_time),
    tokensThisWeek: suppressed ? 0 : roundPublic(totals.tokens_week),
    costThisWeekUsd: suppressed ? 0 : roundPublic(roundCost(totals.cost_week)),
    players: totals.players,
    activeThisWeek: totals.active_week,
    topModels: suppressed ? [] : topModels.map((row) => ({ model: row.value, tokens: roundPublic(row.tokens) })),
    topClients: suppressed ? [] : topClients.map((row) => ({ client: row.value, tokens: roundPublic(row.tokens) })),
    daily: suppressed ? days.map((day) => ({ day, tokens: 0 })) : denseSeries(days, daily, (day, row) => ({ day, tokens: roundPublic(row?.tokens ?? 0) })),
    suppressed,
    minGroup: MIN_PUBLIC_GROUP,
    updatedAt: now.toISOString(),
  };
};

export const getPublicStats = async ({ env, url, now, ctx }) => {
  const cache = caches.default;
  const key = new Request(new URL("/api/public/stats", url.origin).href);
  const cached = await cache.match(key);
  if (cached) return cached;
  const response = json(await computeStats(env, now), { headers: { "cache-control": `public, max-age=${CACHE_SECONDS}` } });
  ctx?.waitUntil(cache.put(key, response.clone()));
  return response;
};
