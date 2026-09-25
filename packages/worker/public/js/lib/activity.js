import { addDays } from "./dates.js";
import { clientSlot } from "./share.js";

export const SPANS = [1, 7, 30, 365];

export const HOURS_PER_DAY = 24;

const EMPTY_ACTIVITY = { days: [], clients: [] };

const sum = (items, pick) => items.reduce((total, item) => total + (pick(item) ?? 0), 0);

const pairKey = (day, client) => `${day}\u0000${client}`;

const isMeasured = (row) => row.genMs !== null && row.genMs !== undefined;

const matchesTool = ({ client }) => (row) => !client || row.client === client;

const matchesFilters = ({ client, model }) => (row) => (!client || row.client === client) && (!model || row.model === model);

export const windowRange = ({ end, span }) => ({ start: addDays(end, -(span - 1)), end });

const inRange = ({ start, end }) => (row) => row.day >= start && row.day <= end;

const addHours = (a, b) => a.map((bucket, hour) => bucket.map((value, index) => value + b[hour][index]));

export const sumHours = (clients) => clients.reduce((total, row) => addHours(total, row.hours), Array.from({ length: HOURS_PER_DAY }, () => [0, 0, 0]));

const maxOf = (items, pick) => items.reduce((max, item) => Math.max(max, pick(item)), 0);

export const summarizeWindow = ({ usage = [], activity = EMPTY_ACTIVITY }, filters) => {
  const range = windowRange(filters);
  const within = inRange(range);
  const rows = usage.filter((row) => within(row) && matchesFilters(filters)(row));
  const timed = rows.filter(isMeasured);
  const clients = activity.clients.filter((row) => within(row) && matchesTool(filters)(row));
  const days = activity.days.filter(within);
  const promptKeys = new Set(clients.map((row) => pairKey(row.day, row.client)));
  const promptRows = rows.filter((row) => promptKeys.has(pairKey(row.day, row.client)));
  const tokens = sum(rows, (row) => row.tokens);
  const prompts = filters.model || !clients.length ? null : sum(clients, (row) => row.prompts);
  const perPrompt = (value) => (prompts ? value / prompts : null);
  const modelMs = timed.length ? sum(timed, (row) => row.genMs) : null;
  const sessionScope = !filters.client && !filters.model && days.length > 0;
  const activeMs = sessionScope ? sum(days, (day) => day.activeMs) : null;
  return {
    range,
    tokens,
    tokensNoCache: sum(rows, (row) => row.tokensNoCache),
    costUsd: sum(rows, (row) => row.costUsd),
    messages: sum(rows, (row) => row.messages),
    activeDays: new Set(rows.filter((row) => row.tokens > 0).map((row) => row.day)).size,
    modelMs,
    modelCoverage: modelMs !== null && tokens > 0 ? sum(timed, (row) => row.tokens) / tokens : null,
    prompts,
    tokensPerPrompt: perPrompt(sum(promptRows, (row) => row.tokens)),
    messagesPerPrompt: perPrompt(sum(promptRows, (row) => row.messages)),
    modelMsPerPrompt: perPrompt(sum(promptRows.filter(isMeasured), (row) => row.genMs)),
    costPerPrompt: perPrompt(sum(promptRows, (row) => row.costUsd)),
    activeMs,
    outsideModelMs: activeMs !== null && modelMs !== null ? Math.max(0, activeMs - modelMs) : null,
    longestMs: sessionScope ? maxOf(days, (day) => day.longestMs) : null,
    sessions: sessionScope ? sum(days, (day) => day.sessions) : null,
    maxConcurrent: sessionScope ? maxOf(days, (day) => day.maxConcurrent) : null,
    hours: clients.length ? sumHours(clients) : null,
    hasActivity: activity.days.length > 0,
  };
};

const emptyDay = (day) => ({ day, tokens: 0, tokensNoCache: 0, costUsd: 0, genMs: 0, prompts: 0 });

export const dailySeries = ({ usage = [], activity = EMPTY_ACTIVITY }, filters) => {
  const byDay = new Map();
  const dayOf = (day) => byDay.get(day) ?? byDay.set(day, emptyDay(day)).get(day);
  for (const row of usage.filter(matchesFilters(filters))) {
    const entry = dayOf(row.day);
    entry.tokens += row.tokens;
    entry.tokensNoCache += row.tokensNoCache;
    entry.costUsd += row.costUsd;
    entry.genMs += row.genMs ?? 0;
  }
  if (!filters.model) for (const row of activity.clients.filter(matchesTool(filters))) dayOf(row.day).prompts += row.prompts;
  return [...byDay.values()].sort((a, b) => a.day.localeCompare(b.day));
};

export const windowByClientModel = ({ usage = [], activity = EMPTY_ACTIVITY }, filters, metric) => {
  const within = inRange(windowRange(filters));
  if (metric === "prompts") {
    const clients = activity.clients.filter((row) => within(row) && matchesTool(filters)(row));
    return [...new Set(clients.map((row) => row.client))].map((client) => ({ client, model: "", prompts: sum(clients.filter((row) => row.client === client), (row) => row.prompts) }));
  }
  const pairs = new Map();
  for (const row of usage.filter((row) => within(row) && matchesFilters(filters)(row))) {
    const key = pairKey(row.client, row.model);
    const pair = pairs.get(key) ?? { client: row.client, model: row.model, tokens: 0, tokensNoCache: 0, costUsd: 0, genMs: 0 };
    pairs.set(key, { ...pair, tokens: pair.tokens + row.tokens, tokensNoCache: pair.tokensNoCache + row.tokensNoCache, costUsd: pair.costUsd + row.costUsd, genMs: pair.genMs + (row.genMs ?? 0) });
  }
  return [...pairs.values()];
};

const rankBy = (rows, keyOf) => {
  const totals = new Map();
  for (const row of rows) totals.set(keyOf(row), (totals.get(keyOf(row)) ?? 0) + row.tokens);
  return [...totals.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).map(([value]) => value);
};

export const filterOptions = (usage = [], { client }) => ({
  clients: rankBy(usage, (row) => row.client).map((value) => ({ value, slot: clientSlot(value) })),
  models: rankBy(usage.filter(matchesTool({ client })), (row) => row.model),
});

export const peakHour = (hours, index = 0) => {
  const best = (hours ?? []).reduce((peak, bucket, hour) => (bucket[index] > (peak?.value ?? 0) ? { hour, value: bucket[index] } : peak), null);
  return best?.hour ?? null;
};
