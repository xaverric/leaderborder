import { afterEach, describe, expect, it, vi } from "vitest";
import { call } from "./helpers.js";

const expectSecurityHeaders = (response) => {
  expect(response.headers.get("x-content-type-options")).toBe("nosniff");
  expect(response.headers.get("referrer-policy")).toBe("strict-origin-when-cross-origin");
  expect(response.headers.get("x-frame-options")).toBe("DENY");
};

afterEach(() => vi.restoreAllMocks());

describe("GET /api/config", () => {
  it("returns the public client id", async () => {
    const response = await call("GET", "/api/config");
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ githubClientId: "test-client-id", apiVersion: 1 });
    expect(response.headers.get("content-type")).toMatch(/^application\/json/);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expectSecurityHeaders(response);
  });
});

describe("routing errors", () => {
  it("returns JSON 404 for unknown API paths", async () => {
    const response = await call("GET", "/api/nope");
    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({ error: { code: "not_found", message: "Not found" } });
    expectSecurityHeaders(response);
  });

  it("returns JSON 404 for unknown auth paths", async () => {
    expect((await call("GET", "/auth/nope")).status).toBe(404);
  });

  it("returns 405 with Allow for a wrong method", async () => {
    const response = await call("POST", "/api/config");
    expect(response.status).toBe(405);
    expect(response.headers.get("allow")).toBe("GET");
    expect((await response.json()).error.code).toBe("invalid_request");
  });

  it("returns 405 for a wrong method on a parametrized route", async () => {
    const response = await call("POST", "/api/me/devices/abc");
    expect(response.status).toBe(405);
    expect(response.headers.get("allow")).toBe("DELETE");
  });
});

describe("request bodies", () => {
  it("rejects a declared body over 512 KB with 413", async () => {
    const response = await call("PUT", "/api/usage", {
      raw: "{}",
      headers: { "content-type": "application/json", "content-length": String(512 * 1024 + 1) },
    });
    expect(response.status).toBe(413);
    expect((await response.json()).error.code).toBe("invalid_request");
  });

  it("rejects an actual body over 512 KB with 413", async () => {
    const response = await call("POST", "/api/devices", {
      raw: JSON.stringify({ pad: "x".repeat(512 * 1024) }),
      headers: { "content-type": "application/json" },
    });
    expect(response.status).toBe(413);
  });

  it("rejects non-JSON content types", async () => {
    const response = await call("POST", "/api/devices", { raw: "a=1", headers: { "content-type": "text/plain" } });
    expect(response.status).toBe(400);
    expect((await response.json()).error).toEqual({ code: "invalid_request", message: "Content-Type must be application/json" });
  });

  it("rejects malformed JSON", async () => {
    const response = await call("POST", "/api/devices", { raw: "{", headers: { "content-type": "application/json" } });
    expect(response.status).toBe(400);
    expect((await response.json()).error.message).toBe("Invalid JSON body");
  });
});

describe("app shell", () => {
  it.each([["/app"], ["/app/"], ["/app/u/ada"]])("serves app.html for %s", async (path) => {
    const response = await call("GET", path);
    expect(response.status).toBe(200);
    expect(await response.text()).toBe("asset /app.html");
    expectSecurityHeaders(response);
  });

  it("passes other paths to assets", async () => {
    const response = await call("GET", "/css/tokens.css");
    expect(await response.text()).toBe("asset /css/tokens.css");
    expectSecurityHeaders(response);
  });
});

describe("unexpected failures", () => {
  it("maps thrown errors to 500 internal", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const response = await call("GET", "/api/public/stats", { env: { DB: null } });
    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({ error: { code: "internal", message: "Internal error" } });
  });
});
