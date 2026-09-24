import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { toUsageRows, validateRow, syncWindow, summarize, chunk, rowTokens } from "../../src/core/rows.js";

const graph = JSON.parse(readFileSync(new URL("../../../../fixtures/tokscale-graph-4.17.0.json", import.meta.url), "utf8"));
const now = new Date(2026, 8, 24, 12);
const ROW_KEYS = ["day", "client", "model", "input", "output", "cacheRead", "cacheWrite", "reasoning", "costUsd", "messages"];

const row = (overrides = {}) => ({
  day: "2026-09-20",
  client: "claude",
  model: "claude-opus-5",
  input: 1,
  output: 2,
  cacheRead: 3,
  cacheWrite: 4,
  reasoning: 0,
  costUsd: 0.5,
  messages: 1,
  ...overrides,
});

const entry = (overrides = {}) => ({
  client: "claude",
  modelId: "claude-opus-5",
  providerId: "anthropic",
  tokens: { input: 1, output: 1, cacheRead: 0, cacheWrite: 0, reasoning: 0 },
  cost: 0.1,
  messages: 1,
  ...overrides,
});

test("toUsageRows sums duplicate day+client+model across providers", () => {
  const found = toUsageRows(graph, now).filter((r) => r.day === "2026-09-10" && r.model === "claude-opus-5");
  assert.equal(found.length, 1);
  const { costUsd, ...rest } = found[0];
  assert.deepEqual(rest, {
    day: "2026-09-10",
    client: "claude",
    model: "claude-opus-5",
    input: 288,
    output: 116892,
    cacheRead: 53082104,
    cacheWrite: 1875983,
    reasoning: 5,
    messages: 140,
  });
  assert.ok(Math.abs(costUsd - 41.68887075) < 1e-6);
});

test("toUsageRows yields one row per unique day+client+model with only Contract 2 keys", () => {
  const rows = toUsageRows(graph, now);
  const keys = new Set(graph.contributions.flatMap((c) => c.clients.map((e) => `${c.date}|${e.client}|${e.modelId}`)));
  assert.equal(rows.length, keys.size);
  rows.forEach((r) => assert.deepEqual(Object.keys(r), ROW_KEYS));
});

test("toUsageRows preserves fixture token and message totals", () => {
  const rows = toUsageRows(graph, now);
  const expected = graph.contributions.reduce((sum, c) => sum + c.clients.reduce((s, e) => s + e.messages, 0), 0);
  assert.equal(rows.reduce((sum, r) => sum + r.messages, 0), expected);
  const expectedInput = graph.contributions.reduce((sum, c) => sum + c.tokenBreakdown.input, 0);
  assert.equal(rows.reduce((sum, r) => sum + r.input, 0), expectedInput);
});

test("toUsageRows output passes validateRow and is sorted by day, client, model", () => {
  const rows = toUsageRows(graph, now);
  rows.forEach((r) => assert.deepEqual(validateRow(r, now), []));
  const keys = rows.map((r) => `${r.day}|${r.client}|${r.model}`);
  assert.deepEqual(keys, [...keys].sort());
});

test("toUsageRows drops rows with zero tokens and zero messages", () => {
  const zero = entry({ tokens: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, reasoning: 0 }, messages: 0, cost: 0 });
  assert.deepEqual(toUsageRows({ contributions: [{ date: "2026-09-20", clients: [zero] }] }, now), []);
});

test("toUsageRows keeps rows with messages but zero tokens", () => {
  const zeroTokens = entry({ tokens: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, reasoning: 0 }, messages: 2 });
  assert.equal(toUsageRows({ contributions: [{ date: "2026-09-20", clients: [zeroTokens] }] }, now).length, 1);
});

test("toUsageRows drops rows failing validation", () => {
  const contributions = [
    { date: "2026-09-20", clients: [entry({ client: "Bad Client" }), entry({ modelId: "has space" }), entry()] },
    { date: "2026-10-10", clients: [entry()] },
  ];
  assert.deepEqual(toUsageRows({ contributions }, now).map((r) => r.day), ["2026-09-20"]);
});

