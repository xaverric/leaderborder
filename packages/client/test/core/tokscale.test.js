import { test } from "node:test";
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { existsSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import {
  childEnv,
  tokscaleBin,
  runTokscale,
  readGraph,
  readReport,
  cursorStatus,
  cursorSync,
  cursorLogin,
} from "../../src/core/tokscale.js";

const rejectsWithCode = (promise, code) => assert.rejects(promise, (error) => error.code === code);

const STRIPPED = ["NODE_OPTIONS", "ELECTRON_RUN_AS_NODE", "NODE_TLS_REJECT_UNAUTHORIZED", "TOKSCALE_API_TOKEN"];

const withEnv = async (entries, fn) => {
  const previous = Object.fromEntries(Object.keys(entries).map((key) => [key, process.env[key]]));
  Object.assign(process.env, entries);
  try {
    return await fn();
  } finally {
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
};

test("tokscaleBin resolves the arch specific package binary", () => {
  const bin = tokscaleBin({
    arch: "arm64",
    resolve: (id) => {
      assert.equal(id, "@tokscale/cli-darwin-arm64/package.json");
      return "/x/node_modules/@tokscale/cli-darwin-arm64/package.json";
    },
  });
  assert.equal(bin, "/x/node_modules/@tokscale/cli-darwin-arm64/bin/tokscale");
});

test("tokscaleBin rewrites app.asar to app.asar.unpacked", () => {
  const bin = tokscaleBin({
    arch: "x64",
    resolve: () => "/Applications/L.app/Contents/Resources/app.asar/node_modules/@tokscale/cli-darwin-x64/package.json",
  });
  assert.equal(bin, "/Applications/L.app/Contents/Resources/app.asar.unpacked/node_modules/@tokscale/cli-darwin-x64/bin/tokscale");
});

test("tokscaleBin throws tokscale_failed when the package is missing", () => {
  assert.throws(
    () => tokscaleBin({ arch: "ppc", resolve: () => { throw new Error("not found"); } }),
    (error) => error.code === "tokscale_failed" && /darwin-ppc/.test(error.message),
  );
});

test("tokscaleBin default resolves the installed binary", { skip: process.platform !== "darwin" }, () => {
  assert.ok(existsSync(tokscaleBin()));
});

test("runTokscale runs the binary with args, timeout and NO_COLOR", async () => {
  let call;
  const execFile = (file, args, options, callback) => {
    call = { file, args, options };
    callback(null, "out", "err");
  };
  const result = await runTokscale(["--version"], { bin: "/bin/tokscale", timeoutMs: 5, execFile });
  assert.deepEqual(result, { stdout: "out", stderr: "err" });
  assert.equal(call.file, "/bin/tokscale");
  assert.deepEqual(call.args, ["--version"]);
  assert.equal(call.options.timeout, 5);
  assert.equal(call.options.env.NO_COLOR, "1");
});

test("runTokscale defaults the timeout to 120 s", async () => {
  let timeout;
  const execFile = (file, args, options, callback) => {
    timeout = options.timeout;
    callback(null, "", "");
  };
  await runTokscale(["--version"], { bin: "/bin/tokscale", execFile });
  assert.equal(timeout, 120000);
});

test("runTokscale refuses commands outside the allowlist before spawning", async () => {
  const refused = [
    ["submit"],
    ["autosubmit", "--enable"],
    ["login"],
    ["report"],
    ["delete-submitted-data"],
    ["cursor", "delete"],
    ["cursor"],
    ["--version", "--help"],
    ["--help"],
    ["models"],
    ["hourly", "--since", "2026-09-01"],
    ["time-metrics"],
    ["tui", "--json"],
    [],
  ];
  for (const args of refused) {
    const execFile = () => assert.fail(`spawned tokscale ${args.join(" ")}`);
    await assert.rejects(
      runTokscale(args, { bin: "/bin/tokscale", execFile }),
      (error) => error.code === "tokscale_failed" && /not allowed/.test(error.message),
      args.join(" "),
    );
  }
});

test("runTokscale allows --version, graph and the cursor status, sync and login subcommands", async () => {
  const seen = [];
  const execFile = (file, args, options, callback) => {
    seen.push(args);
    callback(null, "", "");
  };
  for (const args of [["--version"], ["graph", "--output", "/tmp/x"], ["cursor", "status"], ["cursor", "sync"], ["cursor", "login", "--name", "default"]]) {
    await runTokscale(args, { bin: "/bin/tokscale", execFile });
  }
  assert.equal(seen.length, 5);
});

test("runTokscale allows the models, hourly and time-metrics reports only as JSON, which never opens the TUI", async () => {
  const seen = [];
  const execFile = (file, args, options, callback) => {
    seen.push(args[0]);
    callback(null, "{}", "");
  };
  for (const command of ["models", "hourly", "time-metrics"]) {
    await runTokscale([command, "--json", "--no-spinner"], { bin: "/bin/tokscale", execFile });
  }
  assert.deepEqual(seen, ["models", "hourly", "time-metrics"]);
});

test("readReport builds a local JSON report command and parses stdout", async () => {
  const calls = [];
  const run = async (args) => {
    calls.push(args);
    return { stdout: '{"entries":[]}', stderr: "progress" };
  };
  const report = await readReport(
    "models",
    { since: "2026-09-10", until: "2026-09-10", clients: ["claude", "codex"], home: "/fixtures/home", extra: ["--group-by", "client,model"] },
    { run },
  );
  assert.deepEqual(report, { entries: [] });
  assert.deepEqual(calls[0], [
    "models", "--json", "--no-spinner", "--since", "2026-09-10", "--until", "2026-09-10",
    "--group-by", "client,model", "--client", "claude,codex", "--home", "/fixtures/home",
  ]);
});

test("readReport omits an empty client filter", async () => {
  const calls = [];
  const run = async (args) => {
    calls.push(args);
    return { stdout: "{}" };
  };
  await readReport("time-metrics", { since: "2026-09-10", until: "2026-09-11" }, { run });
  assert.deepEqual(calls[0], ["time-metrics", "--json", "--no-spinner", "--since", "2026-09-10", "--until", "2026-09-11"]);
});

test("readReport rejects unreadable or non-object output with tokscale_failed", async () => {
  const options = { since: "2026-09-10", until: "2026-09-10" };
  await rejectsWithCode(readReport("hourly", options, { run: async () => ({ stdout: "not json" }) }), "tokscale_failed");
  await rejectsWithCode(readReport("hourly", options, { run: async () => ({ stdout: "[]" }) }), "tokscale_failed");
  const failure = Object.assign(new Error("x"), { code: "tokscale_failed" });
  await assert.rejects(readReport("hourly", options, { run: async () => { throw failure; } }), (error) => error === failure || error.code === "tokscale_failed");
});

test("childEnv strips Node and tokscale credential variables and forces NO_COLOR", () => {
  const env = childEnv({ PATH: "/bin", HOME: "/h", NO_COLOR: "0", ...Object.fromEntries(STRIPPED.map((key) => [key, "synthetic"])) });
  assert.deepEqual(env, { PATH: "/bin", HOME: "/h", NO_COLOR: "1" });
});

test("runTokscale passes the reduced environment to the child", async () => {
  let env;
  const execFile = (file, args, options, callback) => {
    env = options.env;
    callback(null, "", "");
  };
  await withEnv(Object.fromEntries(STRIPPED.map((key) => [key, "synthetic"])), () =>
    runTokscale(["--version"], { bin: "/bin/tokscale", execFile }),
  );
  STRIPPED.forEach((key) => assert.equal(env[key], undefined, key));
  assert.equal(env.NO_COLOR, "1");
  assert.equal(env.PATH, process.env.PATH);
});

test("runTokscale wraps failures as tokscale_failed including stderr", async () => {
  const execFile = (file, args, options, callback) => callback(new Error("exit 1"), "", "bad flag");
  await assert.rejects(
    runTokscale(["graph"], { bin: "/bin/tokscale", execFile }),
    (error) => error.code === "tokscale_failed" && /bad flag/.test(error.message),
  );
});

const writingRun = (content, calls) => async (args) => {
  calls.push(args);
  writeFileSync(args.at(-1), content);
  return { stdout: "", stderr: "" };
};

test("readGraph passes since, parses and deletes the temp file", async () => {
  const calls = [];
  const graph = await readGraph({ since: "2026-08-20" }, { run: writingRun(JSON.stringify({ contributions: [] }), calls) });
  const [args] = calls;
  assert.deepEqual(args.slice(0, 4), ["graph", "--no-spinner", "--since", "2026-08-20"]);
  assert.equal(args.at(-2), "--output");
  assert.ok(args.at(-1).startsWith(tmpdir()));
  assert.equal(existsSync(args.at(-1)), false);
  assert.deepEqual(graph, { contributions: [] });
});

test("readGraph omits since when null and supports home", async () => {
  const calls = [];
  await readGraph({ since: null, home: "/fixtures/home" }, { run: writingRun("{}", calls) });
  assert.deepEqual(calls[0].slice(0, 4), ["graph", "--no-spinner", "--home", "/fixtures/home"]);
});

test("readGraph rejects invalid JSON with tokscale_failed and deletes the file", async () => {
  const calls = [];
  await rejectsWithCode(readGraph({}, { run: writingRun("{", calls) }), "tokscale_failed");
  assert.equal(existsSync(calls[0].at(-1)), false);
});

test("readGraph rejects a non-object graph", async () => {
  await rejectsWithCode(readGraph({}, { run: writingRun("[]", []) }), "tokscale_failed");
});

test("readGraph propagates run failures", async () => {
  const run = async () => { throw Object.assign(new Error("x"), { code: "tokscale_failed" }); };
  await rejectsWithCode(readGraph({}, { run }), "tokscale_failed");
});

test("cursorStatus reports a valid session as logged in", async () => {
  let seen;
  const run = async (args) => {
    seen = args;
    return { stdout: "\n  Cursor IDE - Status\n\n  Account: default\n  Session: Valid\n", stderr: "" };
  };
  assert.deepEqual(await cursorStatus({ run }), { loggedIn: true });
  assert.deepEqual(seen, ["cursor", "status"]);
});

test("cursorStatus reports missing or expired sessions as logged out", async () => {
  const none = async () => ({ stdout: "\n  No saved Cursor accounts.\n", stderr: "" });
  const expired = async () => ({ stdout: "  Session: \u001b[31mInvalid / Expired\u001b[0m\n", stderr: "" });
  assert.deepEqual(await cursorStatus({ run: none }), { loggedIn: false });
  assert.deepEqual(await cursorStatus({ run: expired }), { loggedIn: false });
});

test("cursorSync runs cursor sync", async () => {
  let seen;
  await cursorSync({ run: async (args) => { seen = args; return { stdout: "", stderr: "" }; } });
  assert.deepEqual(seen, ["cursor", "sync"]);
});

const fakeSpawn = (exitCode, calls) => (file, args, options) => {
  calls.push({ file, args, options });
  const child = new EventEmitter();
  setImmediate(() => child.emit("exit", exitCode));
  return child;
};

test("cursorLogin spawns cursor login with the default account name", async () => {
  const calls = [];
  await cursorLogin({ spawn: fakeSpawn(0, calls), bin: "/bin/tokscale" });
  assert.deepEqual(calls[0].args, ["cursor", "login", "--name", "default"]);
  assert.equal(calls[0].file, "/bin/tokscale");
  assert.equal(calls[0].options.stdio, "inherit");
  assert.equal(calls[0].options.env.NO_COLOR, "1");
  STRIPPED.forEach((key) => assert.equal(calls[0].options.env[key], undefined, key));
});

test("cursorLogin rejects on non-zero exit", async () => {
  await rejectsWithCode(cursorLogin({ stdio: "pipe", spawn: fakeSpawn(1, []), bin: "/bin/tokscale" }), "tokscale_failed");
});

test("cursorLogin rejects on spawn error", async () => {
  const spawn = () => {
    const child = new EventEmitter();
    setImmediate(() => child.emit("error", new Error("ENOENT")));
    return child;
  };
  await rejectsWithCode(cursorLogin({ spawn, bin: "/bin/tokscale" }), "tokscale_failed");
});
