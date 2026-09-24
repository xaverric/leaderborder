import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { addDays, localDay } from "../src/periods.js";
import { bearer, call, githubUser, mockGithub, registerDevice, resetDb, row, sessionCookie, uploadRows, userIdOf } from "./helpers.js";

let today;
let cookie;

const usage = (day, overrides = {}) =>
  row({ day, input: 0, output: 0, cacheRead: 0, cacheWrite: 0, reasoning: 0, costUsd: 0, messages: 1, ...overrides });

beforeAll(() => {
  today = localDay(new Date(), "Europe/Prague");
});

beforeEach(async () => {
  await resetDb();
  mockGithub({ users: { gho_ada: githubUser(1, "ada"), gho_linus: githubUser(2, "linus"), gho_grace: githubUser(3, "grace") } });
  const adaMac = await registerDevice({ token: "gho_ada", deviceName: "Ada Mac" });
  const adaMini = await registerDevice({ token: "gho_ada", deviceName: "Ada Mini" });
  const linus = await registerDevice({ token: "gho_linus" });
  await registerDevice({ token: "gho_grace" });
  await uploadRows(adaMac.data.token, adaMac.deviceId, [
    usage(today, { input: 100, output: 50, cacheRead: 1000, costUsd: 1 }),
    usage(addDays(today, -40), { input: 5000, output: 5000, costUsd: 50 }),
  ]);
  await uploadRows(adaMini.data.token, adaMini.deviceId, [
    usage(addDays(today, -1), { client: "codex", model: "gpt-5", input: 200, output: 100, costUsd: 2 }),
  ]);
  await uploadRows(linus.data.token, linus.deviceId, [
    usage(addDays(today, -2), { input: 1000, output: 1000, cacheRead: 0, costUsd: 0.5 }),
  ]);
  cookie = await sessionCookie(await userIdOf("ada"));
});

afterEach(() => vi.restoreAllMocks());

const board = async (query = "") => {
  const response = await call("GET", `/api/leaderboard${query}`, { headers: { cookie } });
  expect(response.status).toBe(200);
  return response.json();
};

