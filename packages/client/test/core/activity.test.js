import { test } from "node:test";
import assert from "node:assert/strict";
import {
  activityDays,
  activityWindow,
  collectActivity,
  timedClients,
  toActivity,
  toDailyHours,
  toModelTimes,
  toSessionMetrics,
  withModelTimes,
} from "../../src/core/activity.js";

const now = new Date(2026, 8, 24, 12);

const usage = (day, client, model, extra = {}) => ({ day, client, model, input: 1, output: 1, cacheRead: 0, cacheWrite: 0, reasoning: 0, costUsd: 0, messages: 1, ...extra });

const MODELS_0910 = {
  entries: [
    { client: "claude", model: "claude-sonnet-4-5", messageCount: 2, performance: { msPer1KTokens: 3703.7, totalDurationMs: 5000, timedTokens: 1350, sampleCount: 1, tokenCoverage: 0.4 } },
    { client: "codex", model: "gpt-5-codex", messageCount: 2, performance: { msPer1KTokens: 3571.4, totalDurationMs: 2000, timedTokens: 560, sampleCount: 2, tokenCoverage: 1 } },
  ],
};

const TIME_METRICS_0910 = {
  metrics: { total_active_time_ms: 67000, total_wall_time_ms: 67000, longest_continuous_ms: 65000, max_concurrent_sessions: 2, session_count: 2 },
  processingTimeMs: 90,
};

const HOURLY_CLAUDE = {
  entries: [
    { hour: "2026-09-10 14:00", clients: ["claude"], models: ["claude-sonnet-4-5"], input: 110, output: 220, cacheRead: 3000, cacheWrite: 50, messageCount: 2, turnCount: 1, cost: 0.0047 },
    { hour: "2026-09-11 14:00", clients: ["claude"], models: ["claude-haiku-4-5"], input: 5, output: 7, cacheRead: 0, cacheWrite: 3, messageCount: 1, turnCount: 0, cost: 0.00004 },
  ],
};

const hoursWith = (entries) => {
  const hours = Array.from({ length: 24 }, () => [0, 0, 0]);
  for (const [hour, bucket] of Object.entries(entries)) hours[Number(hour)] = bucket;
  return hours;
};

test("activityWindow backfills 35 days on the first measurement", () => {
  assert.deepEqual(activityWindow({ lastActivityAt: null, now }), { since: "2026-08-21", until: "2026-09-24" });
});

test("activityWindow resumes one day before the last measurement", () => {
  assert.deepEqual(activityWindow({ lastActivityAt: new Date(2026, 8, 22, 9).toISOString(), now }), { since: "2026-09-21", until: "2026-09-24" });
});

test("activityWindow never reaches further back than 35 days", () => {
  assert.deepEqual(activityWindow({ lastActivityAt: new Date(2026, 0, 1).toISOString(), now }), { since: "2026-08-21", until: "2026-09-24" });
});

test("timedClients drops Cursor, which has no timing data, and sorts", () => {
  const rows = [usage("2026-09-24", "codex", "a"), usage("2026-09-24", "cursor", "b"), usage("2026-09-24", "claude", "c"), usage("2026-09-23", "claude", "d")];
  assert.deepEqual(timedClients(rows), ["claude", "codex"]);
});

test("activityDays lists days inside the window that have timed usage", () => {
  const rows = [usage("2026-09-20", "claude", "a"), usage("2026-09-22", "cursor", "b"), usage("2026-09-23", "codex", "c"), usage("2026-09-23", "claude", "a")];
  assert.deepEqual(activityDays(rows, { since: "2026-09-21", until: "2026-09-24" }), ["2026-09-23"]);
});

test("toModelTimes maps model generation time per tool and model", () => {
  assert.deepEqual(
    [...toModelTimes(MODELS_0910).entries()],
    [
      ["claude\u0000claude-sonnet-4-5", { genMs: 5000, genSamples: 1 }],
      ["codex\u0000gpt-5-codex", { genMs: 2000, genSamples: 2 }],
    ],
  );
});

test("toModelTimes sums duplicates and treats missing or invalid performance as zero", () => {
  const report = {
    entries: [
      { client: "claude", model: "m", performance: { totalDurationMs: 100.4, sampleCount: 1 } },
      { client: "claude", model: "m", performance: { totalDurationMs: -5, sampleCount: null } },
      { client: "claude", model: "n" },
    ],
  };
  assert.deepEqual(Object.fromEntries(toModelTimes(report)), { "claude\u0000m": { genMs: 100, genSamples: 1 }, "claude\u0000n": { genMs: 0, genSamples: 0 } });
  assert.equal(toModelTimes({}).size, 0);
});

test("toSessionMetrics reads the tokscale time metrics", () => {
  assert.deepEqual(toSessionMetrics(TIME_METRICS_0910), { activeMs: 67000, longestMs: 65000, sessions: 2, maxConcurrent: 2 });
  assert.deepEqual(toSessionMetrics({}), { activeMs: 0, longestMs: 0, sessions: 0, maxConcurrent: 0 });
});

