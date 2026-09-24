const numberFormat = new Intl.NumberFormat("en-US");

export const formatNumber = (value) => numberFormat.format(value);

export const formatUsd = (value) => `$${value.toFixed(2)}`;

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

const pad = (text, width, align) => (align === "right" ? text.padStart(width) : text.padEnd(width));

export const formatRowsTable = (rows) => {
  if (rows.length === 0) return "No usage rows.";
  const cells = rows.map((row) => COLUMNS.map((column) => column.format(row[column.key])));
  const widths = COLUMNS.map((column, index) => Math.max(column.key.length, ...cells.map((line) => line[index].length)));
  const render = (line) => line.map((cell, index) => pad(cell, widths[index], COLUMNS[index].align)).join("  ");
  return [render(COLUMNS.map((column) => column.key)), ...cells.map(render)].join("\n");
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
    ["Device", state.deviceId ? `${state.deviceName ?? "unnamed"} (${state.deviceId})` : "-"],
    ["API", apiUrl],
    ["Last sync", state.lastSyncAt ?? "never"],
    ...(state.summary
      ? [
          ["Today", formatTotals(state.summary.today)],
          ["Week", formatTotals(state.summary.week)],
          ["Top model", state.summary.topModel ?? "-"],
        ]
      : []),
    ...(state.lastError ? [["Last error", `[${state.lastError.code}] ${state.lastError.message} (${state.lastError.at})`]] : []),
  ]);
