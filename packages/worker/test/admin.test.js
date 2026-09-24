import { env } from "cloudflare:workers";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { grantsAccess, isAdmin } from "../src/access.js";
import { cookieName } from "../src/cookies.js";
import { upsertUser } from "../src/queries.js";
import { SESSION_COOKIE, createSession } from "../src/session.js";
import { call, githubUser, makeEnv, mockGithub, registerDevice, resetDb } from "./helpers.js";

const ADMIN_LOGIN = "xaverric";
const CLOSED = { PUBLIC_ACCESS: "" };
const nowSec = () => Math.floor(Date.now() / 1000);

const admin = githubUser(99, ADMIN_LOGIN);
const ada = githubUser(1, "ada");
const linus = githubUser(2, "linus");

const profileOf = (user) => ({ githubId: user.id, login: user.login, name: user.name, avatarUrl: user.avatar_url });

const addUser = (user) => upsertUser(env.DB, profileOf(user), new Date().toISOString());

const cookieFor = async (uid) =>
  `${cookieName(SESSION_COOKIE, makeEnv(CLOSED))}=${await createSession(makeEnv(CLOSED), uid, nowSec())}`;

const as = async (user) => cookieFor((await addUser(user)).id);

const request = (method, path, cookie, body) => call(method, path, { headers: cookie ? { cookie } : {}, body, env: CLOSED });

const overview = async (cookie) => (await request("GET", "/api/admin/overview", cookie)).json();

const startLogin = async () => {
  const response = await call("GET", "/auth/github?next=/app", { env: CLOSED });
  const state = new URL(response.headers.get("location")).searchParams.get("state");
  const stateCookie = response.headers.getSetCookie().find((c) => c.startsWith("__Host-lb_oauth_state=")).split(";")[0];
  return { state, stateCookie };
};

const webLogin = async (code) => {
  const { state, stateCookie } = await startLogin();
  return call("GET", `/auth/github/callback?code=${code}&state=${state}`, { headers: { cookie: stateCookie }, env: CLOSED });
};

beforeEach(async () => {
  await resetDb();
  mockGithub({
    users: { gho_admin: admin, gho_ada: ada, gho_linus: linus },
    orgs: { gho_ada: ["Acme"], gho_linus: [] },
    codes: { c_admin: "gho_admin", c_ada: "gho_ada", c_linus: "gho_linus" },
  });
});

afterEach(() => vi.restoreAllMocks());

describe("access rules", () => {
  it("reads admins by immutable GitHub user id from the ADMIN_GITHUB_IDS secret", () => {
    const secret = { ADMIN_GITHUB_IDS: "99, 7" };
    expect(isAdmin(99, secret)).toBe(true);
    expect(isAdmin(7, secret)).toBe(true);
    expect(isAdmin(1, secret)).toBe(false);
    expect(isAdmin(undefined, secret)).toBe(false);
    expect(isAdmin(99, { ADMIN_GITHUB_IDS: "99x" })).toBe(false);
    expect(isAdmin(99, {})).toBe(false);
  });

  it("does not make someone admin who took over the admin's login name", async () => {
    const impostor = githubUser(555, ADMIN_LOGIN);
    const cookie = await cookieFor((await addUser(impostor)).id);
    expect((await request("GET", "/api/admin/overview", cookie)).status).toBe(401);
  });

  it("has no admin when the secret is missing", async () => {
    const cookie = await as(admin);
    const response = await call("GET", "/api/admin/overview", { headers: { cookie }, env: { ...CLOSED, ADMIN_GITHUB_IDS: undefined } });
    expect(response.status).toBe(401);
  });

  it("grants access through the admin, database rules or the env fallback", () => {
    const closed = { PUBLIC_ACCESS: "", ADMIN_GITHUB_IDS: "99" };
    const none = { public: false, logins: [], orgs: [] };
    expect(grantsAccess({ githubId: 99, login: "xaverric", orgs: [] }, closed, none)).toBe(true);
    expect(grantsAccess({ githubId: 555, login: "xaverric", orgs: [] }, closed, none)).toBe(false);
    expect(grantsAccess({ login: "ada", orgs: [] }, closed, none)).toBe(false);
    expect(grantsAccess({ login: "Ada", orgs: [] }, closed, { ...none, logins: ["ada"] })).toBe(true);
    expect(grantsAccess({ login: "ada", orgs: ["ACME"] }, closed, { ...none, orgs: ["acme"] })).toBe(true);
    expect(grantsAccess({ login: "ada", orgs: [] }, closed, { ...none, public: true })).toBe(true);
    expect(grantsAccess({ login: "ada", orgs: [] }, { ALLOWED_GITHUB_LOGINS: "ada" }, none)).toBe(true);
  });
});