test("toDailyHours buckets tokens, messages and prompts by local hour", () => {
  const days = toDailyHours(HOURLY_CLAUDE);
  assert.deepEqual([...days.keys()], ["2026-09-10", "2026-09-11"]);
  assert.deepEqual(days.get("2026-09-10"), hoursWith({ 14: [3380, 2, 1] }));
  assert.deepEqual(days.get("2026-09-11"), hoursWith({ 14: [15, 1, 0] }));
});

test("toDailyHours ignores malformed hours", () => {
  const days = toDailyHours({ entries: [{ hour: "2026-09-10 24:00", messageCount: 1 }, { hour: "yesterday", messageCount: 1 }, null] });
  assert.equal(days.size, 0);
});

test("withModelTimes fills measured tools and leaves unmeasured rows untouched", () => {
  const rows = [usage("2026-09-10", "claude", "claude-sonnet-4-5"), usage("2026-09-10", "claude", "claude-haiku-4-5"), usage("2026-09-10", "cursor", "auto"), usage("2026-09-09", "claude", "claude-sonnet-4-5")];
  const measured = [{ day: "2026-09-10", clients: ["claude"], times: toModelTimes(MODELS_0910) }];
  const result = withModelTimes(rows, measured);
  assert.deepEqual(result.map((row) => [row.genMs, row.genSamples]), [
    [5000, 1],
    [0, 0],
    [undefined, undefined],
    [undefined, undefined],
  ]);
});

test("toActivity combines session metrics with prompts and hours per tool", () => {
  const measured = [{ day: "2026-09-10", clients: ["claude", "codex"], session: toSessionMetrics(TIME_METRICS_0910) }];
  const [entry] = toActivity(measured, new Map([["claude", toDailyHours(HOURLY_CLAUDE)]]));
  assert.deepEqual(entry, {
    day: "2026-09-10",
    activeMs: 67000,
    longestMs: 65000,
    sessions: 2,
    maxConcurrent: 2,
    clients: [
      { client: "claude", prompts: 1, hours: hoursWith({ 14: [3380, 2, 1] }) },
      { client: "codex", prompts: 0, hours: hoursWith({}) },
    ],
  });
});

test("collectActivity runs per day reports and one hourly report per tool, sequentially", async () => {
  const calls = [];
  const report = async (command, options) => {
    calls.push([command, options]);
    if (command === "models") return MODELS_0910;
    if (command === "time-metrics") return TIME_METRICS_0910;
    return options.clients[0] === "claude" ? HOURLY_CLAUDE : { entries: [] };
  };
  const rows = [usage("2026-09-10", "claude", "claude-sonnet-4-5"), usage("2026-09-10", "codex", "gpt-5-codex"), usage("2026-09-10", "cursor", "auto"), usage("2026-09-11", "claude", "claude-haiku-4-5")];
  const result = await collectActivity({ rows, window: { since: "2026-09-10", until: "2026-09-11" }, home: "/h" }, { report });
  assert.deepEqual(calls, [
    ["models", { since: "2026-09-10", until: "2026-09-10", clients: ["claude", "codex"], home: "/h", extra: ["--group-by", "client,model"] }],
    ["time-metrics", { since: "2026-09-10", until: "2026-09-10", clients: ["claude", "codex"], home: "/h" }],
    ["models", { since: "2026-09-11", until: "2026-09-11", clients: ["claude"], home: "/h", extra: ["--group-by", "client,model"] }],
    ["time-metrics", { since: "2026-09-11", until: "2026-09-11", clients: ["claude"], home: "/h" }],
    ["hourly", { since: "2026-09-10", until: "2026-09-11", clients: ["claude"], home: "/h" }],
    ["hourly", { since: "2026-09-10", until: "2026-09-11", clients: ["codex"], home: "/h" }],
  ]);
  assert.deepEqual(result.rows.map((row) => row.genMs), [5000, 2000, undefined, 0]);
  assert.deepEqual(result.activity.map((entry) => [entry.day, entry.clients.map((c) => `${c.client}:${c.prompts}`)]), [
    ["2026-09-10", ["claude:1", "codex:0"]],
    ["2026-09-11", ["claude:0"]],
  ]);
});

test("collectActivity makes no tokscale calls when no day needs measuring", async () => {
  const report = async () => assert.fail("tokscale called");
  const rows = [usage("2026-09-01", "claude", "a"), usage("2026-09-24", "cursor", "b")];
  assert.deepEqual(await collectActivity({ rows, window: { since: "2026-09-20", until: "2026-09-24" } }, { report }), { rows, activity: [] });
});

test("collectActivity propagates tokscale failures", async () => {
  const report = async () => {
    throw new Error("boom");
  };
  await assert.rejects(collectActivity({ rows: [usage("2026-09-24", "claude", "a")], window: { since: "2026-09-24", until: "2026-09-24" } }, { report }), /boom/);
});
