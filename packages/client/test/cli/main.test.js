import { test } from "node:test";
import assert from "node:assert/strict";
import { main } from "../../src/cli/main.js";
import { LeaderborderError } from "../../src/core/errors.js";

const TOKEN = `lb_${"s".repeat(43)}`;

const stream = () => {
  const chunks = [];
  return { write: (chunk) => chunks.push(String(chunk)), text: () => chunks.join("") };
};

const row = {
  day: "2026-09-24",
  client: "claude",
  model: "claude-opus-5",
  input: 1,
  output: 2,
  cacheRead: 3,
  cacheWrite: 4,
  reasoning: 0,
  costUsd: 0.5,
  messages: 1,
};

const summary = { today: { tokens: 10, costUsd: 0.5 }, week: { tokens: 10, costUsd: 0.5 }, topModel: "claude-opus-5" };

const setup = (coreOverrides = {}, ioOverrides = {}) => {
  const calls = { sync: [], spawn: [], cursorLogin: [], logout: 0 };
  const core = {
    LeaderborderError,
    getConfig: () => ({ apiUrl: "http://api.test", configDir: "/cfg" }),
    loadState: () => ({ deviceId: "d1", deviceName: "Mac", lastSyncAt: null, lastError: null, summary: null }),
    keychain: { getToken: async () => TOKEN },
    sync: async (options) => {
      calls.sync.push(options);
      options.onProgress?.({ phase: "graph", since: null });
      return { rows: [row], since: null, summary, warnings: [], uploaded: options.dryRun ? 0 : 1 };
    },
    login: async ({ onCode }) => {
      await onCode({ userCode: "ABCD-1234", verificationUri: "https://github.com/login/device", expiresIn: 900 });
      return { user: { login: "octo", name: "Octo Cat" } };
    },
    logout: async () => {
      calls.logout += 1;
    },
    cursorLogin: async (options) => {
      calls.cursorLogin.push(options);
    },
    ...coreOverrides,
  };
  const io = {
    stdout: stream(),
    stderr: stream(),
    core,
    platform: "darwin",
    env: { PATH: "/bin", ELECTRON_RUN_AS_NODE: "1" },
    version: "9.9.9",
    packageRoot: "/pkg/client",
    loadElectron: async () => "/electron/Electron",
    spawn: (file, args, options) => {
      const child = { unrefCalled: false, unref() { this.unrefCalled = true; }, on() { return this; } };
      calls.spawn.push({ file, args, options, child });
      return child;
    },
    ...ioOverrides,
  };
  return { io, calls, run: (argv) => main(argv, io) };
};

test("--help prints usage and exits 0", async () => {
  const { io, run } = setup();
  assert.equal(await run(["--help"]), 0);
  assert.match(io.stdout.text(), /Usage: leaderborder/);
  assert.match(io.stdout.text(), /sync \[--dry-run\]/);
});

test("--version prints the package version", async () => {
  const { io, run } = setup();
  assert.equal(await run(["--version"]), 0);
  assert.equal(io.stdout.text(), "9.9.9\n");
});

test("unknown command exits 2", async () => {
  const { io, run } = setup();
  assert.equal(await run(["frobnicate"]), 2);
  assert.match(io.stderr.text(), /unknown command/);
});

test("unknown option exits 2", async () => {
  const { run } = setup();
  assert.equal(await run(["sync", "--force"]), 2);
});

test("option for another command exits 2", async () => {
  const { run } = setup();
  assert.equal(await run(["login", "--json"]), 2);
  assert.equal(await run(["status", "--dry-run"]), 2);
});

test("extra positional arguments exit 2", async () => {
  const { run } = setup();
  assert.equal(await run(["sync", "now"]), 2);
});

test("status --json prints state and token presence without the token", async () => {
  const { io, run } = setup();
  assert.equal(await run(["status", "--json"]), 0);
  const output = JSON.parse(io.stdout.text());
  assert.equal(output.deviceId, "d1");
  assert.equal(output.hasToken, true);
  assert.equal(output.apiUrl, "http://api.test");
  assert.ok(!io.stdout.text().includes(TOKEN));
});