test("toUsageRows treats missing token fields as zero", () => {
  const partial = entry({ tokens: { input: 5 }, cost: undefined });
  assert.deepEqual(toUsageRows({ contributions: [{ date: "2026-09-20", clients: [partial] }] }, now)[0], row({
    input: 5, output: 0, cacheRead: 0, cacheWrite: 0, costUsd: 0,
  }));
});

test("toUsageRows handles empty or missing contributions", () => {
  assert.deepEqual(toUsageRows({}, now), []);
  assert.deepEqual(toUsageRows({ contributions: [] }, now), []);
});

test("validateRow accepts a valid row including tomorrow", () => {
  assert.deepEqual(validateRow(row(), now), []);
  assert.deepEqual(validateRow(row({ day: "2026-09-25" }), now), []);
});

test("validateRow rejects malformed fields", () => {
  const invalid = [
    { day: "2026-9-20" },
    { day: "2026-02-30" },
    { day: "2026-09-26" },
    { client: "" },
    { client: "Claude" },
    { client: "a".repeat(41) },
    { model: "" },
    { model: "m".repeat(121) },
    { model: "bad model" },
    { input: -1 },
    { output: 1.5 },
    { cacheRead: Number.MAX_SAFE_INTEGER + 1 },
    { messages: "3" },
    { costUsd: -0.1 },
    { costUsd: Number.NaN },
    { costUsd: Infinity },
  ];
  invalid.forEach((overrides) => assert.notDeepEqual(validateRow(row(overrides), now), [], JSON.stringify(overrides)));
});

test("validateRow accepts model ids with allowed punctuation", () => {
  assert.deepEqual(validateRow(row({ model: "openai/gpt-5.1:free@v2+x_y" }), now), []);
});

test("rowTokens sums input, output and cache without reasoning", () => {
  assert.equal(rowTokens(row({ reasoning: 100 })), 10);
});

test("syncWindow returns full history on first sync", () => {
  assert.deepEqual(syncWindow({ lastSyncAt: null, now }), { since: null });
});

test("syncWindow returns now minus 35 days on later syncs", () => {
  assert.deepEqual(syncWindow({ lastSyncAt: "2026-09-23T10:00:00.000Z", now }), { since: "2026-08-20" });
});

test("summarize computes today, last 7 days and top model", () => {
  const rows = [
    row({ day: "2026-09-24", model: "a", input: 10, output: 0, cacheRead: 0, cacheWrite: 0, costUsd: 1 }),
    row({ day: "2026-09-24", client: "codex", model: "b", input: 5, output: 0, cacheRead: 0, cacheWrite: 0, costUsd: 0.5 }),
    row({ day: "2026-09-18", model: "b", input: 20, output: 0, cacheRead: 0, cacheWrite: 0, costUsd: 2 }),
    row({ day: "2026-09-17", model: "c", input: 1000, output: 0, cacheRead: 0, cacheWrite: 0, costUsd: 9 }),
  ];
  assert.deepEqual(summarize(rows, now), {
    today: { tokens: 15, costUsd: 1.5 },
    week: { tokens: 35, costUsd: 3.5 },
    topModel: "b",
  });
});

test("summarize returns zeros and null top model without recent rows", () => {
  assert.deepEqual(summarize([row({ day: "2026-01-01" })], now), {
    today: { tokens: 0, costUsd: 0 },
    week: { tokens: 0, costUsd: 0 },
    topModel: null,
  });
});

test("chunk splits rows into size-bounded slices", () => {
  assert.deepEqual(chunk([1, 2, 3], 2), [[1, 2], [3]]);
  assert.deepEqual(chunk([], 2), []);
  assert.equal(chunk(Array.from({ length: 1001 }, (_, i) => i)).length, 3);
});
