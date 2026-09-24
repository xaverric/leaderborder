import { addDays, localDay } from "./dates.js";

export const TOKEN_FIELDS = ["input", "output", "cacheRead", "cacheWrite", "reasoning"];
const INTEGER_FIELDS = [...TOKEN_FIELDS, "messages"];
const DAY_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const CLIENT_PATTERN = /^[a-z0-9][a-z0-9._-]{0,39}$/;
const MODEL_PATTERN = /^[A-Za-z0-9._:/@+-]{1,120}$/;
const SYNC_WINDOW_DAYS = 35;
const WEEK_DAYS = 7;

const roundCost = (value) => Math.round(value * 1e9) / 1e9;

const toNumber = (value) => (value === undefined || value === null ? 0 : Number(value));

export const rowTokens = (row) => row.input + row.output + row.cacheRead + row.cacheWrite;

const isRealDay = (day) => {
  const [year, month, date] = day.split("-").map(Number);
  const parsed = new Date(Date.UTC(year, month - 1, date));
  return parsed.getUTCFullYear() === year && parsed.getUTCMonth() === month - 1 && parsed.getUTCDate() === date;
};

const dayErrors = (day, now) => {
  if (typeof day !== "string" || !DAY_PATTERN.test(day) || !isRealDay(day)) return ["day"];
  return day > localDay(addDays(now, 1)) ? ["day in the future"] : [];
};

export const validateRow = (row, now = new Date()) => [
  ...dayErrors(row.day, now),
  ...(typeof row.client === "string" && CLIENT_PATTERN.test(row.client) ? [] : ["client"]),
  ...(typeof row.model === "string" && MODEL_PATTERN.test(row.model) ? [] : ["model"]),
  ...INTEGER_FIELDS.filter((field) => !(Number.isSafeInteger(row[field]) && row[field] >= 0)),
  ...(typeof row.costUsd === "number" && Number.isFinite(row.costUsd) && row.costUsd >= 0 && row.costUsd <= 1_000_000_000 ? [] : ["costUsd"]),
];

const entryRow = (day, entry) => ({
  day,
  client: entry.client,
  model: entry.modelId,
  ...Object.fromEntries(TOKEN_FIELDS.map((field) => [field, toNumber(entry.tokens?.[field])])),
  costUsd: toNumber(entry.cost),
  messages: toNumber(entry.messages),
});

const addRows = (a, b) => ({
  ...a,
  ...Object.fromEntries(TOKEN_FIELDS.map((field) => [field, a[field] + b[field]])),
  costUsd: a.costUsd + b.costUsd,
  messages: a.messages + b.messages,
});

const rowKey = (row) => `${row.day}\u0000${row.client}\u0000${row.model}`;

const isEmptyRow = (row) => row.messages === 0 && TOKEN_FIELDS.every((field) => row[field] === 0);

const mergeByKey = (rows) =>
  rows.reduce((acc, row) => {
    const key = rowKey(row);
    return acc.set(key, acc.has(key) ? addRows(acc.get(key), row) : row);
  }, new Map());

const compareRows = (a, b) => {
  const [left, right] = [rowKey(a), rowKey(b)];
  return left < right ? -1 : left > right ? 1 : 0;
};

export const toUsageRows = (graph, now = new Date()) => {
  const entries = (graph?.contributions ?? []).flatMap((contribution) =>
    (contribution.clients ?? []).map((entry) => entryRow(contribution.date, entry)),
  );
  return [...mergeByKey(entries).values()]
    .map((row) => ({ ...row, costUsd: roundCost(row.costUsd) }))
    .filter((row) => !isEmptyRow(row) && validateRow(row, now).length === 0)
    .sort(compareRows);
};

export const syncWindow = ({ lastSyncAt, now }) => ({
  since: lastSyncAt ? localDay(addDays(now, -SYNC_WINDOW_DAYS)) : null,
});

const totals = (rows) => ({
  tokens: rows.reduce((sum, row) => sum + rowTokens(row), 0),
  costUsd: roundCost(rows.reduce((sum, row) => sum + row.costUsd, 0)),
});

const topModel = (rows) => {
  const byModel = rows.reduce((acc, row) => acc.set(row.model, (acc.get(row.model) ?? 0) + rowTokens(row)), new Map());
  return [...byModel.entries()].reduce((best, entry) => (!best || entry[1] > best[1] ? entry : best), null)?.[0] ?? null;
};

export const summarize = (rows, now) => {
  const today = localDay(now);
  const weekStart = localDay(addDays(now, -(WEEK_DAYS - 1)));
  const week = rows.filter((row) => row.day >= weekStart && row.day <= today);
  return {
    today: totals(rows.filter((row) => row.day === today)),
    week: totals(week),
    topModel: topModel(week),
  };
};

export const chunk = (rows, size = 500) =>
  Array.from({ length: Math.ceil(rows.length / size) }, (_, index) => rows.slice(index * size, (index + 1) * size));
