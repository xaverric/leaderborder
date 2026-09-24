import { json } from "../http.js";
import { denseSeries, roundCost } from "../metrics.js";
import { addDays, dayRange, periodRange } from "../periods.js";
import { dailyTokens, publicTotals, topBy } from "../queries.js";
import { leaderboardTz } from "./leaderboard.js";

export const getPublicStats = async ({ env, now }) => {
  const week = periodRange("week", now, leaderboardTz(env));
  const dailyStart = addDays(week.end, -89);
  const [totals, topModels, topClients, daily] = await Promise.all([
    publicTotals(env.DB, week),
    topBy(env.DB, "model", week),
    topBy(env.DB, "client", week),
    dailyTokens(env.DB, { start: dailyStart, end: week.end }),
  ]);
  return json(
    {
      tokensAllTime: totals.tokens_all_time,
      tokensThisWeek: totals.tokens_week,
      costThisWeekUsd: roundCost(totals.cost_week),
      players: totals.players,
      activeThisWeek: totals.active_week,
      topModels: topModels.map((row) => ({ model: row.value, tokens: row.tokens })),
      topClients: topClients.map((row) => ({ client: row.value, tokens: row.tokens })),
      daily: denseSeries(dayRange(dailyStart, week.end), daily, (day, row) => ({ day, tokens: row?.tokens ?? 0 })),
      updatedAt: now.toISOString(),
    },
    { headers: { "cache-control": "public, max-age=60" } },
  );
};
