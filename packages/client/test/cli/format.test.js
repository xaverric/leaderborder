import { test } from "node:test";
import assert from "node:assert/strict";
import { cleanText, formatActivityTables, formatNumber, formatUsd, formatRowsTable, formatStatus } from "../../src/cli/format.js";

const ANSI = "\u001b[31mred\u001b[0m";

const row = {
  day: "2026-09-24",
  client: "claude",
  model: "claude-opus-5",
  input: 1200,
  output: 30,
  cacheRead: 1000000,
  cacheWrite: 5,
  reasoning: 0,
  costUsd: 1.23456,
  messages: 7,
};

test("formatNumber groups thousands", () => {
  assert.equal(formatNumber(1234567), "1,234,567");
  assert.equal(formatNumber(0), "0");
});

test("formatUsd prints two decimals", () => {
  assert.equal(formatUsd(1.23456), "$1.23");
  assert.equal(formatUsd(0), "$0.00");
});

test("cleanText strips control characters, coerces and truncates", () => {
  assert.equal(cleanText(ANSI), "[31mred[0m");
  assert.equal(cleanText("a\nb\r\tc\u0000d\u007fe\u0085f\u009bg"), "abcdefg");
  assert.equal(cleanText("x".repeat(300)).length, 200);
  assert.equal(cleanText("x".repeat(300), 10), "x".repeat(10));
  assert.equal(cleanText(42), "42");
  assert.equal(cleanText(null), "");
  assert.equal(cleanText(undefined), "");
  assert.equal(cleanText("Praha kancelář"), "Praha kancelář");
});

test("formatRowsTable prints a header and aligned rows", () => {
  const lines = formatRowsTable([row, { ...row, client: "codex", model: "gpt-6", input: 1 }]).split("\n");
  assert.equal(lines.length, 3);
  assert.match(lines[0], /^day\s+client\s+model\s+input\s+output\s+cacheRead\s+cacheWrite\s+reasoning\s+costUsd\s+messages$/);
  assert.match(lines[1], /^2026-09-24\s+claude\s+claude-opus-5\s+1,200\s+30\s+1,000,000\s+5\s+0\s+\$1\.23\s+7$/);
  assert.equal(new Set(lines.map((line) => line.length)).size, 1);
});

test("formatRowsTable handles no rows", () => {
  assert.equal(formatRowsTable([]), "No usage rows.");
});

test("formatRowsTable adds model time columns when rows carry them", () => {
  const lines = formatRowsTable([{ ...row, genMs: 5000, genSamples: 2 }, { ...row, client: "cursor" }]).split("\n");
  assert.match(lines[0], /messages\s+genMs\s+genSamples$/);
  assert.match(lines[1], /\s7\s+5,000\s+2$/);
  assert.match(lines[2], /\s7\s+-\s+-$/);
});

test("formatActivityTables prints day totals and prompts with non-empty hours per tool", () => {
  const hours = Array.from({ length: 24 }, (_, hour) => (hour === 14 ? [3380, 2, 1] : [0, 0, 0]));
  const text = formatActivityTables([{ day: "2026-09-10", activeMs: 67000, longestMs: 65000, sessions: 2, maxConcurrent: 2, clients: [{ client: "claude", prompts: 1, hours }] }]);
  assert.match(text, /^day\s+activeMs\s+longestMs\s+sessions\s+maxConcurrent$/m);
  assert.match(text, /^2026-09-10\s+67,000\s+65,000\s+2\s+2$/m);
  assert.match(text, /^2026-09-10\s+claude\s+1\s+14h 3380\/2\/1$/m);
  assert.equal(formatActivityTables([]), "No activity measured.");
});

test("formatStatus describes a logged out device", () => {
  const text = formatStatus({ state: { deviceId: null, lastSyncAt: null, lastError: null, summary: null }, apiUrl: "http://x", hasToken: false });
  assert.match(text, /Logged in:\s+no/);
  assert.match(text, /Last sync:\s+never/);
  assert.match(text, /API:\s+http:\/\/x/);
});

test("formatStatus describes a synced device with summary and error", () => {
  const text = formatStatus({
    state: {
      deviceId: "d1",
      deviceName: "Octo Mac",
      lastSyncAt: "2026-09-24T10:00:00.000Z",
      lastError: { code: "network", message: "offline", at: "2026-09-24T11:00:00.000Z" },
      summary: { today: { tokens: 1500, costUsd: 1 }, week: { tokens: 20000, costUsd: 12.5 }, topModel: "claude-opus-5" },
    },
    apiUrl: "http://x",
    hasToken: true,
  });
  assert.match(text, /Logged in:\s+yes/);
  assert.match(text, /Device:\s+Octo Mac \(d1\)/);
  assert.match(text, /Today:\s+1,500 tokens, \$1\.00/);
  assert.match(text, /Week:\s+20,000 tokens, \$12\.50/);
  assert.match(text, /Top model:\s+claude-opus-5/);
  assert.match(text, /Last error:\s+\[network\] offline/);
});

test("formatStatus strips control characters from persisted state", () => {
  const text = formatStatus({
    state: {
      deviceId: "d1",
      deviceName: `Octo ${ANSI}\nLogged in: yes`,
      lastSyncAt: null,
      lastError: { code: "network\u0007", message: "offline\u001b\n\nfake line", at: "2026-09-24T11:00:00.000Z" },
      summary: null,
    },
    apiUrl: "http://x",
    hasToken: false,
  });
  assert.ok(!text.includes("\u001b"));
  assert.match(text, /Device:\s+Octo \[31mred\[0mLogged in: yes \(d1\)/);
  assert.match(text, /Last error:\s+\[network\] offlinefake line/);
  assert.equal(text.split("\n").filter((line) => line.startsWith("Logged in:")).length, 1);
});
