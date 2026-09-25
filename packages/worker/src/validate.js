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
const MAX_DURATION_MS = 31 * DAY_MS;
const MAX_ACTIVITY_DAYS = 62;
const MAX_ACTIVITY_AGE_DAYS = 400;
const MAX_ACTIVITY_CLIENTS = 20;
const HOURS_PER_DAY = 24;
const HOUR_FIELDS = 3;

const isObject = (value) => value !== null && typeof value === "object" && !Array.isArray(value);

const isCount = (value) => Number.isSafeInteger(value) && value >= 0;

const isDuration = (value) => isCount(value) && value <= MAX_DURATION_MS;

const DURATION_ERROR = `must be a non-negative integer of at most ${MAX_DURATION_MS}`;

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
  if ((row.genMs === undefined) !== (row.genSamples === undefined)) return "genMs: must be sent together with genSamples";
  if (row.genMs !== undefined && !isDuration(row.genMs)) return `genMs: ${DURATION_ERROR}`;
  if (row.genSamples !== undefined && !isCount(row.genSamples)) return "genSamples: must be a non-negative safe integer";
  return null;
};

const minActivityDay = (now) => new Date(now.getTime() - MAX_ACTIVITY_AGE_DAYS * DAY_MS).toISOString().slice(0, 10);

const isHourBucket = (bucket) => Array.isArray(bucket) && bucket.length === HOUR_FIELDS && bucket.every(isCount);

const validateClientActivity = (entry) => {
  if (!isObject(entry)) return "client: must be an object";
  if (typeof entry.client !== "string" || !CLIENT_PATTERN.test(entry.client)) return "client: invalid";
  if (!isCount(entry.prompts)) return "prompts: must be a non-negative safe integer";
  if (!Array.isArray(entry.hours) || entry.hours.length !== HOURS_PER_DAY || !entry.hours.every(isHourBucket)) {
    return `hours: must be ${HOURS_PER_DAY} arrays of ${HOUR_FIELDS} non-negative safe integers`;
  }
  return null;
};

const firstInvalid = (items, validate) => {
  const index = items.findIndex((item) => validate(item) !== null);
  return index === -1 ? null : { index, error: validate(items[index]) };
};

const validateActivityDay = (entry, now) => {
  if (!isObject(entry)) return "entry: must be an object";
  if (!isRealDay(entry.day)) return "day: invalid date";
  if (entry.day > maxDay(now)) return "day: more than 1 day in the future";
  if (entry.day < minActivityDay(now)) return `day: more than ${MAX_ACTIVITY_AGE_DAYS} days ago`;
  const badDuration = ["activeMs", "longestMs"].find((field) => !isDuration(entry[field]));
  if (badDuration) return `${badDuration}: ${DURATION_ERROR}`;
  const badCount = ["sessions", "maxConcurrent"].find((field) => !isCount(entry[field]));
  if (badCount) return `${badCount}: must be a non-negative safe integer`;
  if (!Array.isArray(entry.clients) || entry.clients.length > MAX_ACTIVITY_CLIENTS) return `clients: must be an array of at most ${MAX_ACTIVITY_CLIENTS} entries`;
  const invalid = firstInvalid(entry.clients, validateClientActivity);
  if (invalid) return `clients[${invalid.index}].${invalid.error}`;
  if (new Set(entry.clients.map((client) => client.client)).size !== entry.clients.length) return "clients: duplicate client";
  return null;
};

export const validateActivity = (activity, now) => {
  if (!Array.isArray(activity) || activity.length > MAX_ACTIVITY_DAYS) return `activity: must be an array of at most ${MAX_ACTIVITY_DAYS} days`;
  const invalid = firstInvalid(activity, (entry) => validateActivityDay(entry, now));
  if (invalid) return `activity[${invalid.index}].${invalid.error}`;
  if (new Set(activity.map((entry) => entry.day)).size !== activity.length) return "activity: duplicate day";
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
  if (index !== -1) return `rows[${index}].${validateRow(body.rows[index], now)}`;
  return body.activity === undefined ? null : validateActivity(body.activity, now);
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
