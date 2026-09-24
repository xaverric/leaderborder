import { env } from "cloudflare:workers";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { parseCookies } from "../src/cookies.js";
import { base64urlEncode, utf8 } from "../src/encoding.js";
import { signValue, verifyValue } from "../src/session.js";
import { ORIGIN, TEST_SECRET, call, githubUser, mockGithub, registerDevice, resetDb, sessionCookie, userIdOf } from "./helpers.js";

const nowSec = () => Math.floor(Date.now() / 1000);

const setCookies = (response) => response.headers.getSetCookie();

const cookieValue = (response, name) => {
  const header = setCookies(response).find((c) => c.startsWith(`${name}=`));
  return header ? parseCookies(header.split(";")[0])[name] : undefined;
};

const startLogin = async (next = "/app/u/ada") => {
  const response = await call("GET", `/auth/github?next=${encodeURIComponent(next)}`);
  const location = new URL(response.headers.get("location"));
  return { response, location, state: location.searchParams.get("state"), stateCookie: cookieValue(response, "__Host-lb_oauth_state") };
};

const callback = ({ code = "c1", state, stateCookie, envOverrides }) =>
  call("GET", `/auth/github/callback?code=${code}&state=${state}`, {
    headers: stateCookie ? { cookie: `__Host-lb_oauth_state=${stateCookie}` } : {},
    env: envOverrides,
  });

beforeEach(async () => {
  await resetDb();
  mockGithub({ users: { gho_ada: githubUser(1, "ada"), gho_linus: githubUser(2, "linus") }, codes: { c1: "gho_ada", c2: "gho_linus" } });
});

afterEach(() => vi.restoreAllMocks());

describe("GET /auth/github", () => {
  it("redirects to GitHub with a signed state cookie", async () => {
    const { response, location, state, stateCookie } = await startLogin();
    expect(response.status).toBe(302);
    expect(`${location.origin}${location.pathname}`).toBe("https://github.com/login/oauth/authorize");
    expect(location.searchParams.get("client_id")).toBe("test-client-id");
    expect(location.searchParams.get("redirect_uri")).toBe(`${ORIGIN}/auth/github/callback`);
    expect(location.searchParams.get("scope")).toBeNull();
    expect(state).toMatch(/^[A-Za-z0-9_-]{22,}$/);
    expect(setCookies(response)[0]).toMatch(/^__Host-lb_oauth_state=[^;]+; Path=\/; Max-Age=600; HttpOnly; Secure; SameSite=Lax$/);
    expect(await verifyValue(stateCookie, TEST_SECRET, nowSec())).toMatchObject({ state, next: "/app/u/ada" });
  });

  it.each([["//evil.com"], ["https://evil.com"], ["/\\evil.com"]])("replaces unsafe next %s with /app", async (next) => {
    const { stateCookie } = await startLogin(next);
    expect((await verifyValue(stateCookie, TEST_SECRET, nowSec())).next).toBe("/app");
  });
});

describe("GET /auth/github/callback", () => {
  it("binds the exchanged code to this browser's PKCE verifier", async () => {
    const { location, state, stateCookie } = await startLogin();
    const { verifier } = await verifyValue(stateCookie, TEST_SECRET, nowSec());
    expect(location.searchParams.get("code_challenge_method")).toBe("S256");
    expect(location.searchParams.get("code_challenge")).toBe(base64urlEncode(await crypto.subtle.digest("SHA-256", utf8(verifier))));
    await callback({ state, stateCookie });
    const exchange = globalThis.fetch.mock.calls.find(([url]) => url === "https://github.com/login/oauth/access_token");
    expect(JSON.parse(exchange[1].body).code_verifier).toBe(verifier);
    expect(exchange[1].redirect).toBe("manual");
  });

  it("logs the user in and redirects to next", async () => {
    const { state, stateCookie } = await startLogin();
    const response = await callback({ state, stateCookie });
    expect(response.status).toBe(302);
    expect(response.headers.get("location")).toBe("/app/u/ada");
    const cookies = setCookies(response);
    expect(cookies.find((c) => c.startsWith("__Host-lb_session="))).toMatch(/; Path=\/; Max-Age=604800; HttpOnly; Secure; SameSite=Lax$/);
    expect(cookies.find((c) => c.startsWith("__Host-lb_oauth_state="))).toMatch(/Max-Age=0/);
    const user = await env.DB.prepare("SELECT id, login FROM users").first();
    expect(user.login).toBe("ada");
    const session = await verifyValue(cookieValue(response, "__Host-lb_session"), TEST_SECRET, nowSec());
    expect(session.uid).toBe(user.id);
    expect(session.exp).toBeGreaterThan(nowSec() + 604800 - 60);
    expect(session.exp).toBeLessThanOrEqual(nowSec() + 604800);
  });

  it("rejects a state mismatch", async () => {
    const { stateCookie } = await startLogin();
    const response = await callback({ state: "other", stateCookie });
    expect(response.status).toBe(400);
    expect(response.headers.get("content-type")).toMatch(/^text\/html/);
  });

  it("rejects a missing state cookie", async () => {
    const { state } = await startLogin();
    expect((await callback({ state })).status).toBe(400);
  });

  it("rejects an expired state cookie", async () => {
    const stateCookie = await signValue({ typ: "state", state: "s1", next: "/app", exp: nowSec() - 1 }, TEST_SECRET);
    expect((await callback({ state: "s1", stateCookie })).status).toBe(400);
  });

  it("rejects a bad code", async () => {
    const { state, stateCookie } = await startLogin();
    expect((await callback({ code: "nope", state, stateCookie })).status).toBe(400);
  });

  it("shows a 403 page when the account is not allowed", async () => {
    const { state, stateCookie } = await startLogin();
    const response = await callback({ code: "c2", state, stateCookie, envOverrides: { ALLOWED_GITHUB_LOGINS: "ada" } });
    expect(response.status).toBe(403);
    expect(response.headers.get("content-type")).toMatch(/^text\/html/);
    expect(await response.text()).toContain('href="/"');
    expect(setCookies(response).some((c) => c.startsWith("__Host-lb_session="))).toBe(false);
    expect((await env.DB.prepare("SELECT COUNT(*) AS n FROM users").first()).n).toBe(0);
  });
});

