import { afterEach, describe, expect, it, vi } from "vitest";
import { exchangeCode, resolveGithubAccess } from "../src/github.js";

const env = (overrides = {}) => ({
  ALLOWED_GITHUB_ORGS: "",
  ALLOWED_GITHUB_LOGINS: "",
  GITHUB_CLIENT_ID: "cid",
  GITHUB_CLIENT_SECRET: "csecret",
  ...overrides,
});

const user = { id: 42, login: "ada", name: "Ada Lovelace", avatar_url: "https://avatars.githubusercontent.com/u/42" };

const respond = (routes) =>
  vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
    const url = typeof input === "string" ? input : input.url;
    const route = routes[url];
    return route ? Response.json(route.body, { status: route.status ?? 200 }) : new Response("not mocked", { status: 599 });
  });

afterEach(() => vi.restoreAllMocks());

describe("resolveGithubAccess", () => {
  it("returns the profile and skips org lookup when no orgs are configured", async () => {
    const spy = respond({ "https://api.github.com/user": { body: user } });
    const result = await resolveGithubAccess("gho_x", env());
    expect(result).toEqual({
      profile: { githubId: 42, login: "ada", name: "Ada Lovelace", avatarUrl: "https://avatars.githubusercontent.com/u/42" },
      allowed: true,
    });
    expect(spy).toHaveBeenCalledTimes(1);
    const [, init] = spy.mock.calls[0];
    const headers = new Headers(init.headers);
    expect(headers.get("authorization")).toBe("Bearer gho_x");
    expect(headers.get("user-agent")).toBe("leaderborder");
    expect(headers.get("accept")).toBe("application/vnd.github+json");
  });

  it("checks org membership when orgs are configured", async () => {
    respond({
      "https://api.github.com/user": { body: user },
      "https://api.github.com/user/orgs?per_page=100": { body: [{ login: "Acme" }] },
    });
    expect((await resolveGithubAccess("t", env({ ALLOWED_GITHUB_ORGS: "acme" }))).allowed).toBe(true);
    expect((await resolveGithubAccess("t", env({ ALLOWED_GITHUB_ORGS: "other" }))).allowed).toBe(false);
  });

  it("skips org lookup when the login is already allowed", async () => {
    const spy = respond({ "https://api.github.com/user": { body: user } });
    expect((await resolveGithubAccess("t", env({ ALLOWED_GITHUB_ORGS: "acme", ALLOWED_GITHUB_LOGINS: "ada" }))).allowed).toBe(true);
    expect(spy).toHaveBeenCalledTimes(1);
  });

  it("throws unauthorized when GitHub rejects the token", async () => {
    respond({ "https://api.github.com/user": { status: 401, body: { message: "Bad credentials" } } });
    await expect(resolveGithubAccess("bad", env())).rejects.toMatchObject({ status: 401, code: "unauthorized" });
  });

  it("throws internal when GitHub fails", async () => {
    respond({ "https://api.github.com/user": { status: 502, body: {} } });
    await expect(resolveGithubAccess("t", env())).rejects.toMatchObject({ status: 500, code: "internal" });
  });

  it("uses the login as name fallback", async () => {
    respond({ "https://api.github.com/user": { body: { ...user, name: null } } });
    expect((await resolveGithubAccess("t", env())).profile.name).toBe("ada");
  });
});

describe("exchangeCode", () => {
  it("posts the code and returns the access token", async () => {
    const spy = respond({ "https://github.com/login/oauth/access_token": { body: { access_token: "gho_web" } } });
    expect(await exchangeCode({ code: "c1", redirectUri: "https://x/auth/github/callback", env: env() })).toBe("gho_web");
    const [, init] = spy.mock.calls[0];
    expect(init.method).toBe("POST");
    expect(JSON.parse(init.body)).toEqual({ client_id: "cid", client_secret: "csecret", code: "c1", redirect_uri: "https://x/auth/github/callback" });
  });

  it("returns null on an OAuth error", async () => {
    respond({ "https://github.com/login/oauth/access_token": { body: { error: "bad_verification_code" } } });
    expect(await exchangeCode({ code: "c1", redirectUri: "r", env: env() })).toBeNull();
  });
});
