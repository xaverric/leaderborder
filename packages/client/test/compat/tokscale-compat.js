import { fileURLToPath } from "node:url";
import { readGraph, runTokscale, toUsageRows, validateRow } from "../../src/core/index.js";

const HOME = fileURLToPath(new URL("../../../../fixtures/home", import.meta.url));
const TOKEN_FIELDS = ["input", "output", "cacheRead", "cacheWrite", "messages"];
const EXPECTED = [
  { day: "2026-09-10", client: "claude", model: "claude-sonnet-4-5", input: 110, output: 220, cacheRead: 3000, cacheWrite: 50, messages: 2 },
  { day: "2026-09-10", client: "codex", model: "gpt-5-codex", input: 250, output: 45, cacheRead: 250, cacheWrite: 0, messages: 2 },
  { day: "2026-09-11", client: "claude", model: "claude-haiku-4-5", input: 5, output: 7, cacheRead: 0, cacheWrite: 3, messages: 1 },
];
const NOW = new Date(2026, 8, 24, 12);

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

const { stdout: versionOutput } = await runTokscale(["--version"]);
const version = versionOutput.trim();
const graph = await readGraph({ home: HOME });
const problems = [...shapeProblems(graph), ...rowProblems(toUsageRows(graph, NOW))];

if (problems.length > 0) {
  process.stderr.write(`tokscale compat FAILED (${version}):\n${problems.map((p) => `  - ${p}`).join("\n")}\n`);
  process.exit(1);
}
process.stdout.write(`tokscale compat ok (${version}): ${EXPECTED.length} rows match\n`);