describe("POST /auth/logout", () => {
  it("clears the session cookie", async () => {
    await registerDevice();
    const response = await call("POST", "/auth/logout", { headers: { cookie: await sessionCookie(await userIdOf("ada")) } });
    expect(response.status).toBe(204);
    expect(setCookies(response)[0]).toMatch(/^__Host-lb_session=; Path=\/; Max-Age=0; HttpOnly; Secure; SameSite=Lax$/);
  });

  it("rejects a cross-origin logout", async () => {
    const response = await call("POST", "/auth/logout", { headers: { origin: "https://evil.com" } });
    expect(response.status).toBe(403);
  });
});

describe("GET /auth/dev", () => {
  const localCall = (method, path, options) => call(method, `http://localhost:8787${path}`, options);
  const devEnv = { DEV_LOGIN: "1", APP_URL: "http://localhost:8787" };

  it("logs in a fake user in local dev", async () => {
    const response = await localCall("GET", "/auth/dev?login=grace&next=/app/u/grace", { env: devEnv });
    expect(response.status).toBe(302);
    expect(response.headers.get("location")).toBe("/app/u/grace");
    expect(setCookies(response)[0]).toMatch(/^lb_session=[^;]+; Path=\/; Max-Age=604800; HttpOnly; SameSite=Lax$/);
    const user = await env.DB.prepare("SELECT id, github_id, login, avatar_url FROM users").first();
    expect(user).toMatchObject({ login: "grace" });
    expect(user.github_id).toBeLessThan(0);
    const session = await verifyValue(cookieValue(response, "lb_session"), TEST_SECRET, nowSec());
    expect(session.uid).toBe(user.id);
  });

  it("reuses an existing user with the same login", async () => {
    await localCall("GET", "/auth/dev?login=grace", { env: devEnv });
    await localCall("GET", "/auth/dev?login=Grace", { env: devEnv });
    expect((await env.DB.prepare("SELECT COUNT(*) AS n FROM users").first()).n).toBe(1);
  });

  it("gives distinct fake users distinct ids", async () => {
    await localCall("GET", "/auth/dev?login=grace", { env: devEnv });
    await localCall("GET", "/auth/dev?login=ken", { env: devEnv });
    expect((await env.DB.prepare("SELECT COUNT(*) AS n FROM users").first()).n).toBe(2);
  });

  it("is 404 without DEV_LOGIN", async () => {
    expect((await localCall("GET", "/auth/dev?login=grace", { env: { APP_URL: "http://localhost:8787" } })).status).toBe(404);
  });

  it("redirects plain http to https when the app is not local, so dev login is unreachable", async () => {
    const response = await localCall("GET", "/auth/dev?login=grace", { env: { DEV_LOGIN: "1" } });
    expect(response.status).toBe(301);
    expect(response.headers.get("location")).toBe("https://localhost:8787/auth/dev?login=grace");
    expect((await localCall("GET", "/auth/dev?login=grace", { env: { DEV_LOGIN: "1", APP_URL: "http://localhost.evil.com" } })).status).toBe(301);
  });

  it("requests read:org only when organizations are configured", async () => {
    const response = await call("GET", "/auth/github", { env: { ALLOWED_GITHUB_ORGS: "acme" } });
    expect(new URL(response.headers.get("location")).searchParams.get("scope")).toBe("read:org");
  });

  it("is 404 when DEV_LOGIN is not exactly 1", async () => {
    expect((await localCall("GET", "/auth/dev?login=grace", { env: { DEV_LOGIN: "true", APP_URL: "http://localhost:8787" } })).status).toBe(404);
  });

  it("rejects invalid logins", async () => {
    expect((await localCall("GET", "/auth/dev?login=b%40d", { env: devEnv })).status).toBe(400);
    expect((await localCall("GET", "/auth/dev", { env: devEnv })).status).toBe(400);
  });
});
