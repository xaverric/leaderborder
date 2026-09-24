import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { addDays, localDay } from "../src/periods.js";
import { call, githubUser, mockGithub, registerDevice, resetDb, row, uploadRows } from "./helpers.js";

let today;

beforeEach(async () => {
  await resetDb();
  today = localDay(new Date(), "Europe/Prague");
  mockGithub({ users: { gho_ada: githubUser(1, "ada"), gho_linus: githubUser(2, "linus"), gho_grace: githubUser(3, "grace") } });
  const ada = await registerDevice({ token: "gho_ada" });
  const linus = await registerDevice({ token: "gho_linus" });
  await registerDevice({ token: "gho_grace" });
  const models = ["m1", "m2", "m3", "m4", "m5", "m6"];
  await uploadRows(
    ada.data.token,
    ada.deviceId,
    models.map((model, i) => row({ day: today, model, input: (i + 1) * 10, output: 0, cacheRead: 0, cacheWrite: 0, costUsd: 0.25 })),
  );
  await uploadRows(linus.data.token, linus.deviceId, [
    row({ day: addDays(today, -1), client: "codex", model: "gpt-5", input: 1000, output: 0, cacheRead: 0, cacheWrite: 0, costUsd: 1 }),
    row({ day: addDays(today, -30), client: "cursor", model: "old", input: 7, output: 0, cacheRead: 0, cacheWrite: 0, costUsd: 9 }),
  ]);
});

afterEach(() => vi.restoreAllMocks());

describe("GET /api/public/stats", () => {
  it("returns anonymous aggregates with public caching", async () => {
    const response = await call("GET", "/api/public/stats");
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("public, max-age=60");
    const data = await response.json();
    expect(Object.keys(data).sort()).toEqual(
      ["activeThisWeek", "costThisWeekUsd", "daily", "players", "tokensAllTime", "tokensThisWeek", "topClients", "topModels", "updatedAt"].sort(),
    );
    expect(data).toMatchObject({ tokensAllTime: 1217, tokensThisWeek: 1210, costThisWeekUsd: 2.5, players: 3, activeThisWeek: 2 });
    expect(data.topModels).toEqual([
      { model: "gpt-5", tokens: 1000 },
      { model: "m6", tokens: 60 },
      { model: "m5", tokens: 50 },
      { model: "m4", tokens: 40 },
      { model: "m3", tokens: 30 },
    ]);
    expect(data.topClients).toEqual([
      { client: "codex", tokens: 1000 },
      { client: "claude", tokens: 210 },
    ]);
    expect(data.daily).toHaveLength(90);
    expect(data.daily.at(-1)).toEqual({ day: today, tokens: 210 });
    expect(data.daily[0]).toEqual({ day: addDays(today, -89), tokens: 0 });
    expect(data.daily.find((d) => d.day === addDays(today, -30)).tokens).toBe(7);
    expect(new Date(data.updatedAt).toString()).not.toBe("Invalid Date");
    expect(JSON.stringify(data)).not.toMatch(/ada|linus|grace/);
  });

  it("returns zeros for an empty database", async () => {
    await resetDb();
    const data = await (await call("GET", "/api/public/stats")).json();
    expect(data).toMatchObject({ tokensAllTime: 0, tokensThisWeek: 0, costThisWeekUsd: 0, players: 0, activeThisWeek: 0, topModels: [], topClients: [] });
    expect(data.daily.every((d) => d.tokens === 0)).toBe(true);
  });
});
