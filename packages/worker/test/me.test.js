import { env } from "cloudflare:workers";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { localDay } from "../src/periods.js";
import { signValue } from "../src/session.js";
import { ORIGIN, bearer, call, githubUser, mockGithub, registerDevice, resetDb, row, sessionCookie, uploadRows, userIdOf } from "./helpers.js";

let ada;
let adaId;

beforeEach(async () => {
  await resetDb();
  mockGithub({ users: { gho_ada: githubUser(1, "ada"), gho_linus: githubUser(2, "linus") } });
  ada = await registerDevice({ token: "gho_ada", deviceName: "Ada Mac" });
  adaId = await userIdOf("ada");
});

afterEach(() => vi.restoreAllMocks());

const today = () => localDay(new Date(), "Europe/Prague");

describe("GET /api/me", () => {
  it("works with a bearer token and has no rank without usage", async () => {
    const response = await call("GET", "/api/me", { headers: bearer(ada.data.token) });
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      user: { login: "ada", name: "Ada", avatarUrl: "https://avatars.githubusercontent.com/u/1" },
      rank: null,
      devices: [{ id: ada.deviceId, name: "Ada Mac", createdAt: expect.any(String), lastSyncAt: null }],
    });
  });

  it("works with a session cookie and reports the weekly rank", async () => {
    const linus = await registerDevice({ token: "gho_linus" });
    await uploadRows(linus.data.token, linus.deviceId, [row({ day: today() })]);
    await uploadRows(ada.data.token, ada.deviceId, [row({ day: today(), input: 1 })]);
    const response = await call("GET", "/api/me", { headers: { cookie: await sessionCookie(adaId) } });
    const data = await response.json();
    expect(data.rank).toEqual({ period: "week", metric: "tokens", position: 2, of: 2, value: 901 });
    expect(data.devices[0].lastSyncAt).toMatch(/^\d{4}-/);
  });

  it("rejects missing auth", async () => {
    expect((await call("GET", "/api/me")).status).toBe(401);
  });

  it("rejects a tampered session cookie", async () => {
    const valid = await sessionCookie(adaId);
    const [name, value] = valid.split("=");
    const [body, sig] = value.split(".");
    const forgedBody = btoa(JSON.stringify({ uid: adaId + 1, exp: 9999999999 })).replace(/=+$/, "");
    expect((await call("GET", "/api/me", { headers: { cookie: `${name}=${forgedBody}.${sig}` } })).status).toBe(401);
    expect((await call("GET", "/api/me", { headers: { cookie: `${name}=${body}.${sig.slice(0, -2)}xx` } })).status).toBe(401);
  });

  it("rejects a session signed with another secret or expired", async () => {
    const foreign = await signValue({ uid: adaId, exp: 9999999999 }, "other-secret");
    expect((await call("GET", "/api/me", { headers: { cookie: `lb_session=${foreign}` } })).status).toBe(401);
    const expired = await sessionCookie(adaId, Math.floor(Date.now() / 1000) - 1);
    expect((await call("GET", "/api/me", { headers: { cookie: expired } })).status).toBe(401);
  });

  it("rejects a session for a deleted user", async () => {
    const cookie = await sessionCookie(adaId);
    await resetDb();
    expect((await call("GET", "/api/me", { headers: { cookie } })).status).toBe(401);
  });
});

describe("DELETE /api/me/devices/:id", () => {
  it("revokes the device and its token", async () => {
    const cookie = await sessionCookie(adaId);
    const response = await call("DELETE", `/api/me/devices/${ada.deviceId}`, { headers: { cookie, origin: ORIGIN } });
    expect(response.status).toBe(204);
    expect((await call("GET", "/api/me", { headers: bearer(ada.data.token) })).status).toBe(401);
    const me = await (await call("GET", "/api/me", { headers: { cookie } })).json();
    expect(me.devices).toEqual([]);
    const token = await env.DB.prepare("SELECT revoked_at FROM api_tokens").first();
    expect(token.revoked_at).not.toBeNull();
  });

  it("returns 404 for another user's device", async () => {
    const linus = await registerDevice({ token: "gho_linus" });
    const response = await call("DELETE", `/api/me/devices/${linus.deviceId}`, { headers: { cookie: await sessionCookie(adaId) } });
    expect(response.status).toBe(404);
    expect((await call("GET", "/api/me", { headers: bearer(linus.data.token) })).status).toBe(200);
  });

  it("returns 404 for an already revoked device", async () => {
    const cookie = await sessionCookie(adaId);
    await call("DELETE", `/api/me/devices/${ada.deviceId}`, { headers: { cookie } });
    expect((await call("DELETE", `/api/me/devices/${ada.deviceId}`, { headers: { cookie } })).status).toBe(404);
  });

  it("requires a cookie, not a bearer token", async () => {
    expect((await call("DELETE", `/api/me/devices/${ada.deviceId}`, { headers: bearer(ada.data.token) })).status).toBe(401);
  });

  it("rejects cross-origin requests", async () => {
    const response = await call("DELETE", `/api/me/devices/${ada.deviceId}`, {
      headers: { cookie: await sessionCookie(adaId), origin: "https://evil.com" },
    });
    expect(response.status).toBe(403);
  });

  it("allows re-registration of a revoked device", async () => {
    await call("DELETE", `/api/me/devices/${ada.deviceId}`, { headers: { cookie: await sessionCookie(adaId) } });
    const again = await registerDevice({ token: "gho_ada", deviceId: ada.deviceId });
    expect(again.response.status).toBe(201);
    expect((await call("GET", "/api/me", { headers: bearer(again.data.token) })).status).toBe(200);
  });
});
