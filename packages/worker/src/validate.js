const DAY_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const CLIENT_PATTERN = /^[a-z0-9][a-z0-9._-]{0,39}$/;
const MODEL_PATTERN = /^[A-Za-z0-9._:/@+-]{1,120}$/;
const UUID_V4_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const GITHUB_LOGIN_PATTERN = /^[A-Za-z0-9-]{1,39}$/;
const COUNT_FIELDS = ["input", "output", "cacheRead", "cacheWrite", "reasoning", "messages"];
const MAX_ROWS = 500;
const DAY_MS = 86400000;
const MAX_COST_USD = 1_000_000_000;
const MIN_DAY = "2020-01-01";
const GITHUB_TOKEN_PATTERN = /^[A-Za-z0-9_]{1,255}$/;
const PRINTABLE_PATTERN = /^\P{Cc}{1,60}$/u;

const isObject = (value) => value !== null && typeof value === "object" && !Array.isArray(value);

const isCount = (value) => Number.isSafeInteger(value) && value >= 0;

export const isRealDay = (day) => {
  if (typeof day !== "string" || !DAY_PATTERN.test(day)) return false;
  const date = new Date(`${day}T00:00:00Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === day;
};

const maxDay = (now) => new Date(now.getTime() + DAY_MS).toISOString().slice(0, 10);

export const validateRow = (row, now) => {
  if (!isObject(row)) return "row: must be an object";
  if (!isRealDay(row.day)) return "day: invalid date";
  if (row.day > maxDay(now)) return "day: more than 1 day in the future";
  if (row.day < MIN_DAY) return `day: before ${MIN_DAY}`;
  if (typeof row.client !== "string" || !CLIENT_PATTERN.test(row.client)) return "client: invalid";
  if (typeof row.model !== "string" || !MODEL_PATTERN.test(row.model)) return "model: invalid";
  const badCount = COUNT_FIELDS.find((field) => !isCount(row[field]));
  if (badCount) return `${badCount}: must be a non-negative safe integer`;
  if (typeof row.costUsd !== "number" || !Number.isFinite(row.costUsd) || row.costUsd < 0 || row.costUsd > MAX_COST_USD) return `costUsd: must be a finite number between 0 and ${MAX_COST_USD}`;
  return null;
};

export const isUuidV4 = (value) => typeof value === "string" && UUID_V4_PATTERN.test(value);

export const isGithubLogin = (value) => typeof value === "string" && GITHUB_LOGIN_PATTERN.test(value);

export const validateUsageBody = (body, now) => {
  if (!isObject(body)) return "body: must be an object";
  if (!isUuidV4(body.deviceId)) return "deviceId: must be a uuid v4";
  if (body.tokscaleVersion !== undefined && (typeof body.tokscaleVersion !== "string" || body.tokscaleVersion.length > 40)) {
    return "tokscaleVersion: must be a string of at most 40 chars";
  }
  if (!Array.isArray(body.rows) || body.rows.length < 1 || body.rows.length > MAX_ROWS) return `rows: must be an array of 1-${MAX_ROWS} rows`;
  const index = body.rows.findIndex((row) => validateRow(row, now) !== null);
  return index === -1 ? null : `rows[${index}].${validateRow(body.rows[index], now)}`;
};

export const validateDeviceBody = (body) => {
  if (!isObject(body)) return "body: must be an object";
  if (typeof body.githubToken !== "string" || !GITHUB_TOKEN_PATTERN.test(body.githubToken)) return "githubToken: required";
  if (!isUuidV4(body.deviceId)) return "deviceId: must be a uuid v4";
  if (typeof body.deviceName !== "string" || !PRINTABLE_PATTERN.test(body.deviceName) || body.deviceName.trim().length < 1) return "deviceName: must be 1-60 printable chars";
  return null;
};

export const safeNext = (next, fallback = "/app") =>
  typeof next === "string" && next.length <= 512 && /^\/(?![/\\])[\x21-\x7e]*$/.test(next) ? next : fallback;
