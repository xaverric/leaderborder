import { dayToUtcDate } from "./dates.js";

const UNITS = [
  [1e12, "T"],
  [1e9, "B"],
  [1e6, "M"],
  [1e3, "K"],
];

const isNumber = (n) => typeof n === "number" && Number.isFinite(n);

const roundMantissa = (x) => (x >= 100 ? Math.round(x) : Math.round(x * 10) / 10);

export const compactParts = (n) => {
  if (!isNumber(n)) return null;
  const sign = n < 0 ? "-" : "";
  const abs = Math.abs(n);
  const index = UNITS.findIndex(([size]) => abs >= size);
  if (index === -1) return { sign, value: Math.round(abs), suffix: "", divisor: 1, decimals: 0 };
  const [size, suffix] = UNITS[index];
  const value = roundMantissa(abs / size);
  if (value >= 1000 && index > 0) return { sign, value: 1, suffix: UNITS[index - 1][1], divisor: UNITS[index - 1][0], decimals: 0 };
  return { sign, value, suffix, divisor: size, decimals: Number.isInteger(value) ? 0 : 1 };
};

export const formatCompact = (n) => {
  const parts = compactParts(n);
  return parts ? `${parts.sign}${parts.value}${parts.suffix}` : "-";
};

const usdWhole = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 });
const usdCents = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", minimumFractionDigits: 2, maximumFractionDigits: 2 });
const integer = new Intl.NumberFormat("en-US", { maximumFractionDigits: 0 });

export const formatUsd = (n) => {
  if (!isNumber(n)) return "-";
  return Math.abs(n) >= 100 ? usdWhole.format(n) : usdCents.format(n);
};

export const formatInteger = (n) => (isNumber(n) ? integer.format(n) : "-");

export const formatMetric = (metric, value) => (metric === "cost" ? formatUsd(value) : formatCompact(value));

const dayFull = new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" });
const dayShort = new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", timeZone: "UTC" });
const monthShort = new Intl.DateTimeFormat("en-US", { month: "short", timeZone: "UTC" });

export const formatDay = (day) => dayFull.format(dayToUtcDate(day));

export const formatDayShort = (day) => dayShort.format(dayToUtcDate(day));

export const formatMonth = (day) => monthShort.format(dayToUtcDate(day));

export const formatRange = ({ start, end }) =>
  start === end ? formatDayShort(end) : `${formatDayShort(start)} - ${formatDayShort(end)}`;

export const relativeTime = (iso, now = new Date()) => {
  if (!iso) return "never";
  const minutes = Math.floor((now.getTime() - new Date(iso).getTime()) / 60000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} h ago`;
  return `${Math.floor(hours / 24)} d ago`;
};
