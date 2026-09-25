import { requireCookieUser } from "../auth.js";
import { HttpError, json } from "../http.js";
import { ACTIVITY_METRIC_SQL, METRIC_SQL, METRICS, buildLeaderboard } from "../metrics.js";
import { PERIODS, addDays, periodRange } from "../periods.js";
import {
  activityLeaderboardByClient,
  activityLeaderboardDaily,
  activityLeaderboardTotals,
  distinctValues,
  leaderboardByClient,
  leaderboardDaily,
  leaderboardTotals,
  minUsageDay,
} from "../queries.js";

const MAX_FILTER_LENGTH = 120;

export const leaderboardTz = (env) => env.LEADERBOARD_TZ || "Europe/Prague";

const filterParam = (url, name) => {
  const value = url.searchParams.get(name) || null;
  if (value && value.length > MAX_FILTER_LENGTH) throw new HttpError(400, "invalid_request", `${name}: too long`);
  return value;
};

const choice = (url, name, options, fallback) => {
  const value = url.searchParams.get(name) || fallback;
  if (!options.includes(value)) throw new HttpError(400, "invalid_request", `${name}: must be one of ${options.join(", ")}`);
  return value;
};

export const resolveRange = async (db, period, now, tz) => {
  const range = periodRange(period, now, tz);
  return range.start ? range : { start: (await minUsageDay(db)) ?? range.end, end: range.end };
};

const usageQueries = (db, { metric, range, sparkStart, client, model }) => {
  const metricSql = METRIC_SQL[metric];
  return [
    leaderboardTotals(db, { ...range, client, model, metricSql }),
    leaderboardByClient(db, { ...range, client, model, metricSql }),
    leaderboardDaily(db, { start: sparkStart, end: range.end, client, model, metricSql }),
  ];
};

const activityQueries = (db, { metric, range, sparkStart, client }) => {
  const metricSql = ACTIVITY_METRIC_SQL[metric];
  return [
    activityLeaderboardTotals(db, { ...range, client, metricSql }),
    activityLeaderboardByClient(db, { ...range, client, metricSql }),
    activityLeaderboardDaily(db, { start: sparkStart, end: range.end, client, metricSql }),
  ];
};

export const computeLeaderboard = async (db, { period, metric, client = null, model = null, now, tz }) => {
  const range = await resolveRange(db, period, now, tz);
  const sparkStart = addDays(range.end, -29);
  const queries = metric in ACTIVITY_METRIC_SQL ? activityQueries : usageQueries;
  const [totals, byClient, daily, clients, models] = await Promise.all([
    ...queries(db, { metric, range, sparkStart, client, model }),
    distinctValues(db, "client"),
    distinctValues(db, "model"),
  ]);
  return buildLeaderboard({ period, metric, range, sparkStart, totals, byClient, daily, clients, models });
};

export const getLeaderboard = async ({ request, env, url, now }) => {
  await requireCookieUser(request, env, now);
  const period = choice(url, "period", PERIODS, "week");
  const metric = choice(url, "metric", METRICS, "tokens");
  const client = filterParam(url, "client");
  const model = filterParam(url, "model");
  return json(await computeLeaderboard(env.DB, { period, metric, client, model, now, tz: leaderboardTz(env) }));
};