describe("admin API", () => {
  it("rejects anonymous and non-admin users", async () => {
    expect((await request("GET", "/api/admin/overview")).status).toBe(401);
    await addUser(ada);
    await request("PUT", "/api/admin/settings", await as(admin), { publicAccess: true });
    expect((await request("GET", "/api/admin/overview", await as(ada))).status).toBe(403);
  });

  it("flags the admin in /api/me", async () => {
    const me = await (await request("GET", "/api/me", await as(admin))).json();
    expect(me.isAdmin).toBe(true);
  });

  it("returns requests, rules, users and settings", async () => {
    const data = await overview(await as(admin));
    expect(data).toEqual({ requests: [], rules: [], users: [expect.objectContaining({ login: ADMIN_LOGIN, isAdmin: true, blocked: false })], settings: { publicAccess: false } });
  });

  it("rejects cross-origin mutations", async () => {
    const cookie = await as(admin);
    const response = await call("POST", "/api/admin/rules", { headers: { cookie, origin: "https://evil.test" }, body: { kind: "login", value: "ada" }, env: CLOSED });
    expect(response.status).toBe(403);
  });

  it("validates rules", async () => {
    const cookie = await as(admin);
    expect((await request("POST", "/api/admin/rules", cookie, { kind: "team", value: "x" })).status).toBe(400);
    expect((await request("POST", "/api/admin/rules", cookie, { kind: "login", value: "not a login!" })).status).toBe(400);
  });
});

describe("access requests", () => {
  it("records a denied web login as a pending request", async () => {
    const response = await webLogin("c_linus");
    expect(response.status).toBe(403);
    expect(await response.text()).toMatch(/Access requested/);
    const data = await overview(await as(admin));
    expect(data.requests).toEqual([expect.objectContaining({ login: "linus", name: "Linus", status: "pending" })]);
  });

  it("records a denied device registration as a pending request", async () => {
    const { response, data } = await registerDevice({ token: "gho_linus", env: CLOSED });
    expect(response.status).toBe(403);
    expect(data.error.message).toMatch(/access requested/i);
    expect((await overview(await as(admin))).requests.map((r) => r.login)).toEqual(["linus"]);
  });

  it("lets the user in after the admin approves the request", async () => {
    await webLogin("c_linus");
    const cookie = await as(admin);
    expect((await request("POST", "/api/admin/requests/linus/approve", cookie)).status).toBe(204);
    const data = await overview(cookie);
    expect(data.requests).toEqual([]);
    expect(data.rules).toEqual([expect.objectContaining({ kind: "login", value: "linus", createdBy: ADMIN_LOGIN })]);
    expect((await webLogin("c_linus")).status).toBe(302);
  });

  it("keeps a denied request denied on the next attempt", async () => {
    await webLogin("c_linus");
    const cookie = await as(admin);
    expect((await request("POST", "/api/admin/requests/linus/deny", cookie)).status).toBe(204);
    await webLogin("c_linus");
    expect((await overview(cookie)).requests).toEqual([expect.objectContaining({ login: "linus", status: "denied" })]);
  });

  it("returns 404 for an unknown request", async () => {
    expect((await request("POST", "/api/admin/requests/nobody/approve", await as(admin))).status).toBe(404);
  });
});

