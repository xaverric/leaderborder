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

const ANSI = "\u001b[31m";

const setup = (coreOverrides = {}, ioOverrides = {}) => {
  const calls = { sync: [], spawn: [], cursorLogin: [], login: [], logout: [], getConfig: [] };
  const core = {
    LeaderborderError,
    getConfig: (env, overrides) => {
      calls.getConfig.push({ env, overrides });
      return { apiUrl: overrides?.apiUrl ?? "http://api.test", configDir: "/cfg" };
    },
    loadState: () => ({ deviceId: "d1", deviceName: "Mac", lastSyncAt: null, lastError: null, summary: null }),
    keychain: { getToken: async () => TOKEN },
    sync: async (options) => {
      calls.sync.push(options);
      options.onProgress?.({ phase: "graph", since: null });
      return { rows: [row], since: null, summary, warnings: [], uploaded: options.dryRun ? 0 : 1 };
    },
    login: async (options) => {
      calls.login.push(options);
      await options.onCode({ userCode: "ABCD-1234", verificationUri: "https://github.com/login/device", expiresIn: 900 });
      return { user: { login: "octo", name: "Octo Cat" } };
    },
    logout: async (options) => {
      calls.logout.push(options);
      return { revoked: true };
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
  assert.equal(await run(["app", "--api-url", "https://x.test"]), 2);
  assert.equal(await run(["cursor-login", "--api-url", "https://x.test"]), 2);
  assert.equal(await run(["sync", "--device-name", "Mac"]), 2);
});

test("--api-url is forwarded to login, logout, sync and status ahead of the environment", async () => {
  const { calls, run } = setup({}, { env: { LEADERBORDER_API_URL: "http://localhost:8787" } });
  assert.equal(await run(["login", "--api-url", "https://staging.test"]), 0);
  assert.equal(await run(["logout", "--api-url", "https://staging.test"]), 0);
  assert.equal(await run(["sync", "--api-url", "https://staging.test"]), 0);
  assert.equal(await run(["status", "--api-url", "https://staging.test"]), 0);
  assert.equal(calls.login[0].apiUrl, "https://staging.test");
  assert.equal(calls.logout[0].apiUrl, "https://staging.test");
  assert.equal(calls.sync[0].apiUrl, "https://staging.test");
  assert.deepEqual(calls.getConfig.map((c) => c.overrides), [{ apiUrl: "https://staging.test" }, { apiUrl: "https://staging.test" }]);
  assert.deepEqual(calls.getConfig[0].env, { LEADERBORDER_API_URL: "http://localhost:8787" });
});

test("without --api-url the commands leave the API URL to the environment", async () => {
  const { calls, run } = setup();
  assert.equal(await run(["sync"]), 0);
  assert.equal(await run(["status"]), 0);
  assert.equal(calls.sync[0].apiUrl, undefined);
  assert.deepEqual(calls.getConfig[0].overrides, { apiUrl: undefined });
});

test("login prints the API host when it is not the default", async () => {
  const { io, run } = setup();
  assert.equal(await run(["login", "--api-url", "https://staging.test:8443"]), 0);
  const [first] = io.stdout.text().split("\n");
  assert.equal(first, "API: staging.test:8443");
});

test("login does not print the API host for the default server", async () => {
  const { io, run } = setup({ getConfig: () => ({ apiUrl: "https://leaderborder.xaverric.cz", configDir: "/cfg" }) });
  assert.equal(await run(["login"]), 0);
  assert.ok(!io.stdout.text().includes("API:"));
  assert.match(io.stdout.text(), /^Your one-time code: ABCD-1234$/m);
});

test("login forwards --device-name to the core", async () => {
  const { calls, run } = setup();
  assert.equal(await run(["login", "--device-name", "Work Mac"]), 0);
  assert.equal(calls.login[0].deviceName, "Work Mac");
  assert.equal(await run(["login"]), 0);
  assert.equal(calls.login[1].deviceName, undefined);
});

test("login output strips control characters from the server user", async () => {
  const { io, run } = setup({
    login: async () => ({ user: { login: `octo${ANSI}\nLogged in as admin`, name: "Octo\u0007\r Cat" } }),
  });
  assert.equal(await run(["login"]), 0);
  assert.ok(!io.stdout.text().includes("\u001b"));
  assert.match(io.stdout.text(), /^Logged in as octo\[31mLogged in as admin \(Octo Cat\)\. Run leaderborder sync to upload usage\.$/m);
});

test("status output strips control characters from persisted state", async () => {
  const { io, run } = setup({
    loadState: () => ({ deviceId: "d1", deviceName: "Mac\u001b\u009b", lastSyncAt: null, lastError: { code: "network", message: "off\u001b\rline", at: "2026-09-24T11:00:00.000Z" }, summary: null }),
  });
  assert.equal(await run(["status"]), 0);
  assert.ok(!io.stdout.text().includes("\u001b"));
  assert.match(io.stdout.text(), /Device:\s+Mac \(d1\)/);
  assert.match(io.stdout.text(), /Last error:\s+\[network\] offline/);
});

test("error output strips control characters from server messages", async () => {
  const { io, run } = setup({
    sync: async () => {
      throw new LeaderborderError("upload_failed", "bad\u001b\nleaderborder: all good", { status: 400 });
    },
  });
  assert.equal(await run(["sync"]), 1);
  assert.ok(!io.stderr.text().includes("\u001b"));
  assert.equal(io.stderr.text(), "leaderborder: badleaderborder: all good [upload_failed]\n");
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
  assert.match(io.stdout.text(), /^Enter it at https:\/\/github\.com\/login\/device \(opening in your browser\)$/m);
  assert.deepEqual(calls.spawn[0].file, "/usr/bin/open");
  assert.deepEqual(calls.spawn[0].args, ["https://github.com/login/device"]);
  assert.match(io.stdout.text(), /Logged in as octo/);
});

test("logout reports a revoked token", async () => {
  const { io, calls, run } = setup();
  assert.equal(await run(["logout"]), 0);
  assert.equal(calls.logout.length, 1);
  assert.equal(io.stdout.text(), "Logged out. The device token was revoked and removed from the Keychain.\n");
});

test("logout tells the user to revoke in the web app when the server call failed", async () => {
  const { io, run } = setup({ logout: async () => ({ revoked: false }) });
  assert.equal(await run(["logout"]), 0);
  assert.match(io.stdout.text(), /^Logged out\. The device token was removed from the Keychain but could not be revoked on the server\. Revoke this device in the web app\.$/m);
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
