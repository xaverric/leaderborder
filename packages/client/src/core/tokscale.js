import { execFile as nodeExecFile, spawn as nodeSpawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { readFileSync, rmSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir as osTmpdir } from "node:os";
import { dirname, join } from "node:path";
import { LeaderborderError } from "./errors.js";

const require = createRequire(import.meta.url);
const DEFAULT_TIMEOUT_MS = 120000;
const MAX_BUFFER = 64 * 1024 * 1024;

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
    const options = { timeout: timeoutMs, maxBuffer: MAX_BUFFER, env: { ...process.env, NO_COLOR: "1" } };
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

const parseGraph = (text) => {
  const graph = JSON.parse(text);
  if (!graph || typeof graph !== "object" || Array.isArray(graph)) throw new Error("graph output is not an object");
  return graph;
};

export const readGraph = async ({ since = null, home } = {}, { run = runTokscale, tmpdir = osTmpdir } = {}) => {
  const output = join(tmpdir(), `leaderborder-graph-${randomUUID()}.json`);
  try {
    await run(graphArgs({ since, home, output }));
    return parseGraph(readFileSync(output, "utf8"));
  } catch (cause) {
    if (cause instanceof LeaderborderError) throw cause;
    throw new LeaderborderError("tokscale_failed", `tokscale graph output unreadable: ${cause.message}`, { cause });
  } finally {
    rmSync(output, { force: true });
  }
};

export const cursorStatus = async ({ run = runTokscale } = {}) => {
  const { stdout } = await run(["cursor", "status"]);
  return { loggedIn: /Session:\s*Valid\b/.test(stdout) };
};

export const cursorSync = ({ run = runTokscale } = {}) => run(["cursor", "sync"]);

export const cursorLogin = ({ stdio = "inherit", spawn = nodeSpawn, bin } = {}) =>
  new Promise((resolve, reject) => {
    const child = spawn(bin ?? tokscaleBin(), ["cursor", "login", "--name", "default"], { stdio });
    child.on("error", (cause) => reject(new LeaderborderError("tokscale_failed", `tokscale cursor login failed: ${cause.message}`, { cause })));
    child.on("exit", (code) =>
      code === 0 ? resolve() : reject(new LeaderborderError("tokscale_failed", `tokscale cursor login exited with ${code}`)),
    );
  });
