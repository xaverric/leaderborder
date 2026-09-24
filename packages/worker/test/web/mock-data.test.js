import { describe, expect, it } from "vitest";
import { createMockApi, MOCK_LOGIN } from "../../public/js/mock-data.js";

const now = new Date("2026-09-24T10:00:00Z");
const keys = (object) => Object.keys(object).sort();

describe("mock api matches Contract 3", () => {
  const api = createMockApi({ now });

  it("serves /api/public/stats", () => {
    const { status, body } = api.handle("GET", "/api/public/stats");
    expect(status).toBe(200);
    expect(keys(body)).toEqual(
      ["activeThisWeek", "costThisWeekUsd", "daily", "players", "tokensAllTime", "tokensThisWeek", "topClients", "topModels", "updatedAt"].sort(),
    );
    expect(body.players).toBe(6);
    expect(body.tokensThisWeek).toBeGreaterThan(0);
    expect(body.tokensAllTime).toBeGreaterThan(body.tokensThisWeek);
    expect(body.daily.length).toBeLessThanOrEqual(90);
    expect(body.daily.length).toBeGreaterThan(60);
    expect(keys(body.daily[0])).toEqual(["day", "tokens"]);
    expect(body.topModels.length).toBeLessThanOrEqual(5);
    expect(keys(body.topModels[0])).toEqual(["model", "tokens"]);
    expect(keys(body.topClients[0])).toEqual(["client", "tokens"]);
  });

  it("serves /api/me with rank and devices", () => {
    const { status, body } = api.handle("GET", "/api/me");
    expect(status).toBe(200);
    expect(keys(body)).toEqual(["devices", "rank", "user"]);
    expect(keys(body.user)).toEqual(["avatarUrl", "login", "name"]);
    expect(body.user.login).toBe(MOCK_LOGIN);
    expect(keys(body.rank)).toEqual(["metric", "of", "period", "position", "value"]);
    expect(keys(body.devices[0])).toEqual(["createdAt", "id", "lastSyncAt", "name"]);
  });

  it("serves a ranked leaderboard", () => {
    const { body } = api.handle("GET", "/api/leaderboard?period=month&metric=cost");
    expect(keys(body)).toEqual(["entries", "filters", "metric", "period", "range"]);
    expect(body.period).toBe("month");
    expect(body.range).toEqual({ start: "2026-09-01", end: "2026-09-24" });
    const entry = body.entries[0];
    expect(keys(entry)).toEqual(["avatarUrl", "byClient", "costUsd", "login", "name", "rank", "sparkline", "tokens", "tokensNoCache", "value"].sort());
    expect(entry.value).toBe(entry.costUsd);
    expect(entry.sparkline).toHaveLength(30);
    expect(entry.sparkline.at(-1).day).toBe("2026-09-24");
    body.entries.forEach((e, i) => {
      expect(e.rank).toBe(i + 1);
      if (i) expect(body.entries[i - 1].value).toBeGreaterThanOrEqual(e.value);
    });
    expect(body.filters.clients).toEqual(["claude", "codex", "cursor", "gemini"]);
    expect(body.filters.models.length).toBeGreaterThan(4);
  });

  it("filters the leaderboard by client", () => {
    const { body } = api.handle("GET", "/api/leaderboard?period=all&client=gemini");
    expect(body.entries.every((e) => keys(e.byClient).join() === "gemini")).toBe(true);
  });

  it("serves user detail", () => {
    const { body } = api.handle("GET", "/api/users/grace");
    expect(keys(body)).toEqual(["byClientModel", "daily", "devices", "totals", "user"]);
    expect(keys(body.totals)).toEqual(["activeDays", "costUsd", "messages", "tokens", "tokensNoCache"]);
    expect(body.daily.length).toBeLessThanOrEqual(365);
    expect(keys(body.daily[0])).toEqual(["costUsd", "day", "tokens", "tokensNoCache"]);
    expect(keys(body.byClientModel[0])).toEqual(["client", "costUsd", "model", "tokens", "tokensNoCache"]);
    expect(keys(body.devices[0])).toEqual(["lastSyncAt", "name"]);
  });

  it("returns error envelopes", () => {
    expect(api.handle("GET", "/api/users/nobody")).toEqual({
      status: 404,
      body: { error: { code: "not_found", message: "No player called nobody." } },
    });
  });

  it("revokes devices and signs out", () => {
    const local = createMockApi({ now });
    const [device] = local.handle("GET", "/api/me").body.devices;
    expect(local.handle("DELETE", `/api/me/devices/${device.id}`).status).toBe(204);
    expect(local.handle("GET", "/api/me").body.devices.some((d) => d.id === device.id)).toBe(false);
    expect(local.handle("POST", "/auth/logout").status).toBe(204);
    expect(local.handle("GET", "/api/me").status).toBe(401);
  });

  it("is deterministic", () => {
    const a = createMockApi({ now }).handle("GET", "/api/public/stats").body.tokensAllTime;
    const b = createMockApi({ now }).handle("GET", "/api/public/stats").body.tokensAllTime;
    expect(a).toBe(b);
  });
});
