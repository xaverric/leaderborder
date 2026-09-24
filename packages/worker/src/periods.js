export const PERIODS = ["day", "week", "month", "all"];

const DAY_MS = 86400000;

const formatters = new Map();

const formatterFor = (tz) => {
  if (!formatters.has(tz)) {
    formatters.set(tz, new Intl.DateTimeFormat("en-CA", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit" }));
  }
  return formatters.get(tz);
};

export const localDay = (date, tz) => {
  const parts = Object.fromEntries(formatterFor(tz).formatToParts(date).map(({ type, value }) => [type, value]));
  return `${parts.year}-${parts.month}-${parts.day}`;
};

export const addDays = (day, n) => new Date(Date.parse(`${day}T00:00:00Z`) + n * DAY_MS).toISOString().slice(0, 10);

export const dayRange = (start, end) => {
  const count = Math.round((Date.parse(`${end}T00:00:00Z`) - Date.parse(`${start}T00:00:00Z`)) / DAY_MS) + 1;
  return Array.from({ length: Math.max(0, count) }, (_, i) => addDays(start, i));
};

const startFor = {
  day: (today) => today,
  week: (today) => addDays(today, -6),
  month: (today) => `${today.slice(0, 7)}-01`,
  all: () => null,
};

export const periodRange = (period, now, tz) => {
  const today = localDay(now, tz);
  return { start: startFor[period](today), end: today };
};
