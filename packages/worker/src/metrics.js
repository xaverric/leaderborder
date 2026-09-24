import { dayRange } from "./periods.js";

export const METRIC_SQL = {
  tokens: "ud.input + ud.output + ud.cache_read + ud.cache_write",
  tokens_nocache: "ud.input + ud.output",
  cost: "ud.cost_usd",
};

export const METRICS = Object.keys(METRIC_SQL);

export const roundCost = (value) => Math.round((value ?? 0) * 1e6) / 1e6;

export const metricValue = (metric, value) => (metric === "cost" ? roundCost(value) : (value ?? 0));

const totalsOf = (row) => ({ tokens: row.tokens ?? 0, tokensNoCache: row.tokens_nocache ?? 0, costUsd: roundCost(row.cost_usd) });

const pickMetric = { tokens: (t) => t.tokens, tokens_nocache: (t) => t.tokensNoCache, cost: (t) => t.costUsd };

export const rankEntries = (items) => {
  const sorted = [...items].sort((a, b) => b.value - a.value || a.login.localeCompare(b.login));
  return sorted.map((item) => ({ ...item, rank: 1 + sorted.filter((other) => other.value > item.value).length }));
};

export const denseSeries = (days, rows, toEntry) => {
  const byDay = new Map(rows.map((row) => [row.day, row]));
  return days.map((day) => toEntry(day, byDay.get(day)));
};

const groupBy = (rows, key) =>
  rows.reduce((groups, row) => groups.set(row[key], [...(groups.get(row[key]) ?? []), row]), new Map());

export const toRankedTotals = (metric, totals) =>
  rankEntries(totals.map((row) => ({ id: row.id, login: row.login, row, ...totalsOf(row), value: pickMetric[metric](totalsOf(row)) })));

export const buildLeaderboard = ({ period, metric, range, sparkStart, totals, byClient, daily, clients, models }) => {
  const clientsByUser = groupBy(byClient, "user_id");
  const dailyByUser = groupBy(daily, "user_id");
  const days = dayRange(sparkStart, range.end);
  const entries = toRankedTotals(metric, totals).map(({ id, row, rank, value, tokens, tokensNoCache, costUsd }) => ({
    rank,
    login: row.login,
    name: row.name ?? row.login,
    avatarUrl: row.avatar_url ?? null,
    value,
    tokens,
    tokensNoCache,
    costUsd,
    byClient: Object.fromEntries((clientsByUser.get(id) ?? []).map((r) => [r.client, metricValue(metric, r.value)])),
    sparkline: denseSeries(days, dailyByUser.get(id) ?? [], (day, r) => ({ day, value: metricValue(metric, r?.value) })),
  }));
  return { period, metric, range, entries, filters: { clients, models } };
};
