import { env } from "cloudflare:workers";
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
  const grace = await registerDevice({ token: "gho_grace" });
  await caches.default.delete(new Request("https://leaderborder.test/api/public/stats"));
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
  await uploadRows(grace.data.token, grace.deviceId, [
    row({ day: today, client: "codex", model: "gpt-5", input: 5, output: 0, cacheRead: 0, cacheWrite: 0, costUsd: 0.25 }),
    row({ day: today, client: "claude", model: "m1", input: 5, output: 0, cacheRead: 0, cacheWrite: 0, costUsd: 0.25 }),
  ]);
});

const clearCache = () => caches.default.delete(new Request("https://leaderborder.test/api/public/stats"));

afterEach(() => vi.restoreAllMocks());

describe("GET /api/public/stats", () => {
  it("returns anonymous aggregates with public caching", async () => {
    const response = await call("GET", "/api/public/stats");
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("public, max-age=60");
    const data = await response.json();
    expect(Object.keys(data).sort()).toEqual(
      ["activeThisWeek", "costThisWeekUsd", "daily", "minGroup", "players", "suppressed", "tokensAllTime", "tokensThisWeek", "topClients", "topModels", "updatedAt"].sort(),
    );
    expect(data).toMatchObject({ tokensAllTime: 1230, tokensThisWeek: 1220, costThisWeekUsd: 3, players: 3, activeThisWeek: 3, suppressed: false, minGroup: 3 });
    expect(data.topModels).toEqual([
      { model: "gpt-5", tokens: 1010 },
      { model: "m1", tokens: 15 },
    ]);
    expect(data.topClients).toEqual([
      { client: "codex", tokens: 1010 },
      { client: "claude", tokens: 215 },
    ]);
    expect(data.daily).toHaveLength(90);
    expect(data.daily.at(-1)).toEqual({ day: today, tokens: 220 });
    expect(data.daily[0]).toEqual({ day: addDays(today, -89), tokens: 0 });
    expect(data.daily.find((d) => d.day === addDays(today, -30)).tokens).toBe(7);
    expect(new Date(data.updatedAt).toString()).not.toBe("Invalid Date");
    expect(JSON.stringify(data)).not.toMatch(/ada|linus|grace/);
  });

  it("returns zeros for an empty database", async () => {
    await resetDb();
    await clearCache();
    const data = await (await call("GET", "/api/public/stats")).json();
    expect(data).toMatchObject({ tokensAllTime: 0, tokensThisWeek: 0, costThisWeekUsd: 0, players: 0, activeThisWeek: 0, topModels: [], topClients: [], suppressed: true });
    expect(data.daily.every((d) => d.tokens === 0)).toBe(true);
  });

  it("suppresses weekly detail while fewer than 3 players are active", async () => {
    await env.DB.prepare("DELETE FROM usage_daily WHERE device_id IN (SELECT id FROM devices WHERE user_id = (SELECT id FROM users WHERE login = 'grace'))").run();
    await clearCache();
    const data = await (await call("GET", "/api/public/stats")).json();
    expect(data).toMatchObject({ players: 3, activeThisWeek: 2, suppressed: true, tokensThisWeek: 0, costThisWeekUsd: 0, topModels: [], topClients: [] });
    expect(data.tokensAllTime).toBe(1220);
    expect(data.daily.every((d) => d.tokens === 0)).toBe(true);
  });

  it("serves the cached response for a minute", async () => {
    await clearCache();
    const first = await (await call("GET", "/api/public/stats")).json();
    await resetDb();
    const second = await (await call("GET", "/api/public/stats")).json();
    expect(second.updatedAt).toBe(first.updatedAt);
  });
});
