import { execFile as nodeExecFile, spawn as nodeSpawn } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir as osTmpdir } from "node:os";
import { dirname, join } from "node:path";
import { LeaderborderError } from "./errors.js";

const require = createRequire(import.meta.url);
const DEFAULT_TIMEOUT_MS = 120000;
const MAX_BUFFER = 64 * 1024 * 1024;
const STRIPPED_ENV = new Set(["NODE_OPTIONS", "ELECTRON_RUN_AS_NODE", "NODE_TLS_REJECT_UNAUTHORIZED", "TOKSCALE_API_TOKEN"]);
const CURSOR_SUBCOMMANDS = new Set(["status", "sync", "login"]);
const REPORT_COMMANDS = new Set(["models", "hourly", "time-metrics"]);

const isAllowed = (args) =>
  Array.isArray(args) &&
  ((args.length === 1 && args[0] === "--version") ||
    args[0] === "graph" ||
    (REPORT_COMMANDS.has(args[0]) && args.includes("--json")) ||
    (args[0] === "cursor" && CURSOR_SUBCOMMANDS.has(args[1])));

export const childEnv = (env = process.env) => ({
  ...Object.fromEntries(Object.entries(env).filter(([key]) => !STRIPPED_ENV.has(key))),
  NO_COLOR: "1",
});

export const tokscaleBin = ({ arch = process.arch, resolve = require.resolve } = {}) => {
  const packageName = `@tokscale/cli-darwin-${arch}`;
  try {
    return join(dirname(resolve(`${packageName}/package.json`)), "bin", "tokscale").replace("app.asar/", "app.asar.unpacked/");
  } catch (cause) {
    throw new LeaderborderError("tokscale_failed", `tokscale binary ${packageName} is not installed`, { cause });
  }
};

export const runTokscale = (args, { timeoutMs = DEFAULT_TIMEOUT_MS, bin, execFile = nodeExecFile } = {}) =>
  new Promise((resolve, reject) => {
    if (!isAllowed(args)) return reject(new LeaderborderError("tokscale_failed", `tokscale ${args?.[0] ?? ""} is not allowed`));
    const options = { timeout: timeoutMs, maxBuffer: MAX_BUFFER, env: childEnv() };
    execFile(bin ?? tokscaleBin(), args, options, (error, stdout, stderr) => {
      if (!error) return resolve({ stdout: String(stdout), stderr: String(stderr) });
      const detail = String(stderr ?? "").trim() || error.message;
      reject(new LeaderborderError("tokscale_failed", `tokscale ${args[0] ?? ""} failed: ${detail}`, { cause: error }));
    });
  });

const graphArgs = ({ since, home, output }) => [
  "graph",
  "--no-spinner",
  ...(since ? ["--since", since] : []),
  ...(home ? ["--home", home] : []),
  "--output",
  output,
];

const parseObject = (text, command) => {
  const value = JSON.parse(text);
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(`${command} output is not an object`);
  return value;
};

const parseGraph = (text) => parseObject(text, "graph");

const reportArgs = (command, { since, until, clients = [], home, extra = [] }) => [
  command,
  "--json",
  "--no-spinner",
  "--since",
  since,
  "--until",
  until,
  ...extra,
  ...(clients.length ? ["--client", clients.join(",")] : []),
  ...(home ? ["--home", home] : []),
];

export const readReport = async (command, options, { run = runTokscale } = {}) => {
  try {
    const { stdout } = await run(reportArgs(command, options));
    return parseObject(stdout, command);
  } catch (cause) {
    if (cause instanceof LeaderborderError) throw cause;
    throw new LeaderborderError("tokscale_failed", `tokscale ${command} output unreadable: ${cause.message}`, { cause });
  }
};

export const readGraph = async ({ since = null, home } = {}, { run = runTokscale, tmpdir = osTmpdir } = {}) => {
  const directory = mkdtempSync(join(tmpdir(), "leaderborder-graph-"));
  const output = join(directory, "graph.json");
  try {
    await run(graphArgs({ since, home, output }));
    return parseGraph(readFileSync(output, "utf8"));
  } catch (cause) {
    if (cause instanceof LeaderborderError) throw cause;
    throw new LeaderborderError("tokscale_failed", `tokscale graph output unreadable: ${cause.message}`, { cause });
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
};

export const cursorStatus = async ({ run = runTokscale } = {}) => {
  const { stdout } = await run(["cursor", "status"]);
  return { loggedIn: /Session:\s*Valid\b/.test(stdout) };
};

export const cursorSync = ({ run = runTokscale } = {}) => run(["cursor", "sync"]);

export const cursorLogin = ({ stdio = "inherit", spawn = nodeSpawn, bin } = {}) =>
  new Promise((resolve, reject) => {
    const child = spawn(bin ?? tokscaleBin(), ["cursor", "login", "--name", "default"], {
      stdio,
      env: childEnv(),
      ...(stdio === "pipe" ? { timeout: 90_000, killSignal: "SIGKILL" } : {}),
    });
    if (stdio === "pipe") {
      child.stdout?.resume();
      child.stderr?.resume();
      child.stdin?.on("error", () => {});
      child.stdin?.end();
    }
    child.on("error", (cause) => reject(new LeaderborderError("tokscale_failed", `tokscale cursor login failed: ${cause.message}`, { cause })));
    child.on("exit", (code) =>
      code === 0 ? resolve() : reject(new LeaderborderError("tokscale_failed", `tokscale cursor login exited with ${code}`)),
    );
  });
