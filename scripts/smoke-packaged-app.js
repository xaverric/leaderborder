import { spawn } from "node:child_process";
import { once } from "node:events";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { setTimeout as delay } from "node:timers/promises";

const app = process.argv[2];
if (!app) throw new Error("Usage: node scripts/smoke-packaged-app.js <app-path>");

const home = await mkdtemp(join(tmpdir(), "leaderborder-smoke-"));
const child = spawn(join(resolve(app), "Contents/MacOS/Leaderborder"), [`--user-data-dir=${join(home, "user-data")}`], {
  env: { ...process.env, HOME: home, LEADERBORDER_CONFIG_DIR: join(home, "config"), LEADERBORDER_API_URL: "http://127.0.0.1:1" },
  stdio: ["ignore", "pipe", "pipe"],
});
let output = "";
child.stdout.on("data", (data) => { output += data; });
child.stderr.on("data", (data) => { output += data; });
const exited = once(child, "exit");

try {
  await Promise.race([
    delay(5000),
    exited.then(([code, signal]) => { throw new Error(`Packaged app exited during startup (${code ?? signal}): ${output}`); }),
  ]);
  if (/ERR_FILE_NOT_FOUND|Unable to load preload|Uncaught Exception/.test(output)) throw new Error(output);
  console.log("Packaged app startup passed.");
} finally {
  child.kill("SIGTERM");
  await exited;
  await rm(home, { recursive: true, force: true });
}
