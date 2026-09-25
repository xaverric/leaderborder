import { env } from "cloudflare:workers";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { addDays, localDay } from "../src/periods.js";
import { bearer, call, githubUser, mockGithub, registerDevice, resetDb, row, sessionCookie, userIdOf } from "./helpers.js";

let today;
let cookie;
let devices;

const usage = (day, overrides = {}) => row({ day, input: 0, output: 0, cacheRead: 0, cacheWrite: 0, reasoning: 0, costUsd: 0, messages: 1, ...overrides });

const hours = (buckets = {}) => Array.from({ length: 24 }, (_, hour) => buckets[hour] ?? [0, 0, 0]);

const day = (date, overrides = {}) => ({ day: date, activeMs: 0, longestMs: 0, sessions: 1, maxConcurrent: 1, clients: [], ...overrides });

const put = (device, rows, activity) =>
  call("PUT", "/api/usage", { body: { deviceId: device.deviceId, tokscaleVersion: "4.17.0", rows, ...(activity ? { activity } : {}) }, headers: bearer(device.data.token) });

const upload = async (device, rows, activity) => {
  const response = await put(device, rows, activity);
  if (response.status !== 200) throw new Error(`upload failed ${response.status} ${await response.text()}`);
};

const all = async (sql) => (await env.DB.prepare(sql).all()).results;

beforeAll(() => {
  today = localDay(new Date(), "Europe/Prague");
});

beforeEach(async () => {
  await resetDb();
  mockGithub({ users: { gho_ada: githubUser(1, "ada"), gho_linus: githubUser(2, "linus"), gho_grace: githubUser(3, "grace") } });
  devices = {
    adaMac: await registerDevice({ token: "gho_ada", deviceName: "Ada Mac" }),
    adaMini: await registerDevice({ token: "gho_ada", deviceName: "Ada Mini" }),
    linus: await registerDevice({ token: "gho_linus" }),
    grace: await registerDevice({ token: "gho_grace" }),
  };
  cookie = await sessionCookie(await userIdOf("ada"));
});

afterEach(() => vi.restoreAllMocks());

describe("PUT /api/usage with activity", () => {
  it("stores model time on rows and daily activity per device and tool", async () => {
    await upload(devices.adaMac, [usage(today, { genMs: 5000, genSamples: 2 }), usage(today, { client: "cursor", model: "auto" })], [
      day(today, { activeMs: 60000, longestMs: 50000, sessions: 2, maxConcurrent: 2, clients: [{ client: "claude", prompts: 3, hours: hours({ 9: [100, 4, 3] }) }] }),
    ]);
    expect(await all("SELECT client, gen_ms, gen_samples FROM usage_daily ORDER BY client")).toEqual([
      { client: "claude", gen_ms: 5000, gen_samples: 2 },
      { client: "cursor", gen_ms: null, gen_samples: null },
    ]);
    expect(await all("SELECT device_id, day, active_ms, longest_ms, sessions, max_concurrent FROM activity_daily")).toEqual([
      { device_id: devices.adaMac.deviceId, day: today, active_ms: 60000, longest_ms: 50000, sessions: 2, max_concurrent: 2 },
    ]);
    const [client] = await all("SELECT day, client, prompts, hours FROM client_activity_daily");
    expect({ ...client, hours: JSON.parse(client.hours) }).toEqual({ day: today, client: "claude", prompts: 3, hours: hours({ 9: [100, 4, 3] }) });
  });

  it("keeps measured model time when a later upload does not carry it", async () => {
    await upload(devices.adaMac, [usage(today, { genMs: 5000, genSamples: 2 })]);
    await upload(devices.adaMac, [usage(today, { input: 9 })]);
    expect(await all("SELECT input, gen_ms, gen_samples FROM usage_daily")).toEqual([{ input: 9, gen_ms: 5000, gen_samples: 2 }]);
    await upload(devices.adaMac, [usage(today, { genMs: 0, genSamples: 0 })]);
    expect(await all("SELECT gen_ms, gen_samples FROM usage_daily")).toEqual([{ gen_ms: 0, gen_samples: 0 }]);
  });

  it("overwrites the activity of a day on the next upload", async () => {
    await upload(devices.adaMac, [usage(today)], [day(today, { activeMs: 1000, clients: [{ client: "claude", prompts: 1, hours: hours() }] })]);
    await upload(devices.adaMac, [usage(today)], [day(today, { activeMs: 4000, clients: [{ client: "claude", prompts: 2, hours: hours({ 1: [1, 1, 2] }) }] })]);
    expect(await all("SELECT active_ms FROM activity_daily")).toEqual([{ active_ms: 4000 }]);
    expect(await all("SELECT prompts FROM client_activity_daily")).toEqual([{ prompts: 2 }]);
  });

  it("rejects invalid activity and writes nothing", async () => {
    const response = await put(devices.adaMac, [usage(today)], [day(today, { clients: [{ client: "claude", prompts: 1, hours: hours().slice(1) }] })]);
    expect(response.status).toBe(400);
    expect((await response.json()).error.message).toBe("activity[0].clients[0].hours: must be 24 arrays of 3 non-negative safe integers");
    expect(await all("SELECT * FROM usage_daily")).toEqual([]);
    expect(await all("SELECT * FROM activity_daily")).toEqual([]);
  });

  it("deletes activity together with the account", async () => {
    await upload(devices.adaMac, [usage(today)], [day(today, { clients: [{ client: "claude", prompts: 1, hours: hours() }] })]);
    expect((await call("DELETE", "/api/me", { headers: { cookie } })).status).toBe(204);
    expect(await all("SELECT * FROM activity_daily")).toEqual([]);
    expect(await all("SELECT * FROM client_activity_daily")).toEqual([]);
  });
});

