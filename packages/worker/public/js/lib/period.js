export const PERIODS = ["day", "week", "month", "all"];

export const METRICS = ["tokens", "tokens_nocache", "cost", "model_time", "prompts"];

export const TOOL_ONLY_METRICS = ["prompts"];

const PERIOD_LABELS = { day: "Today", week: "Last 7 days", month: "This month", all: "All time" };

const PERIOD_SHORT = { day: "Day", week: "Week", month: "Month", all: "All" };

const METRIC_LABELS = { tokens: "Tokens", tokens_nocache: "Tokens without cache", cost: "Cost", model_time: "Model time", prompts: "Prompts" };

const METRIC_KEYS = { tokens: "tokens", tokens_nocache: "tokensNoCache", cost: "costUsd", model_time: "genMs", prompts: "prompts" };

export const periodLabel = (period) => PERIOD_LABELS[period] ?? period;

export const periodShort = (period) => PERIOD_SHORT[period] ?? period;

export const metricLabel = (metric) => METRIC_LABELS[metric] ?? metric;

export const metricKey = (metric) => METRIC_KEYS[metric] ?? "tokens";
