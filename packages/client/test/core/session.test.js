import { test } from "node:test";
import assert from "node:assert/strict";
import { login, logout, sync } from "../../src/core/session.js";
import { defaultState } from "../../src/core/state.js";
import { LeaderborderError } from "../../src/core/errors.js";

const TOKEN = `lb_${"t".repeat(43)}`;
const DEVICE_ID = "8f14e45f-ceea-4e7a-9f1b-2c3d4e5f6a7b";
const now = new Date(2026, 8, 24, 12);

const graphFor = (days) => ({
  meta: { version: "4.17.0" },
  contributions: days.map((date) => ({
    date,
    clients: [
      {
        client: "claude",
        modelId: "claude-opus-5",
        providerId: "anthropic",
        tokens: { input: 10, output: 20, cacheRead: 30, cacheWrite: 40, reasoning: 0 },
        cost: 1,
        messages: 2,
      },
    ],
  })),
});

const harness = ({ state = {}, token = TOKEN, graph = graphFor(["2026-09-24"]), putUsage, cursor = { loggedIn: false }, cursorSync } = {}) => {
  const h = {
    state: { ...defaultState(), deviceId: DEVICE_ID, ...state },
    token,
    saves: 0,
    uploads: [],
    sleeps: [],
    graphCalls: [],
    cursorSyncs: 0,
    apiOptions: [],
    registrations: [],
  };
  h.deps = {
    getConfig: () => ({ apiUrl: "http://api.test", configDir: "/cfg" }),
    loadState: ({ configDir }) => {
      assert.equal(configDir, "/cfg");
      return structuredClone(h.state);
    },
    saveState: (config, next) => {
      h.saves += 1;
      h.state = structuredClone(next);
    },
    keychain: {
      getToken: async () => h.token,
      setToken: async (value) => {
        h.token = value;
      },
      deleteToken: async () => {
        h.token = null;
      },
    },
    createApi: (options) => {
      h.apiOptions.push(options);
      return {
        getConfig: async () => ({ githubClientId: "cid", apiVersion: 1 }),
        registerDevice: async (body) => {
          h.registrations.push(body);
          return { token: TOKEN, deviceId: body.deviceId, user: { login: "octo", name: "Octo", avatarUrl: "https://a" } };
        },
        putUsage: async (body) => {
          h.uploads.push(body);
          return putUsage ? putUsage(body, h.uploads.length) : { upserted: body.rows.length };
        },
        getMe: async () => null,
      };
    },
    githubDeviceFlow: async ({ clientId, onCode }) => {
      assert.equal(clientId, "cid");
      await onCode({ userCode: "ABCD-1234", verificationUri: "https://github.com/login/device", expiresIn: 900 });
      return "gho_x";
    },
    computerName: async () => "Octo Mac",
    randomUUID: () => DEVICE_ID,
    cursorStatus: async () => {
      if (cursor instanceof Error) throw cursor;
      return cursor;
    },
    cursorSync: async () => {
      h.cursorSyncs += 1;
      if (cursorSync instanceof Error) throw cursorSync;
    },
    readGraph: async (options) => {
      h.graphCalls.push(options);
      return graph;
    },
    sleep: async (ms) => {
      h.sleeps.push(ms);
    },
  };
  return h;
};

const failing = (code, status) => () => {
  throw new LeaderborderError(code, `${code} ${status ?? ""}`, { status });
};

test("sync uploads rows, saves state and returns the summary", async () => {
  const h = harness({ state: { lastSyncAt: "2026-09-23T10:00:00.000Z" } });
  const result = await sync({ now, deps: h.deps });
  assert.equal(h.uploads.length, 1);
  assert.deepEqual(Object.keys(h.uploads[0]), ["deviceId", "tokscaleVersion", "rows"]);
  assert.equal(h.uploads[0].deviceId, DEVICE_ID);
  assert.equal(h.uploads[0].tokscaleVersion, "4.17.0");
  assert.equal(h.apiOptions[0].token, TOKEN);
  assert.equal(h.apiOptions[0].apiUrl, "http://api.test");
  assert.equal(result.rows.length, 1);
  assert.equal(result.since, "2026-08-20");
  assert.deepEqual(result.summary, { today: { tokens: 100, costUsd: 1 }, week: { tokens: 100, costUsd: 1 }, topModel: "claude-opus-5" });
  assert.equal(h.state.lastSyncAt, now.toISOString());
  assert.deepEqual(h.state.summary, result.summary);
  assert.equal(h.state.lastError, null);
});

