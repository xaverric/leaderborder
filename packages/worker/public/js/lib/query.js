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