describe("GET /api/leaderboard", () => {
  it("defaults to week and tokens and sums devices of one user", async () => {
    const data = await board();
    expect(data.period).toBe("week");
    expect(data.metric).toBe("tokens");
    expect(data.range).toEqual({ start: addDays(today, -6), end: today });
    expect(data.entries.map((e) => [e.rank, e.login, e.value])).toEqual([
      [1, "linus", 2000],
      [2, "ada", 1450],
    ]);
    expect(data.entries[1]).toMatchObject({
      name: "Ada",
      avatarUrl: "https://avatars.githubusercontent.com/u/1",
      tokens: 1450,
      tokensNoCache: 450,
      costUsd: 3,
      byClient: { claude: 1150, codex: 300 },
    });
    expect(data.filters).toEqual({ clients: ["claude", "codex"], models: ["claude-opus-5", "gpt-5"] });
  });

  it("returns a dense 30 day sparkline ending at range end", async () => {
    const { entries } = await board();
    const ada = entries.find((e) => e.login === "ada");
    expect(ada.sparkline).toHaveLength(30);
    expect(ada.sparkline[0].day).toBe(addDays(today, -29));
    expect(ada.sparkline.at(-1)).toEqual({ day: today, value: 1150 });
    expect(ada.sparkline.at(-2)).toEqual({ day: addDays(today, -1), value: 300 });
    expect(ada.sparkline.at(-3)).toEqual({ day: addDays(today, -2), value: 0 });
  });

  it("ranks by tokens without cache", async () => {
    const { entries } = await board("?metric=tokens_nocache");
    expect(entries.map((e) => [e.login, e.value])).toEqual([
      ["linus", 2000],
      ["ada", 450],
    ]);
  });

  it("ranks by cost", async () => {
    const { entries } = await board("?metric=cost");
    expect(entries.map((e) => [e.login, e.value])).toEqual([
      ["ada", 3],
      ["linus", 0.5],
    ]);
    expect(entries[0].byClient).toEqual({ claude: 1, codex: 2 });
  });

  it("filters by client", async () => {
    const { entries } = await board("?client=codex");
    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({ login: "ada", value: 300, byClient: { codex: 300 } });
  });

  it("filters by model", async () => {
    const { entries } = await board("?model=claude-opus-5");
    expect(entries.map((e) => [e.login, e.value])).toEqual([
      ["linus", 2000],
      ["ada", 1150],
    ]);
  });

  it("supports day, month and all periods", async () => {
    expect((await board("?period=day")).entries.map((e) => e.login)).toEqual(["ada"]);
    const all = await board("?period=all");
    expect(all.range).toEqual({ start: addDays(today, -40), end: today });
    expect(all.entries[0]).toMatchObject({ login: "ada", value: 11450 });
    const month = await board("?period=month");
    expect(month.range).toEqual({ start: `${today.slice(0, 7)}-01`, end: today });
  });

  it("shares ranks on ties", async () => {
    const { entries } = await board("?period=all&metric=tokens_nocache&client=nope");
    expect(entries).toEqual([]);
    const linusMac = await registerDevice({ token: "gho_grace" });
    await uploadRows(linusMac.data.token, linusMac.deviceId, [usage(addDays(today, -2), { input: 1000, output: 1000 })]);
    const tied = await board("?metric=tokens_nocache");
    expect(tied.entries.map((e) => [e.rank, e.login])).toEqual([
      [1, "grace"],
      [1, "linus"],
      [3, "ada"],
    ]);
  });

  it.each([["?period=year"], ["?metric=messages"], [`?client=${"x".repeat(200)}`]])("rejects %s", async (query) => {
    const response = await call("GET", `/api/leaderboard${query}`, { headers: { cookie } });
    expect(response.status).toBe(400);
  });

  it("requires a session cookie", async () => {
    const device = await registerDevice({ token: "gho_ada" });
    expect((await call("GET", "/api/leaderboard")).status).toBe(401);
    expect((await call("GET", "/api/leaderboard", { headers: bearer(device.data.token) })).status).toBe(401);
  });
});

describe("GET /api/users/:login", () => {
  it("returns the user detail", async () => {
    const response = await call("GET", "/api/users/ADA", { headers: { cookie } });
    expect(response.status).toBe(200);
    const data = await response.json();
    expect(data.user).toEqual({ login: "ada", name: "Ada", avatarUrl: "https://avatars.githubusercontent.com/u/1" });
    expect(data.totals).toEqual({ tokens: 11450, tokensNoCache: 10450, costUsd: 53, messages: 3, activeDays: 3 });
    expect(data.daily).toHaveLength(365);
    expect(data.daily.at(-1)).toEqual({ day: today, tokens: 1150, tokensNoCache: 150, costUsd: 1 });
    expect(data.daily[0].day).toBe(addDays(today, -364));
    expect(data.byClientModel).toEqual([
      { client: "claude", model: "claude-opus-5", tokens: 11150, tokensNoCache: 10150, costUsd: 51 },
      { client: "codex", model: "gpt-5", tokens: 300, tokensNoCache: 300, costUsd: 2 },
    ]);
    expect(data.devices).toEqual([
      { name: "Ada Mac", lastSyncAt: expect.any(String) },
      { name: "Ada Mini", lastSyncAt: expect.any(String) },
    ]);
  });

  it("returns 404 for unknown users", async () => {
    const response = await call("GET", "/api/users/nobody", { headers: { cookie } });
    expect(response.status).toBe(404);
    expect((await response.json()).error.code).toBe("not_found");
  });

  it("requires a session cookie", async () => {
    expect((await call("GET", "/api/users/ada")).status).toBe(401);
  });
});
