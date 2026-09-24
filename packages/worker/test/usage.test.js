import { env } from "cloudflare:workers";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { bearer, call, githubUser, mockGithub, registerDevice, resetDb, row, uuid } from "./helpers.js";

let device;

beforeEach(async () => {
  await resetDb();
  mockGithub({ users: { gho_ada: githubUser(1, "ada") } });
  device = await registerDevice();
});

afterEach(() => vi.restoreAllMocks());

const put = (body, { token = device.data.token, envOverrides } = {}) =>
  call("PUT", "/api/usage", { body, headers: bearer(token), env: envOverrides });

const payload = (rows = [row(), row({ model: "claude-sonnet-5", input: 1 })]) => ({ deviceId: device.deviceId, tokscaleVersion: "4.17.0", rows });

const stored = async () =>
  (await env.DB.prepare("SELECT day, client, model, input, output, cache_read, cache_write, reasoning, cost_usd, messages FROM usage_daily ORDER BY model").all()).results;

describe("PUT /api/usage", () => {
  it("upserts rows and reports the count", async () => {
    const response = await put(payload());
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ upserted: 2 });
    expect(await stored()).toEqual([
      { day: "2026-09-20", client: "claude", model: "claude-opus-5", input: 100, output: 200, cache_read: 300, cache_write: 400, reasoning: 50, cost_usd: 1.5, messages: 7 },
      { day: "2026-09-20", client: "claude", model: "claude-sonnet-5", input: 1, output: 200, cache_read: 300, cache_write: 400, reasoning: 50, cost_usd: 1.5, messages: 7 },
    ]);
  });

  it("is idempotent and overwrites changed values", async () => {
    await put(payload());
    await put(payload());
    expect(await stored()).toHaveLength(2);
    await put(payload([row({ input: 999, costUsd: 3 })]));
    const rows = await stored();
    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({ input: 999, cost_usd: 3 });
  });

  it("updates device and token timestamps", async () => {
    await put(payload());
    const deviceRow = await env.DB.prepare("SELECT last_sync_at FROM devices WHERE id = ?1").bind(device.deviceId).first();
    const tokenRow = await env.DB.prepare("SELECT last_used_at FROM api_tokens WHERE revoked_at IS NULL").first();
    expect(deviceRow.last_sync_at).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    expect(tokenRow.last_used_at).toBe(deviceRow.last_sync_at);
  });

  it("rejects the whole request when one row is invalid", async () => {
    const response = await put(payload([row(), row({ client: "Bad Client" })]));
    expect(response.status).toBe(400);
    expect((await response.json()).error).toEqual({ code: "invalid_request", message: "rows[1].client: invalid" });
    expect(await stored()).toEqual([]);
  });

  it.each([
    ["missing", {}],
    ["malformed", { authorization: "Bearer nope" }],
    ["unknown", { authorization: `Bearer lb_${"a".repeat(43)}` }],
    ["wrong scheme", { authorization: "Basic abc" }],
  ])("rejects a %s bearer token with 401", async (_, headers) => {
    const response = await call("PUT", "/api/usage", { body: payload(), headers });
    expect(response.status).toBe(401);
    expect((await response.json()).error.code).toBe("unauthorized");
  });

  it("rejects a revoked token after re-registration", async () => {
    const oldToken = device.data.token;
    await registerDevice({ deviceId: device.deviceId });
    expect((await put(payload(), { token: oldToken })).status).toBe(401);
  });

  it("rejects a deviceId that does not match the token", async () => {
    const response = await put({ ...payload(), deviceId: uuid() });
    expect(response.status).toBe(403);
    expect((await response.json()).error.code).toBe("forbidden");
  });

  it("returns 429 when the rate limiter refuses", async () => {
    const limit = vi.fn(async () => ({ success: false }));
    const response = await put(payload(), { envOverrides: { USAGE_LIMITER: { limit } } });
    expect(response.status).toBe(429);
    expect((await response.json()).error.code).toBe("rate_limited");
    expect(limit).toHaveBeenCalledWith({ key: device.deviceId });
    expect(await stored()).toEqual([]);
  });

  it("proceeds when the rate limiter allows", async () => {
    const response = await put(payload(), { envOverrides: { USAGE_LIMITER: { limit: async () => ({ success: true }) } } });
    expect(response.status).toBe(200);
  });
});