test("sync reads full history on the first sync", async () => {
  const h = harness();
  const result = await sync({ now, deps: h.deps });
  assert.deepEqual(h.graphCalls, [{ since: null }]);
  assert.equal(result.since, null);
});

test("sync uploads in chunks of 500 rows", async () => {
  const days = Array.from({ length: 501 }, (_, i) => new Date(Date.UTC(2025, 0, 1 + i)).toISOString().slice(0, 10));
  const h = harness({ graph: graphFor(days) });
  await sync({ now, deps: h.deps });
  assert.deepEqual(h.uploads.map((u) => u.rows.length), [500, 1]);
});

test("sync skips the upload when there are no rows", async () => {
  const h = harness({ graph: graphFor([]) });
  const result = await sync({ now, deps: h.deps });
  assert.equal(h.uploads.length, 0);
  assert.deepEqual(result.rows, []);
  assert.equal(h.state.lastSyncAt, now.toISOString());
});

test("sync retries network and 5xx failures with 1 s, 4 s and 16 s backoff", async () => {
  const outcomes = [failing("network"), failing("upload_failed", 503), failing("upload_failed", 500)];
  const h = harness({ putUsage: (body, attempt) => (outcomes[attempt - 1] ?? (() => ({ upserted: 1 })))() });
  await sync({ now, deps: h.deps });
  assert.equal(h.uploads.length, 4);
  assert.deepEqual(h.sleeps, [1000, 4000, 16000]);
});

test("sync gives up after three retries and records lastError", async () => {
  const h = harness({ putUsage: failing("upload_failed", 502) });
  await assert.rejects(sync({ now, deps: h.deps }), (error) => error.code === "upload_failed");
  assert.equal(h.uploads.length, 4);
  assert.equal(h.state.lastError.code, "upload_failed");
  assert.equal(h.state.lastError.at, now.toISOString());
  assert.equal(h.state.lastSyncAt, null);
});

test("sync does not retry 4xx failures", async () => {
  const h = harness({ putUsage: failing("upload_failed", 400) });
  await assert.rejects(sync({ now, deps: h.deps }), (error) => error.status === 400);
  assert.equal(h.uploads.length, 1);
  assert.deepEqual(h.sleeps, []);
});

test("sync on 401 deletes the token and throws unauthorized", async () => {
  const h = harness({ putUsage: failing("unauthorized", 401) });
  await assert.rejects(sync({ now, deps: h.deps }), (error) => error.code === "unauthorized");
  assert.equal(h.token, null);
  assert.equal(h.uploads.length, 1);
  assert.equal(h.state.lastError.code, "unauthorized");
});

test("sync without a token throws not_logged_in and reads nothing", async () => {
  const h = harness({ token: null });
  await assert.rejects(sync({ now, deps: h.deps }), (error) => error.code === "not_logged_in");
  assert.equal(h.graphCalls.length, 0);
  assert.equal(h.state.lastError.code, "not_logged_in");
});

test("sync without a deviceId throws not_logged_in", async () => {
  const h = harness({ state: { deviceId: null } });
  await assert.rejects(sync({ now, deps: h.deps }), (error) => error.code === "not_logged_in");
});

test("sync runs cursor sync when cursor is logged in", async () => {
  const h = harness({ cursor: { loggedIn: true } });
  const result = await sync({ now, deps: h.deps });
  assert.equal(h.cursorSyncs, 1);
  assert.deepEqual(result.warnings, []);
});

test("sync skips cursor sync when cursor is logged out", async () => {
  const h = harness();
  await sync({ now, deps: h.deps });
  assert.equal(h.cursorSyncs, 0);
});

