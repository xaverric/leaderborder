import { env } from "cloudflare:workers";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { hashToken } from "../src/tokens.js";
import { githubUser, mockGithub, registerDevice, resetDb } from "./helpers.js";

const ada = githubUser(1, "ada");
const linus = githubUser(2, "linus");

beforeEach(async () => {
  await resetDb();
  mockGithub({ users: { gho_ada: ada, gho_linus: linus }, orgs: { gho_ada: ["Acme"] } });
});

afterEach(() => vi.restoreAllMocks());

const count = async (table) => (await env.DB.prepare(`SELECT COUNT(*) AS n FROM ${table}`).first()).n;

describe("POST /api/devices", () => {
  it("registers a device and returns a device token", async () => {
    const { response, data, deviceId } = await registerDevice({ deviceName: "Ada's MacBook" });
    expect(response.status).toBe(201);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(data).toEqual({
      token: expect.stringMatching(/^lb_[A-Za-z0-9_-]{43}$/),
      deviceId,
      user: { login: "ada", name: "Ada", avatarUrl: "https://avatars.githubusercontent.com/u/1" },
    });
    const device = await env.DB.prepare("SELECT * FROM devices WHERE id = ?").bind(deviceId).first();
    expect(device).toMatchObject({ name: "Ada's MacBook", last_sync_at: null, revoked_at: null });
  });

  it("stores only the sha256 hash of the token", async () => {
    const { data } = await registerDevice();
    const { results } = await env.DB.prepare("SELECT token_hash FROM api_tokens").all();
    expect(results).toEqual([{ token_hash: await hashToken(data.token) }]);
  });

  it("rejects an invalid GitHub token with 401", async () => {
    const { response, data } = await registerDevice({ token: "gho_bad" });
    expect(response.status).toBe(401);
    expect(data.error.code).toBe("unauthorized");
  });

  it("rejects a user outside the allow lists with 403 and writes nothing", async () => {
    const { response, data } = await registerDevice({ token: "gho_linus", env: { ALLOWED_GITHUB_LOGINS: "ada" } });
    expect(response.status).toBe(403);
    expect(data.error.code).toBe("forbidden");
    expect(await count("users")).toBe(0);
    expect(await count("devices")).toBe(0);
  });

  it("allows org members when orgs are configured", async () => {
    expect((await registerDevice({ env: { ALLOWED_GITHUB_ORGS: "acme" } })).response.status).toBe(201);
    expect((await registerDevice({ token: "gho_linus", env: { ALLOWED_GITHUB_ORGS: "acme" } })).response.status).toBe(403);
  });

  it("rotates the token when the same device registers again", async () => {
    const first = await registerDevice();
    const second = await registerDevice({ deviceId: first.deviceId, deviceName: "Renamed" });
    expect(second.response.status).toBe(201);
    expect(second.data.token).not.toBe(first.data.token);
    expect(await count("devices")).toBe(1);
    const tokens = await env.DB.prepare("SELECT token_hash, revoked_at FROM api_tokens ORDER BY id").all();
    expect(tokens.results).toEqual([
      { token_hash: await hashToken(first.data.token), revoked_at: expect.any(String) },
      { token_hash: await hashToken(second.data.token), revoked_at: null },
    ]);
    expect((await env.DB.prepare("SELECT name FROM devices").first()).name).toBe("Renamed");
  });

  it("rejects a device id owned by another user", async () => {
    const first = await registerDevice();
    const { response } = await registerDevice({ token: "gho_linus", deviceId: first.deviceId });
    expect(response.status).toBe(403);
    expect((await env.DB.prepare("SELECT COUNT(*) AS n FROM api_tokens WHERE revoked_at IS NULL").first()).n).toBe(1);
  });

  it("updates the profile on login rename", async () => {
    await registerDevice();
    vi.restoreAllMocks();
    mockGithub({ users: { gho_ada: { ...ada, login: "ada-l", name: "Ada L" } } });
    const { data } = await registerDevice();
    expect(data.user.login).toBe("ada-l");
    expect(await count("users")).toBe(1);
  });

  it("rejects invalid bodies with 400", async () => {
    const { response, data } = await registerDevice({ deviceId: "not-a-uuid" });
    expect(response.status).toBe(400);
    expect(data.error).toEqual({ code: "invalid_request", message: "deviceId: must be a uuid v4" });
  });
});
