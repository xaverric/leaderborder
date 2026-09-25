import { addDays } from "./dates.js";
import { METRICS, PERIODS } from "./period.js";

export const DEFAULT_FILTERS = Object.freeze({ period: "week", metric: "tokens", client: "", model: "" });

const CLIENT = /^[a-z0-9][a-z0-9._-]{0,39}$/;
const MODEL = /^[A-Za-z0-9._:/@+-]{1,120}$/;

const pick = (value, allowed, fallback) => (allowed.includes(value) ? value : fallback);

export const filtersFromSearch = (search = "") => {
  const params = new URLSearchParams(search);
  const client = params.get("client") ?? "";
  const model = params.get("model") ?? "";
  return {
    period: pick(params.get("period"), PERIODS, DEFAULT_FILTERS.period),
    metric: pick(params.get("metric"), METRICS, DEFAULT_FILTERS.metric),
    client: CLIENT.test(client) ? client : "",
    model: MODEL.test(model) ? model : "",
  };
};

export const leaderboardQuery = (filters) => {
  const params = new URLSearchParams();
  for (const key of ["period", "metric", "client", "model"]) if (filters[key]) params.set(key, filters[key]);
  return params.toString();
};

export const DEFAULT_USER_SPAN = 7;

export const USER_HISTORY_DAYS = 365;

const DAY = /^\d{4}-\d{2}-\d{2}$/;

export const userFiltersFromSearch = (search = "", { today, spans }) => {
  const params = new URLSearchParams(search);
  const day = params.get("day") ?? "";
  const span = Number(params.get("span"));
  const client = params.get("client") ?? "";
  const model = params.get("model") ?? "";
  return {
    end: DAY.test(day) && day <= today && day > addDays(today, -USER_HISTORY_DAYS) ? day : today,
    span: spans.includes(span) ? span : DEFAULT_USER_SPAN,
    metric: pick(params.get("metric"), METRICS, DEFAULT_FILTERS.metric),
    client: CLIENT.test(client) ? client : "",
    model: MODEL.test(model) ? model : "",
  };
};

export const userQuery = (filters, today) => {
  const params = new URLSearchParams();
  if (filters.end !== today) params.set("day", filters.end);
  if (filters.span !== DEFAULT_USER_SPAN) params.set("span", String(filters.span));
  if (filters.metric !== DEFAULT_FILTERS.metric) params.set("metric", filters.metric);
  for (const key of ["client", "model"]) if (filters[key]) params.set(key, filters[key]);
  return params.toString();
};
