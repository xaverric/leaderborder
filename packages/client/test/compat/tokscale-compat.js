import { fileURLToPath } from "node:url";
import { collectActivity, readGraph, readReport, runTokscale, toUsageRows, validateRow } from "../../src/core/index.js";

const HOME = fileURLToPath(new URL("../../../../fixtures/home", import.meta.url));
const TOKEN_FIELDS = ["input", "output", "cacheRead", "cacheWrite", "messages"];
const EXPECTED = [
  { day: "2026-09-10", client: "claude", model: "claude-sonnet-4-5", input: 110, output: 220, cacheRead: 3000, cacheWrite: 50, messages: 2 },
  { day: "2026-09-10", client: "codex", model: "gpt-5-codex", input: 250, output: 45, cacheRead: 250, cacheWrite: 0, messages: 2 },
  { day: "2026-09-11", client: "claude", model: "claude-haiku-4-5", input: 5, output: 7, cacheRead: 0, cacheWrite: 3, messages: 1 },
];
const NOW = new Date(2026, 8, 24, 12);
const ACTIVITY_WINDOW = { since: "2026-09-10", until: "2026-09-11" };
const EXPECTED_GEN_MS = { "2026-09-10 claude claude-sonnet-4-5": 5000, "2026-09-10 codex gpt-5-codex": 2000, "2026-09-11 claude claude-haiku-4-5": 0 };
const EXPECTED_ACTIVITY = {
  "2026-09-10": { activeMs: 67000, longestMs: 65000, sessions: 2, maxConcurrent: 2, messages: { claude: 2, codex: 2 }, prompts: { claude: 1, codex: 0 } },
  "2026-09-11": { activeMs: 0, longestMs: 0, sessions: 1, maxConcurrent: 1, messages: { claude: 1 }, prompts: { claude: 0 } },
};

const shapeProblems = (graph) => {
  const contributions = Array.isArray(graph.contributions) ? graph.contributions : null;
  if (!contributions) return ["graph.contributions is not an array"];
  const entries = contributions.flatMap((c) => (Array.isArray(c.clients) ? c.clients : [null]));
  return [
    ...(typeof graph.meta?.version === "string" ? [] : ["graph.meta.version missing"]),
    ...contributions.filter((c) => typeof c.date !== "string").map(() => "contribution without date"),
    ...entries
      .filter((e) => !e || typeof e.client !== "string" || typeof e.modelId !== "string" || typeof e.tokens !== "object" || typeof e.messages !== "number")
      .map((e) => `malformed client entry: ${JSON.stringify(e)}`),
  ];
};

const key = (row) => `${row.day} ${row.client} ${row.model}`;

const rowProblems = (rows) => {
  const actual = new Map(rows.map((row) => [key(row), row]));
  const missing = EXPECTED.filter((row) => !actual.has(key(row))).map((row) => `missing row ${key(row)}`);
  const unexpected = rows.filter((row) => !EXPECTED.some((e) => key(e) === key(row))).map((row) => `unexpected row ${key(row)}`);
  const mismatched = EXPECTED.filter((row) => actual.has(key(row))).flatMap((row) =>
    TOKEN_FIELDS.filter((field) => actual.get(key(row))[field] !== row[field]).map(
      (field) => `${key(row)} ${field}: expected ${row[field]}, got ${actual.get(key(row))[field]}`,
    ),
  );
  const invalid = rows.flatMap((row) => validateRow(row, NOW).map((field) => `${key(row)} invalid ${field}`));
  return [...missing, ...unexpected, ...mismatched, ...invalid];
};

const differs = (label, expected, actual) => (JSON.stringify(expected) === JSON.stringify(actual) ? [] : [`${label}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`]);

const sumBy = (clients, index) => Object.fromEntries(clients.map((c) => [c.client, c.hours.reduce((sum, bucket) => sum + bucket[index], 0)]));

const activityProblems = ({ rows, activity }) => [
  ...Object.entries(EXPECTED_GEN_MS).flatMap(([label, genMs]) => differs(`${label} genMs`, genMs, rows.find((row) => key(row) === label)?.genMs)),
  ...differs("activity days", Object.keys(EXPECTED_ACTIVITY), activity.map((entry) => entry.day)),
  ...activity.flatMap(({ day, clients, ...session }) => {
    const { messages, prompts, ...expected } = EXPECTED_ACTIVITY[day] ?? {};
    return [
      ...differs(`${day} session metrics`, expected, session),
      ...differs(`${day} hourly messages`, messages, sumBy(clients, 1)),
      ...differs(`${day} prompts`, prompts, Object.fromEntries(clients.map((c) => [c.client, c.prompts]))),
      ...clients.filter((c) => c.hours.length !== 24).map((c) => `${day} ${c.client}: expected 24 hours, got ${c.hours.length}`),
    ];
  }),
];

const { stdout: versionOutput } = await runTokscale(["--version"]);
const version = versionOutput.trim();
const graph = await readGraph({ home: HOME });
const rows = toUsageRows(graph, NOW);
const activity = await collectActivity({ rows, window: ACTIVITY_WINDOW, home: HOME }, { report: readReport });
const problems = [...shapeProblems(graph), ...rowProblems(rows), ...activityProblems(activity)];

if (problems.length > 0) {
  process.stderr.write(`tokscale compat FAILED (${version}):\n${problems.map((p) => `  - ${p}`).join("\n")}\n`);
  process.exit(1);
}
process.stdout.write(`tokscale compat ok (${version}): ${EXPECTED.length} rows and ${Object.keys(EXPECTED_ACTIVITY).length} activity days match\n`);
