const numberFormat = new Intl.NumberFormat("en-US");

export const formatNumber = (value) => numberFormat.format(value);

export const formatUsd = (value) => `$${value.toFixed(2)}`;

export const cleanText = (value, max = 200) => String(value ?? "").replace(/\p{Cc}/gu, "").slice(0, max);

const COLUMNS = [
  { key: "day", align: "left", format: String },
  { key: "client", align: "left", format: String },
  { key: "model", align: "left", format: String },
  { key: "input", align: "right", format: formatNumber },
  { key: "output", align: "right", format: formatNumber },
  { key: "cacheRead", align: "right", format: formatNumber },
  { key: "cacheWrite", align: "right", format: formatNumber },
  { key: "reasoning", align: "right", format: formatNumber },
  { key: "costUsd", align: "right", format: formatUsd },
  { key: "messages", align: "right", format: formatNumber },
];

const formatOptional = (value) => (value === undefined ? "-" : formatNumber(value));

const TIMING_COLUMNS = [
  { key: "genMs", align: "right", format: formatOptional },
  { key: "genSamples", align: "right", format: formatOptional },
];

const ACTIVITY_COLUMNS = [
  { key: "day", align: "left", format: String },
  { key: "activeMs", align: "right", format: formatNumber },
  { key: "longestMs", align: "right", format: formatNumber },
  { key: "sessions", align: "right", format: formatNumber },
  { key: "maxConcurrent", align: "right", format: formatNumber },
];

const CLIENT_ACTIVITY_COLUMNS = [
  { key: "day", align: "left", format: String },
  { key: "client", align: "left", format: String },
  { key: "prompts", align: "right", format: formatNumber },
  { key: "hours", align: "left", format: (hours) => hours.flatMap((bucket, hour) => (bucket.some(Boolean) ? [`${hour}h ${bucket.join("/")}`] : [])).join(" ") || "-" },
];

const pad = (text, width, align) => (align === "right" ? text.padStart(width) : text.padEnd(width));

const formatTable = (columns, rows) => {
  const cells = rows.map((row) => columns.map((column) => column.format(row[column.key])));
  const widths = columns.map((column, index) => Math.max(column.key.length, ...cells.map((line) => line[index].length)));
  const render = (line) => line.map((cell, index) => pad(cell, widths[index], columns[index].align)).join("  ").trimEnd();
  return [render(columns.map((column) => column.key)), ...cells.map(render)].join("\n");
};

export const formatRowsTable = (rows) => {
  if (rows.length === 0) return "No usage rows.";
  return formatTable(rows.some((row) => row.genMs !== undefined) ? [...COLUMNS, ...TIMING_COLUMNS] : COLUMNS, rows);
};

export const formatActivityTables = (activity = []) => {
  if (activity.length === 0) return "No activity measured.";
  const clientRows = activity.flatMap(({ day, clients }) => clients.map((entry) => ({ day, ...entry })));
  return [formatTable(ACTIVITY_COLUMNS, activity), formatTable(CLIENT_ACTIVITY_COLUMNS, clientRows), "hours: tokens/messages/prompts per local hour"].join("\n\n");
};

const formatTotals = (totals) => `${formatNumber(totals.tokens)} tokens, ${formatUsd(totals.costUsd)}`;

const labelled = (entries) => {
  const width = Math.max(...entries.map(([label]) => label.length)) + 2;
  return entries.map(([label, value]) => `${`${label}:`.padEnd(width)}${value}`).join("\n");
};

export const formatSummary = (summary) =>
  labelled([
    ["Today", formatTotals(summary.today)],
    ["Week", formatTotals(summary.week)],
    ["Top model", summary.topModel ?? "-"],
  ]);

export const formatStatus = ({ state, apiUrl, hasToken }) =>
  labelled([
    ["Logged in", hasToken && state.deviceId ? "yes" : "no"],
    ["Device", state.deviceId ? `${cleanText(state.deviceName) || "unnamed"} (${cleanText(state.deviceId)})` : "-"],
    ["API", apiUrl],
    ["Last sync", state.lastSyncAt ?? "never"],
    ...(state.summary
      ? [
          ["Today", formatTotals(state.summary.today)],
          ["Week", formatTotals(state.summary.week)],
          ["Top model", state.summary.topModel ?? "-"],
        ]
      : []),
    ...(state.lastError
      ? [["Last error", `[${cleanText(state.lastError.code)}] ${cleanText(state.lastError.message)} (${cleanText(state.lastError.at)})`]]
      : []),
  ]);