describe("rules take effect without a redeploy", () => {
  it("allows a login rule and revokes access immediately when it is removed", async () => {
    const cookie = await as(admin);
    const created = await request("POST", "/api/admin/rules", cookie, { kind: "login", value: "Linus" });
    expect(created.status).toBe(201);
    const rule = await created.json();
    expect(rule).toMatchObject({ kind: "login", value: "linus" });
    expect((await webLogin("c_linus")).status).toBe(302);
    const linusCookie = await cookieFor((await addUser(linus)).id);
    expect((await request("GET", "/api/me", linusCookie)).status).toBe(200);
    expect((await request("DELETE", `/api/admin/rules/${rule.id}`, cookie)).status).toBe(204);
    expect((await request("GET", "/api/me", linusCookie)).status).toBe(401);
  });

  it("allows members of an organization rule and asks GitHub for read:org", async () => {
    const cookie = await as(admin);
    await request("POST", "/api/admin/rules", cookie, { kind: "org", value: "acme" });
    expect((await (await call("GET", "/api/config", { env: CLOSED })).json()).githubScope).toBe("read:org");
    expect((await webLogin("c_ada")).status).toBe(302);
    expect((await webLogin("c_linus")).status).toBe(403);
  });

  it("opens the board to everyone with the public setting", async () => {
    const cookie = await as(admin);
    expect(await (await request("PUT", "/api/admin/settings", cookie, { publicAccess: true })).json()).toEqual({ publicAccess: true });
    expect((await webLogin("c_linus")).status).toBe(302);
    await request("PUT", "/api/admin/settings", cookie, { publicAccess: false });
    expect((await webLogin("c_linus")).status).toBe(403);
  });
});

describe("blocking users", () => {
  it("blocks and unblocks a user's session and device token", async () => {
    const cookie = await as(admin);
    await request("POST", "/api/admin/rules", cookie, { kind: "login", value: "ada" });
    const { data } = await registerDevice({ token: "gho_ada", env: CLOSED });
    const bearer = { authorization: `Bearer ${data.token}` };
    expect((await call("GET", "/api/me", { headers: bearer, env: CLOSED })).status).toBe(200);
    expect((await request("POST", "/api/admin/users/ada/block", cookie)).status).toBe(204);
    expect((await call("GET", "/api/me", { headers: bearer, env: CLOSED })).status).toBe(401);
    expect((await overview(cookie)).users.find((u) => u.login === "ada").blocked).toBe(true);
    expect((await request("POST", "/api/admin/users/ada/unblock", cookie)).status).toBe(204);
    expect((await call("GET", "/api/me", { headers: bearer, env: CLOSED })).status).toBe(200);
  });

  it("refuses to block the admin", async () => {
    const cookie = await as(admin);
    expect((await request("POST", `/api/admin/users/${ADMIN_LOGIN}/block`, cookie)).status).toBe(400);
  });

  it("hides blocked users from the leaderboard", async () => {
    const cookie = await as(admin);
    await request("PUT", "/api/admin/settings", cookie, { publicAccess: true });
    const { data } = await registerDevice({ token: "gho_ada", env: CLOSED });
    const day = new Date().toISOString().slice(0, 10);
    const usage = { deviceId: data.deviceId, tokscaleVersion: "4.17.0", rows: [{ day, client: "claude", model: "m", input: 1, output: 1, cacheRead: 0, cacheWrite: 0, reasoning: 0, costUsd: 0, messages: 1 }] };
    await call("PUT", "/api/usage", { headers: { authorization: `Bearer ${data.token}` }, body: usage, env: CLOSED });
    const before = await (await request("GET", "/api/leaderboard?period=all", cookie)).json();
    expect(before.entries.map((e) => e.login)).toContain("ada");
    await request("POST", "/api/admin/users/ada/block", cookie);
    const after = await (await request("GET", "/api/leaderboard?period=all", cookie)).json();
    expect(after.entries.map((e) => e.login)).not.toContain("ada");
  });
});

describe("dev login", () => {
  it("grants the dev user access so local development works without rules", async () => {
    const local = { ...CLOSED, DEV_LOGIN: "1", APP_URL: "http://localhost:8787" };
    const response = await call("GET", "http://localhost:8787/auth/dev?login=grace", { env: local });
    expect(response.status).toBe(302);
    const rule = await env.DB.prepare("SELECT kind, value FROM access_rules").first();
    expect(rule).toEqual({ kind: "login", value: "grace" });
  });
});