test("sync treats cursor failures as warnings", async () => {
  const h = harness({ cursor: { loggedIn: true }, cursorSync: new LeaderborderError("tokscale_failed", "cursor down") });
  const result = await sync({ now, deps: h.deps });
  assert.equal(h.uploads.length, 1);
  assert.equal(result.warnings.length, 1);
  assert.match(result.warnings[0], /cursor down/);
  const statusFailure = harness({ cursor: new Error("status broke") });
  assert.match((await sync({ now, deps: statusFailure.deps })).warnings[0], /status broke/);
});

test("sync reports progress phases", async () => {
  const phases = [];
  const h = harness();
  await sync({ now, deps: h.deps, onProgress: (event) => phases.push(event.phase) });
  assert.deepEqual(phases, ["cursor", "graph", "upload", "done"]);
});

test("sync records tokscale failures in lastError", async () => {
  const h = harness();
  h.deps.readGraph = async () => {
    throw new LeaderborderError("tokscale_failed", "binary missing");
  };
  await assert.rejects(sync({ now, deps: h.deps }), (error) => error.code === "tokscale_failed");
  assert.deepEqual(h.state.lastError, { code: "tokscale_failed", message: "binary missing", at: now.toISOString() });
});

test("dry run uploads nothing, needs no token and does not save state", async () => {
  const h = harness({ token: null, state: { deviceId: null } });
  const result = await sync({ now, dryRun: true, deps: h.deps });
  assert.equal(result.rows.length, 1);
  assert.equal(h.uploads.length, 0);
  assert.equal(h.saves, 0);
  assert.equal(h.apiOptions.length, 0);
});

test("login registers the device with a new uuid and stores the token", async () => {
  const codes = [];
  const h = harness({ token: null, state: { deviceId: null, lastSyncAt: "2026-09-01T00:00:00.000Z", lastError: { code: "x" } } });
  const result = await login({ onCode: (code) => codes.push(code.userCode), deps: h.deps });
  assert.deepEqual(result, { user: { login: "octo", name: "Octo", avatarUrl: "https://a" } });
  assert.deepEqual(codes, ["ABCD-1234"]);
  assert.deepEqual(h.registrations, [{ githubToken: "gho_x", deviceId: DEVICE_ID, deviceName: "Octo Mac" }]);
  assert.equal(h.token, TOKEN);
  assert.equal(h.state.deviceId, DEVICE_ID);
  assert.equal(h.state.deviceName, "Octo Mac");
  assert.equal(h.state.lastSyncAt, null);
  assert.equal(h.state.lastError, null);
});

test("login reuses the persisted deviceId", async () => {
  const h = harness({ state: { deviceId: "11111111-2222-4333-8444-555555555555" } });
  h.deps.randomUUID = () => assert.fail("must not create a new id");
  await login({ onCode: () => {}, deps: h.deps });
  assert.equal(h.registrations[0].deviceId, "11111111-2222-4333-8444-555555555555");
});

test("login fails without a GitHub client id", async () => {
  const h = harness();
  const base = h.deps.createApi;
  h.deps.createApi = (options) => ({ ...base(options), getConfig: async () => ({ apiVersion: 1 }) });
  await assert.rejects(login({ onCode: () => {}, deps: h.deps }), (error) => error.code === "upload_failed");
});

test("login does not store a token when registration is forbidden", async () => {
  const h = harness({ token: null });
  const base = h.deps.createApi;
  h.deps.createApi = (options) => ({ ...base(options), registerDevice: failing("forbidden", 403) });
  await assert.rejects(login({ onCode: () => {}, deps: h.deps }), (error) => error.code === "forbidden");
  assert.equal(h.token, null);
});

test("logout deletes the token and clears the device", async () => {
  const h = harness({ state: { lastSyncAt: "2026-09-23T10:00:00.000Z", summary: { topModel: "x" } } });
  await logout({ deps: h.deps });
  assert.equal(h.token, null);
  assert.equal(h.state.deviceId, null);
  assert.equal(h.state.lastSyncAt, null);
  assert.equal(h.state.summary, null);
});