describe("activity in the user detail and the leaderboard", () => {
  beforeEach(async () => {
    const yesterday = addDays(today, -1);
    await upload(devices.adaMac, [usage(today, { input: 100, genMs: 5000, genSamples: 2 }), usage(today, { client: "cursor", model: "auto", input: 40 })], [
      day(today, { activeMs: 60000, longestMs: 50000, sessions: 2, maxConcurrent: 2, clients: [{ client: "claude", prompts: 3, hours: hours({ 9: [100, 4, 3] }) }] }),
    ]);
    await upload(devices.adaMini, [usage(today, { input: 10, genMs: 0, genSamples: 0 }), usage(today, { client: "codex", model: "gpt-5", input: 30, genMs: 2000, genSamples: 1 })], [
      day(today, {
        activeMs: 30000,
        longestMs: 30000,
        clients: [
          { client: "claude", prompts: 2, hours: hours({ 9: [10, 1, 2] }) },
          { client: "codex", prompts: 1, hours: hours({ 9: [20, 1, 1], 10: [10, 1, 0] }) },
        ],
      }),
    ]);
    await upload(devices.linus, [usage(yesterday, { input: 1000, genMs: 9000, genSamples: 3 })], [
      day(yesterday, { activeMs: 20000, longestMs: 20000, clients: [{ client: "claude", prompts: 5, hours: hours({ 20: [1000, 3, 5] }) }] }),
    ]);
    await upload(devices.grace, [usage(today, { input: 7 })]);
  });

  const board = async (query) => {
    const response = await call("GET", `/api/leaderboard${query}`, { headers: { cookie } });
    expect(response.status).toBe(200);
    return response.json();
  };

  it("returns usage by day, tool and model with model time only where measured", async () => {
    const data = await (await call("GET", "/api/users/ada", { headers: { cookie } })).json();
    expect(data.usage).toEqual([
      { day: today, client: "claude", model: "claude-opus-5", tokens: 110, tokensNoCache: 110, costUsd: 0, messages: 2, genMs: 5000 },
      { day: today, client: "codex", model: "gpt-5", tokens: 30, tokensNoCache: 30, costUsd: 0, messages: 1, genMs: 2000 },
      { day: today, client: "cursor", model: "auto", tokens: 40, tokensNoCache: 40, costUsd: 0, messages: 1, genMs: null },
    ]);
  });

  it("merges activity of all devices per day and tool", async () => {
    const { activity } = await (await call("GET", "/api/users/ada", { headers: { cookie } })).json();
    expect(activity.days).toEqual([{ day: today, activeMs: 90000, longestMs: 50000, sessions: 3, maxConcurrent: 2 }]);
    expect(activity.clients).toEqual([
      { day: today, client: "claude", prompts: 5, hours: hours({ 9: [110, 5, 5] }) },
      { day: today, client: "codex", prompts: 1, hours: hours({ 9: [20, 1, 1], 10: [10, 1, 0] }) },
    ]);
  });

  it("returns empty activity for users on an old client", async () => {
    const data = await (await call("GET", "/api/users/grace", { headers: { cookie } })).json();
    expect(data.activity).toEqual({ days: [], clients: [] });
    expect(data.usage[0].genMs).toBeNull();
  });

  it("ranks model time only for players with measured tools", async () => {
    const { entries } = await board("?metric=model_time");
    expect(entries.map((e) => [e.rank, e.login, e.value])).toEqual([
      [1, "linus", 9000],
      [2, "ada", 7000],
    ]);
    expect(entries[1].byClient).toEqual({ claude: 5000, codex: 2000 });
    expect(entries[1].sparkline.at(-1)).toEqual({ day: today, value: 7000 });
    expect((await board("?metric=model_time&model=gpt-5")).entries.map((e) => [e.login, e.value])).toEqual([["ada", 2000]]);
  });

  it("ranks prompts by tool and ignores the model filter", async () => {
    const { entries } = await board("?metric=prompts");
    expect(entries.map((e) => [e.rank, e.login, e.value])).toEqual([
      [1, "ada", 6],
      [2, "linus", 5],
    ]);
    expect(entries[0]).toMatchObject({ tokens: 180, byClient: { claude: 5, codex: 1 } });
    expect(entries[0].sparkline.at(-1)).toEqual({ day: today, value: 6 });
    expect((await board("?metric=prompts&client=codex")).entries.map((e) => [e.login, e.value, e.tokens])).toEqual([["ada", 1, 30]]);
    expect((await board("?metric=prompts&model=gpt-5")).entries.map((e) => [e.login, e.value])).toEqual([
      ["ada", 6],
      ["linus", 5],
    ]);
  });
});