test("status prints a readable summary", async () => {
  const { io, run } = setup({ keychain: { getToken: async () => null } });
  assert.equal(await run(["status"]), 0);
  assert.match(io.stdout.text(), /Logged in:\s+no/);
});

test("sync --dry-run prints the rows table and uploads nothing", async () => {
  const { io, calls, run } = setup();
  assert.equal(await run(["sync", "--dry-run"]), 0);
  assert.equal(calls.sync[0].dryRun, true);
  assert.match(io.stdout.text(), /^day\s+client\s+model/m);
  assert.match(io.stdout.text(), /claude-opus-5/);
  assert.match(io.stdout.text(), /1 row .*nothing uploaded/i);
});

test("sync uploads and prints the summary", async () => {
  const { io, calls, run } = setup();
  assert.equal(await run(["sync"]), 0);
  assert.equal(calls.sync[0].dryRun, false);
  assert.match(io.stdout.text(), /Uploaded 1 row/);
  assert.match(io.stdout.text(), /Today:\s+10 tokens/);
});

test("sync prints warnings to stderr", async () => {
  const { io, run } = setup({ sync: async () => ({ rows: [], since: null, summary, warnings: ["Cursor sync skipped: x"], uploaded: 0 }) });
  assert.equal(await run(["sync"]), 0);
  assert.match(io.stderr.text(), /Cursor sync skipped: x/);
});

test("sync failure prints the error code and exits 1", async () => {
  const { io, run } = setup({
    sync: async () => {
      throw new LeaderborderError("not_logged_in", "not logged in, run leaderborder login");
    },
  });
  assert.equal(await run(["sync"]), 1);
  assert.match(io.stderr.text(), /not logged in.*\[not_logged_in\]/);
});

test("login prints the code, opens the URL and reports the user", async () => {
  const { io, calls, run } = setup();
  assert.equal(await run(["login"]), 0);
  assert.match(io.stdout.text(), /ABCD-1234/);
  assert.match(io.stdout.text(), /https:\/\/github\.com\/login\/device/);
  assert.deepEqual(calls.spawn[0].file, "open");
  assert.deepEqual(calls.spawn[0].args, ["https://github.com/login/device"]);
  assert.match(io.stdout.text(), /Logged in as octo/);
});

test("logout calls core logout", async () => {
  const { calls, run } = setup();
  assert.equal(await run(["logout"]), 0);
  assert.equal(calls.logout, 1);
});

test("cursor-login runs tokscale cursor login with inherited stdio", async () => {
  const { calls, run } = setup();
  assert.equal(await run(["cursor-login"]), 0);
  assert.deepEqual(calls.cursorLogin, [{ stdio: "inherit" }]);
});

test("no arguments launch the Electron app detached", async () => {
  const { calls, run } = setup();
  assert.equal(await run([]), 0);
  const [launch] = calls.spawn;
  assert.equal(launch.file, "/electron/Electron");
  assert.deepEqual(launch.args, ["/pkg/client"]);
  assert.equal(launch.options.detached, true);
  assert.equal(launch.options.stdio, "ignore");
  assert.equal(launch.options.env.ELECTRON_RUN_AS_NODE, undefined);
  assert.equal(launch.options.env.PATH, "/bin");
  assert.equal(launch.child.unrefCalled, true);
});

test("app launches the Electron app", async () => {
  const { calls, run } = setup();
  assert.equal(await run(["app"]), 0);
  assert.equal(calls.spawn.length, 1);
});

test("app on a non-macOS platform fails with a clear error", async () => {
  const { io, calls, run } = setup({}, { platform: "linux" });
  assert.equal(await run(["app"]), 1);
  assert.equal(calls.spawn.length, 0);
  assert.match(io.stderr.text(), /macOS/);
});
