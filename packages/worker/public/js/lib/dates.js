const pad = (n) => String(n).padStart(2, "0");

const toUtc = (day) => {
  const [y, m, d] = day.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d));
};

const fromUtc = (date) => `${date.getUTCFullYear()}-${pad(date.getUTCMonth() + 1)}-${pad(date.getUTCDate())}`;

export const isoDay = (date) => `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;

export const addDays = (day, n) => {
  const date = toUtc(day);
  date.setUTCDate(date.getUTCDate() + n);
  return fromUtc(date);
};

export const dayRange = (end, days) => Array.from({ length: days }, (_, i) => addDays(end, i - days + 1));

export const weekdayIndex = (day) => (toUtc(day).getUTCDay() + 6) % 7;

export const monthOf = (day) => Number(day.slice(5, 7)) - 1;

export const dayToUtcDate = toUtc;
