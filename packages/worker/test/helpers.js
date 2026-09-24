import { createExecutionContext, waitOnExecutionContext } from "cloudflare:test";
import { env } from "cloudflare:workers";
import { vi } from "vitest";
import worker from "../src/index.js";
import { SESSION_COOKIE, signValue } from "../src/session.js";

export const ORIGIN = "https://leaderborder.test";

export const makeEnv = (overrides = {}) => ({
  DB: env.DB,
  ASSETS: { fetch: async (request) => new Response(`asset ${new URL(request.url).pathname}`, { headers: { "content-type": "text/html" } }) },
  APP_URL: ORIGIN,
  GITHUB_CLIENT_ID: "test-client-id",
  GITHUB_CLIENT_SECRET: "test-client-secret",
  SESSION_SECRET: "test-session-secret",
  ALLOWED_GITHUB_ORGS: "",
  ALLOWED_GITHUB_LOGINS: "",
  LEADERBOARD_TZ: "Europe/Prague",
  ...overrides,
});

export const call = async (method, path, { body, headers = {}, env: envOverrides, raw } = {}) => {
  const init = { method, headers: { ...headers } };
  if (raw !== undefined) init.body = raw;
  if (body !== undefined) {
    init.body = JSON.stringify(body);
    init.headers["content-type"] ??= "application/json";
  }
  const ctx = createExecutionContext();
  const response = await worker.fetch(new Request(`${ORIGIN}${path}`, init), makeEnv(envOverrides), ctx);
  await waitOnExecutionContext(ctx);
  return response;
};

export const resetDb = () =>
  env.DB.batch(["usage_daily", "api_tokens", "devices", "users"].map((table) => env.DB.prepare(`DELETE FROM ${table}`)));

export const sessionCookie = async (uid, exp = Math.floor(Date.now() / 1000) + 3600) =>
  `${SESSION_COOKIE}=${await signValue({ uid, exp }, "test-session-secret")}`;

export const githubUser = (id, login, extra = {}) => ({
  id,
  login,
  name: login[0].toUpperCase() + login.slice(1),
  avatar_url: `https://avatars.githubusercontent.com/u/${id}`,
  ...extra,
});

export const mockGithub = ({ users = {}, orgs = {}, codes = {} } = {}) =>
  vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init = {}) => {
    const request = new Request(input, init);
    const url = new URL(request.url);
    const token = request.headers.get("authorization")?.replace(/^Bearer /, "");
    if (url.href === "https://github.com/login/oauth/access_token") {
      const { code } = await request.json();
      return Response.json(codes[code] ? { access_token: codes[code] } : { error: "bad_verification_code" });
    }
    if (url.href === "https://api.github.com/user") {
      return users[token] ? Response.json(users[token]) : Response.json({ message: "Bad credentials" }, { status: 401 });
    }
    if (url.pathname === "/user/orgs") return Response.json((orgs[token] ?? []).map((login) => ({ login })));
    return new Response("unexpected", { status: 599 });
  });

export const row = (overrides = {}) => ({
  day: "2026-09-20",
  client: "claude",
  model: "claude-opus-5",
  input: 100,
  output: 200,
  cacheRead: 300,
  cacheWrite: 400,
  reasoning: 50,
  costUsd: 1.5,
  messages: 7,
  ...overrides,
});

export const uuid = () => crypto.randomUUID();

export const registerDevice = async ({ token = "gho_ada", deviceId = uuid(), deviceName = "Test Mac", env: envOverrides } = {}) => {
  const response = await call("POST", "/api/devices", { body: { githubToken: token, deviceId, deviceName }, env: envOverrides });
  return { response, data: response.status === 201 ? await response.json() : await response.json().catch(() => null), deviceId };
};

export const bearer = (token) => ({ authorization: `Bearer ${token}` });

export const uploadRows = async (token, deviceId, rows) => {
  const response = await call("PUT", "/api/usage", { body: { deviceId, tokscaleVersion: "4.17.0", rows }, headers: bearer(token) });
  if (response.status !== 200) throw new Error(`upload failed ${response.status} ${await response.text()}`);
};

export const userIdOf = async (login) => (await env.DB.prepare("SELECT id FROM users WHERE login = ?1").bind(login).first()).id;
