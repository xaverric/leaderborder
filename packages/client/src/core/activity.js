import { addDays, localDay } from "./dates.js";

export const ACTIVITY_WINDOW_DAYS = 35;
export const HOURS_PER_DAY = 24;
const UNTIMED_CLIENTS = new Set(["cursor"]);
const HOUR_PATTERN = /^(\d{4}-\d{2}-\d{2}) (\d{2}):\d{2}$/;

const pairKey = (client, model) => `${client}\u0000${model}`;

const count = (value) => (Number.isFinite(value) && value > 0 ? Math.round(value) : 0);

const emptyHours = () => Array.from({ length: HOURS_PER_DAY }, () => [0, 0, 0]);

const addBucket = (a, b) => a.map((value, index) => value + b[index]);

export const activityWindow = ({ lastActivityAt, now }) => {
  const earliest = localDay(addDays(now, -(ACTIVITY_WINDOW_DAYS - 1)));
  const resume = lastActivityAt ? localDay(addDays(new Date(lastActivityAt), -1)) : earliest;
  return { since: resume > earliest ? resume : earliest, until: localDay(now) };
};

export const timedClients = (rows) => [...new Set(rows.map((row) => row.client).filter((client) => !UNTIMED_CLIENTS.has(client)))].sort();

export const activityDays = (rows, { since, until }) =>
  [...new Set(rows.filter((row) => row.day >= since && row.day <= until && !UNTIMED_CLIENTS.has(row.client)).map((row) => row.day))].sort();

export const toModelTimes = (report) =>
  (report?.entries ?? []).reduce((times, entry) => {
    const key = pairKey(entry.client, entry.model);
    const previous = times.get(key) ?? { genMs: 0, genSamples: 0 };
    return times.set(key, {
      genMs: previous.genMs + count(entry.performance?.totalDurationMs),
      genSamples: previous.genSamples + count(entry.performance?.sampleCount),
    });
  }, new Map());

export const toSessionMetrics = (report) => ({
  activeMs: count(report?.metrics?.total_active_time_ms),
  longestMs: count(report?.metrics?.longest_continuous_ms),
  sessions: count(report?.metrics?.session_count),
  maxConcurrent: count(report?.metrics?.max_concurrent_sessions),
});

const hourBucket = (entry) => [
  count(entry.input) + count(entry.output) + count(entry.cacheRead) + count(entry.cacheWrite),
  count(entry.messageCount),
  count(entry.turnCount),
];

export const toDailyHours = (report) =>
  (report?.entries ?? []).reduce((days, entry) => {
    const match = HOUR_PATTERN.exec(entry?.hour ?? "");
    const hour = Number(match?.[2]);
    if (!match || hour >= HOURS_PER_DAY) return days;
    const hours = days.get(match[1]) ?? emptyHours();
    hours[hour] = addBucket(hours[hour], hourBucket(entry));
    return days.set(match[1], hours);
  }, new Map());

export const withModelTimes = (rows, measured) => {
  const byDay = new Map(measured.map((day) => [day.day, day]));
  return rows.map((row) => {
    const day = byDay.get(row.day);
    if (!day?.clients.includes(row.client)) return row;
    return { ...row, ...(day.times.get(pairKey(row.client, row.model)) ?? { genMs: 0, genSamples: 0 }) };
  });
};

export const toActivity = (measured, hoursByClient) =>
  measured.map(({ day, clients, session }) => ({
    day,
    ...session,
    clients: clients.map((client) => {
      const hours = hoursByClient.get(client)?.get(day) ?? emptyHours();
      return { client, prompts: hours.reduce((sum, bucket) => sum + bucket[2], 0), hours };
    }),
  }));

const measureDay = async (report, { day, rows, home }) => {
  const clients = timedClients(rows.filter((row) => row.day === day));
  const range = { since: day, until: day, clients, home };
  const models = await report("models", { ...range, extra: ["--group-by", "client,model"] });
  const metrics = await report("time-metrics", range);
  return { day, clients, times: toModelTimes(models), session: toSessionMetrics(metrics) };
};

const sequential = (items, operation) =>
  items.reduce(async (done, item) => [...(await done), await operation(item)], Promise.resolve([]));

export const collectActivity = async ({ rows, window, home }, { report }) => {
  const days = activityDays(rows, window);
  if (days.length === 0) return { rows, activity: [] };
  const measured = await sequential(days, (day) => measureDay(report, { day, rows, home }));
  const clients = timedClients(rows.filter((row) => days.includes(row.day)));
  const hours = await sequential(clients, async (client) => [
    client,
    toDailyHours(await report("hourly", { since: days[0], until: days.at(-1), clients: [client], home })),
  ]);
  return { rows: withModelTimes(rows, measured), activity: toActivity(measured, new Map(hours)) };
};
