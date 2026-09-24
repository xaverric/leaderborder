import { dayRange, monthOf, weekdayIndex } from "./dates.js";
import { formatMonth } from "./format.js";

export const levelFor = (value, max) => {
  if (!(value > 0) || !(max > 0)) return 0;
  return Math.min(4, Math.max(1, Math.ceil((value / max) * 4)));
};

const monthLabels = (weeks) => {
  const labels = [];
  let previous = null;
  weeks.forEach((week, col) => {
    const last = week.findLast(Boolean);
    const month = monthOf(last.day);
    if (month !== previous) labels.push({ col, label: formatMonth(last.day) });
    previous = month;
  });
  if (labels.length > 1 && labels[1].col - labels[0].col < 2) labels.shift();
  return labels;
};

export const buildHeatmap = (daily = [], { end, days, key = "tokens" }) => {
  const range = dayRange(end, days);
  const byDay = new Map(daily.map((row) => [row.day, Number(row[key]) || 0]));
  const values = range.map((day) => ({ day, value: byDay.get(day) ?? 0 }));
  const max = values.reduce((m, c) => Math.max(m, c.value), 0);
  const cells = [...Array(weekdayIndex(range[0])).fill(null), ...values.map((c) => ({ ...c, level: levelFor(c.value, max) }))];
  const weeks = [];
  for (let i = 0; i < cells.length; i += 7) weeks.push(cells.slice(i, i + 7));
  return {
    weeks,
    months: monthLabels(weeks),
    max,
    total: values.reduce((sum, c) => sum + c.value, 0),
    activeDays: values.filter((c) => c.value > 0).length,
  };
};

export const activityFacts = (daily = [], { end, days, key = "tokens" }) => {
  const range = new Set(dayRange(end, days));
  const values = daily.filter((row) => range.has(row.day)).map((row) => ({ day: row.day, value: Number(row[key]) || 0 }));
  const active = values.filter((row) => row.value > 0);
  const total = active.reduce((sum, row) => sum + row.value, 0);
  const busiest = active.reduce((best, row) => (!best || row.value > best.value ? row : best), null);
  return { total, days, activeDays: active.length, average: total / days, busiest };
};
