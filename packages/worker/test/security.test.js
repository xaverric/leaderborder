import { createExecutionContext } from "cloudflare:test";
import { env } from "cloudflare:workers";
import worker from "../src/index.js";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { readJsonBody, MAX_BODY_BYTES } from "../src/http.js";
import { registerDevice as registerInDb, revokeDevice, upsertUsage } from "../src/queries.js";
import { hashToken } from "../src/tokens.js";
import { MAX_DEVICES_PER_USER } from "../src/routes/devices.js";
import { MAX_PAIRS_PER_DEVICE } from "../src/routes/usage.js";
import { signValue } from "../src/session.js";
import { ORIGIN, TEST_SECRET, bearer, call, githubUser, makeEnv, mockGithub, registerDevice, resetDb, row, sessionCookie, userIdOf } from "./helpers.js";

beforeEach(async () => {
  await resetDb();
  mockGithub({ users: { gho_ada: githubUser(1, "ada"), gho_linus: githubUser(2, "linus") }, foreign: { gho_other_app: githubUser(1, "ada") } });
});

afterEach(() => vi.restoreAllMocks());

describe("security boundaries", () => {
  it("enforces ownership inside the registration transaction even after a stale precheck", async () => {
    const ada = await registerDevice();
    await registerDevice({ token: "gho_linus" });
    const tokenHash = await hashToken(`lb_${"x".repeat(43)}`);
    await registerInDb(env.DB, {
      deviceId: ada.deviceId, userId: await userIdOf("linus"), name: "Stolen",
      tokenHash, nowIso: new Date().toISOString(), accessPolicy: "",
    });
    expect(await env.DB.prepare("SELECT id FROM api_tokens WHERE token_hash = ?").bind(tokenHash).first()).toBeNull();
    expect((await call("GET", "/api/me", { headers: bearer(ada.data.token) })).status).toBe(200);
  });

  it("stops reading oversized streamed bodies immediately", async () => {
    let cancelled = false;
    let pulls = 0;
    const body = new ReadableStream({
      pull(controller) {
        pulls++;
        controller.enqueue(new Uint8Array(MAX_BODY_BYTES + 1));
        if (pulls === 4) controller.close();
      },
      cancel() { cancelled = true; },
    });
    const request = new Request("https://leaderborder.test/api/devices", { method: "POST", headers: { "content-type": "application/json" }, body });
    await expect(readJsonBody(request)).rejects.toMatchObject({ status: 413 });
    expect(cancelled).toBe(true);
    expect(pulls).toBeLessThan(4);
  });

  it("revokes the server session on logout, including copies of its cookie", async () => {
    await registerDevice();
    const cookie = await sessionCookie(await userIdOf("ada"));
    expect((await call("GET", "/api/me", { headers: { cookie } })).status).toBe(200);
    expect((await call("POST", "/auth/logout", { headers: { cookie } })).status).toBe(204);
    expect((await call("GET", "/api/me", { headers: { cookie } })).status).toBe(401);
  });

  it("invalidates prior sessions and device tokens when access policy changes", async () => {
    const ada = await registerDevice();
    const cookie = await sessionCookie(await userIdOf("ada"));
    const restricted = { ALLOWED_GITHUB_LOGINS: "linus" };
    expect((await call("GET", "/api/me", { headers: { cookie }, env: restricted })).status).toBe(401);
    expect((await call("GET", "/api/me", { headers: bearer(ada.data.token), env: restricted })).status).toBe(401);
  });

  it("rate limits registration before contacting GitHub", async () => {
    const limit = vi.fn().mockResolvedValue({ success: false });
    const { response } = await registerDevice({ env: { AUTH_LIMITER: { limit } } });
    expect(response.status).toBe(429);
    expect(response.headers.get("retry-after")).toBe("60");
    expect(globalThis.fetch).not.toHaveBeenCalled();
  });

  it("rejects uploads authorized before token revocation", async () => {
    const ada = await registerDevice();
    const { id: tokenId } = await env.DB.prepare("SELECT id FROM api_tokens WHERE revoked_at IS NULL").first();
    const nowIso = new Date().toISOString();
    await revokeDevice(env.DB, { userId: await userIdOf("ada"), deviceId: ada.deviceId, nowIso });
    await upsertUsage(env.DB, { deviceId: ada.deviceId, tokenId, rows: [row()], nowIso });
    expect((await env.DB.prepare("SELECT COUNT(*) AS n FROM usage_daily").first()).n).toBe(0);
  });

  it("keeps aggregates available for large valid token counts", async () => {
    const ada = await registerDevice();
    const max = Number.MAX_SAFE_INTEGER;
    const rows = Array.from({ length: 300 }, (_, index) => row({ model: `m${index}`, input: max, output: max, cacheRead: max, cacheWrite: max }));
    const response = await call("PUT", "/api/usage", { body: { deviceId: ada.deviceId, rows }, headers: bearer(ada.data.token) });
    expect(response.status).toBe(200);
    await caches.default.delete(new Request("https://leaderborder.test/api/public/stats"));
    const stats = await call("GET", "/api/public/stats");
    expect(stats.status).toBe(200);
    expect(Number.isFinite((await stats.json()).tokensAllTime)).toBe(true);
  });

  it("rejects costs that would overflow aggregate serialization", async () => {
    const ada = await registerDevice();
    const response = await call("PUT", "/api/usage", { body: { deviceId: ada.deviceId, rows: [row({ costUsd: 1e308 })] }, headers: bearer(ada.data.token) });
    expect(response.status).toBe(400);
  });

  it("requires same-origin evidence for cookie mutations", async () => {
    expect((await call("POST", "/auth/logout")).status).toBe(403);
    expect((await call("POST", "/auth/logout", { headers: { "sec-fetch-site": "same-site" } })).status).toBe(403);
    expect((await call("POST", "/auth/logout", { headers: { "sec-fetch-site": "same-origin" } })).status).toBe(204);
  });

  it("does not expose dev login on a public URL even with local APP_URL", async () => {
    expect((await call("GET", "/auth/dev?login=ada", { env: { DEV_LOGIN: "1", APP_URL: "http://localhost:8787" } })).status).toBe(404);
  });

  it("rejects GitHub tokens that were not issued to this OAuth app", async () => {
    const { response, data } = await registerDevice({ token: "gho_other_app" });
    expect(response.status).toBe(401);
    expect(data.error.code).toBe("unauthorized");
    expect((await env.DB.prepare("SELECT COUNT(*) AS n FROM users").first()).n).toBe(0);
  });

  it("denies everyone when no access list and no PUBLIC_ACCESS is configured", async () => {
    const { response } = await registerDevice({ env: { PUBLIC_ACCESS: "" } });
    expect(response.status).toBe(403);
    expect((await call("GET", "/auth/github", { env: { PUBLIC_ACCESS: "" } })).status).toBe(302);
  });

  it("rejects usage days before 2020", async () => {
    const ada = await registerDevice();
    const response = await call("PUT", "/api/usage", { body: { deviceId: ada.deviceId, rows: [row({ day: "0000-01-01" })] }, headers: bearer(ada.data.token) });
    expect(response.status).toBe(400);
    expect((await response.json()).error.message).toMatch(/before 2020-01-01/);
  });

  it("caps distinct client and model combinations per device", async () => {
    const ada = await registerDevice();
    const rows = Array.from({ length: MAX_PAIRS_PER_DEVICE }, (_, index) => row({ model: `m${index}` }));
    expect((await call("PUT", "/api/usage", { body: { deviceId: ada.deviceId, rows }, headers: bearer(ada.data.token) })).status).toBe(200);
    expect((await call("PUT", "/api/usage", { body: { deviceId: ada.deviceId, rows: [row({ model: "m0", day: "2026-09-21" })] }, headers: bearer(ada.data.token) })).status).toBe(200);
    const response = await call("PUT", "/api/usage", { body: { deviceId: ada.deviceId, rows: [row({ model: "one-too-many" })] }, headers: bearer(ada.data.token) });
    expect(response.status).toBe(400);
    expect((await response.json()).error.message).toMatch(/distinct client and model/);
  });

  it("caps active devices per user", async () => {
    for (let i = 0; i < MAX_DEVICES_PER_USER; i++) expect((await registerDevice()).response.status).toBe(201);
    const extra = await registerDevice();
    expect(extra.response.status).toBe(403);
    const first = (await env.DB.prepare("SELECT id FROM devices ORDER BY created_at LIMIT 1").first()).id;
    const cookie = await sessionCookie(await userIdOf("ada"));
    expect((await call("DELETE", `/api/me/devices/${first}`, { headers: { cookie, origin: ORIGIN } })).status).toBe(204);
    expect((await registerDevice()).response.status).toBe(201);
  });

  it("redirects plain http to https", async () => {
    const ctx = createExecutionContext();
    const response = await worker.fetch(new Request("http://leaderborder.test/api/me?x=1", { headers: { authorization: "Bearer x" } }), makeEnv(), ctx);
    expect(response.status).toBe(301);
    expect(response.headers.get("location")).toBe("https://leaderborder.test/api/me?x=1");
  });

  it("lets a device revoke itself with its bearer token", async () => {
    const ada = await registerDevice();
    expect((await call("DELETE", "/api/me/devices/self", { headers: bearer(ada.data.token) })).status).toBe(204);
    expect((await call("GET", "/api/me", { headers: bearer(ada.data.token) })).status).toBe(401);
    expect((await call("DELETE", "/api/me/devices/self", { headers: bearer(ada.data.token) })).status).toBe(401);
    expect((await call("DELETE", "/api/me/devices/self")).status).toBe(401);
  });

  it("does not accept a signed state payload as a session", async () => {
    await registerDevice();
    const forged = await signValue({ typ: "state", uid: await userIdOf("ada"), sid: `lb_${"a".repeat(43)}`, exp: 9999999999 }, TEST_SECRET);
    expect((await call("GET", "/api/me", { headers: { cookie: `__Host-lb_session=${forged}` } })).status).toBe(401);
  });

  it("refuses to sign with a short SESSION_SECRET", async () => {
    expect((await call("GET", "/auth/github", { env: { SESSION_SECRET: "short" } })).status).toBe(500);
  });

  it("fails closed when a rate limiter binding is missing in production", async () => {
    expect((await call("GET", "/api/config", { env: { API_LIMITER: undefined } })).status).toBe(503);
    expect((await call("GET", "/api/config", { env: { API_LIMITER: undefined, APP_URL: "http://localhost:8787" } })).status).toBe(200);
  });

  it("cuts off blocked users everywhere", async () => {
    const ada = await registerDevice();
    const cookie = await sessionCookie(await userIdOf("ada"));
    await env.DB.prepare("UPDATE users SET blocked_at = ?1 WHERE login = 'ada'").bind(new Date().toISOString()).run();
    expect((await call("GET", "/api/me", { headers: { cookie } })).status).toBe(401);
    expect((await call("GET", "/api/me", { headers: bearer(ada.data.token) })).status).toBe(401);
    expect((await registerDevice()).response.status).toBe(403);
  });

  it("expires device tokens", async () => {
    const ada = await registerDevice();
    const { expires_at } = await env.DB.prepare("SELECT expires_at FROM api_tokens").first();
    expect(new Date(expires_at).getTime() - Date.now()).toBeGreaterThan(89 * 86400000);
    await env.DB.prepare("UPDATE api_tokens SET expires_at = '2020-01-01T00:00:00.000Z'").run();
    expect((await call("GET", "/api/me", { headers: bearer(ada.data.token) })).status).toBe(401);
  });

  it("shows device names only to their owner", async () => {
    await registerDevice({ deviceName: "Ada Mac" });
    await registerDevice({ token: "gho_linus" });
    const cookie = await sessionCookie(await userIdOf("linus"));
    const other = await (await call("GET", "/api/users/ada", { headers: { cookie } })).json();
    expect(other).toMatchObject({ deviceCount: 1, devices: [] });
    const mine = await (await call("GET", "/api/users/ada", { headers: { cookie: await sessionCookie(await userIdOf("ada")) } })).json();
    expect(mine.devices).toEqual([{ name: "Ada Mac", lastSyncAt: null }]);
  });

  it("rejects control characters in device names and tokens", async () => {
    expect((await registerDevice({ deviceName: "Mac\u001b[2J" })).response.status).toBe(400);
    expect((await registerDevice({ token: "gho_ada\r\nX: y" })).response.status).toBe(400);
  });

  it("frees a login taken over on GitHub for its new owner", async () => {
    await registerDevice();
    vi.restoreAllMocks();
    mockGithub({ users: { gho_new: githubUser(99, "ada") } });
    expect((await registerDevice({ token: "gho_new" })).response.status).toBe(201);
    const rows = (await env.DB.prepare("SELECT github_id, login FROM users ORDER BY github_id").all()).results;
    expect(rows).toEqual([{ github_id: 1, login: "ada#1" }, { github_id: 99, login: "ada" }]);
  });

  it("deletes the account and all of its data on DELETE /api/me", async () => {
    const ada = await registerDevice();
    const cookie = await sessionCookie(await userIdOf("ada"));
    await call("PUT", "/api/usage", { body: { deviceId: ada.deviceId, rows: [row()] }, headers: bearer(ada.data.token) });
    const response = await call("DELETE", "/api/me", { headers: { cookie, origin: ORIGIN } });
    expect(response.status).toBe(204);
    expect(response.headers.get("set-cookie")).toMatch(/^__Host-lb_session=; .*Max-Age=0/);
    for (const table of ["users", "devices", "api_tokens", "usage_daily", "web_sessions"]) {
      expect((await env.DB.prepare(`SELECT COUNT(*) AS n FROM ${table}`).first()).n).toBe(0);
    }
    expect((await call("GET", "/api/me", { headers: bearer(ada.data.token) })).status).toBe(401);
    expect((await call("DELETE", "/api/me", { headers: { cookie } })).status).toBe(401);
  });

  it("requires same-origin evidence for account deletion", async () => {
    await registerDevice();
    const cookie = await sessionCookie(await userIdOf("ada"));
    expect((await call("DELETE", "/api/me", { headers: { cookie, origin: "https://evil.example" } })).status).toBe(403);
    expect((await env.DB.prepare("SELECT COUNT(*) AS n FROM users").first()).n).toBe(1);
  });
});
