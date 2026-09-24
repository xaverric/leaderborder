import { describe, expect, it } from "vitest";
import { isUuidV4, safeNext, validateDeviceBody, validateRow, validateUsageBody } from "../src/validate.js";

const now = new Date("2026-09-24T12:00:00Z");
const uuid = "3f2b8c1e-5d4a-4b6f-9a8e-1c2d3e4f5a6b";

const row = (overrides = {}) => ({
  day: "2026-09-20",
  client: "claude",
  model: "claude-opus-5",
  input: 10,
  output: 20,
  cacheRead: 30,
  cacheWrite: 40,
  reasoning: 5,
  costUsd: 1.25,
  messages: 3,
  ...overrides,
});

describe("validateRow", () => {
  it("accepts a valid row", () => {
    expect(validateRow(row(), now)).toBeNull();
  });

  it.each([["2026-02-30"], ["2026-9-01"], ["2026-13-01"], ["20260901"], [20260901], [undefined]])("rejects day %s", (day) => {
    expect(validateRow(row({ day }), now)).toMatch(/^day/);
  });

  it("accepts tomorrow and rejects the day after", () => {
    expect(validateRow(row({ day: "2026-09-25" }), now)).toBeNull();
    expect(validateRow(row({ day: "2026-09-26" }), now)).toMatch(/^day/);
  });

  it.each([["Claude"], ["a".repeat(41)], [".x"], ["-x"], [""], ["cl aude"], [1]])("rejects client %s", (client) => {
    expect(validateRow(row({ client }), now)).toMatch(/^client/);
  });

  it("accepts a 40 char client with dots, dashes, underscores", () => {
    expect(validateRow(row({ client: "claude-code_1.x" }), now)).toBeNull();
    expect(validateRow(row({ client: "a".repeat(40) }), now)).toBeNull();
  });

  it.each([[""], ["m".repeat(121)], ["gpt 5"], ["modèl"], [null]])("rejects model %s", (model) => {
    expect(validateRow(row({ model }), now)).toMatch(/^model/);
  });

  it("accepts models with provider prefixes and symbols", () => {
    expect(validateRow(row({ model: "anthropic/claude-opus-5@2026:beta+x" }), now)).toBeNull();
    expect(validateRow(row({ model: "m".repeat(120) }), now)).toBeNull();
  });

  it.each(["input", "output", "cacheRead", "cacheWrite", "reasoning", "messages"])("rejects bad %s", (field) => {
    for (const value of [-1, 1.5, "1", 2 ** 53, null, undefined, Number.NaN]) {
      expect(validateRow(row({ [field]: value }), now)).toMatch(new RegExp(`^${field}`));
    }
  });

  it.each([[Number.NaN], [Infinity], [-0.1], ["1"], [null]])("rejects costUsd %s", (costUsd) => {
    expect(validateRow(row({ costUsd }), now)).toMatch(/^costUsd/);
  });

  it("accepts zero values", () => {
    expect(validateRow(row({ input: 0, output: 0, cacheRead: 0, cacheWrite: 0, reasoning: 0, messages: 0, costUsd: 0 }), now)).toBeNull();
  });

  it.each([[null], ["x"], [[]], [7]])("rejects non-object row %s", (value) => {
    expect(validateRow(value, now)).toBe("row: must be an object");
  });
});

describe("validateUsageBody", () => {
  const body = (overrides = {}) => ({ deviceId: uuid, tokscaleVersion: "4.17.0", rows: [row()], ...overrides });

  it("accepts a valid body", () => {
    expect(validateUsageBody(body(), now)).toBeNull();
  });

  it("accepts 500 rows and rejects 501 or none", () => {
    expect(validateUsageBody(body({ rows: Array.from({ length: 500 }, () => row()) }), now)).toBeNull();
    expect(validateUsageBody(body({ rows: Array.from({ length: 501 }, () => row()) }), now)).toMatch(/^rows/);
    expect(validateUsageBody(body({ rows: [] }), now)).toMatch(/^rows/);
    expect(validateUsageBody(body({ rows: "x" }), now)).toMatch(/^rows/);
  });

  it("reports the index of the first bad row", () => {
    expect(validateUsageBody(body({ rows: [row(), row({ day: "x" }), row({ client: "X" })] }), now)).toBe("rows[1].day: invalid date");
  });

  it("rejects a bad deviceId or tokscaleVersion", () => {
    expect(validateUsageBody(body({ deviceId: "nope" }), now)).toMatch(/^deviceId/);
    expect(validateUsageBody(body({ tokscaleVersion: 4 }), now)).toMatch(/^tokscaleVersion/);
    expect(validateUsageBody(body({ tokscaleVersion: "x".repeat(41) }), now)).toMatch(/^tokscaleVersion/);
  });

  it("allows a missing tokscaleVersion", () => {
    expect(validateUsageBody(body({ tokscaleVersion: undefined }), now)).toBeNull();
  });

  it("rejects non-object bodies", () => {
    expect(validateUsageBody(null, now)).toMatch(/^body/);
    expect(validateUsageBody([], now)).toMatch(/^body/);
  });
});

describe("validateDeviceBody", () => {
  const body = (overrides = {}) => ({ githubToken: "gho_x", deviceId: uuid, deviceName: "Ada's MacBook", ...overrides });

  it("accepts a valid body", () => {
    expect(validateDeviceBody(body())).toBeNull();
  });

  it("rejects bad fields", () => {
    expect(validateDeviceBody(body({ githubToken: "" }))).toMatch(/^githubToken/);
    expect(validateDeviceBody(body({ githubToken: 1 }))).toMatch(/^githubToken/);
    expect(validateDeviceBody(body({ deviceId: "3f2b8c1e-5d4a-1b6f-9a8e-1c2d3e4f5a6b" }))).toMatch(/^deviceId/);
    expect(validateDeviceBody(body({ deviceName: "" }))).toMatch(/^deviceName/);
    expect(validateDeviceBody(body({ deviceName: "   " }))).toMatch(/^deviceName/);
    expect(validateDeviceBody(body({ deviceName: "x".repeat(61) }))).toMatch(/^deviceName/);
    expect(validateDeviceBody(body({ deviceName: 5 }))).toMatch(/^deviceName/);
    expect(validateDeviceBody(null)).toMatch(/^body/);
  });

  it("accepts a 60 char device name", () => {
    expect(validateDeviceBody(body({ deviceName: "x".repeat(60) }))).toBeNull();
  });
});

describe("isUuidV4", () => {
  it("accepts v4 and rejects others", () => {
    expect(isUuidV4(uuid)).toBe(true);
    expect(isUuidV4(uuid.toUpperCase())).toBe(true);
    expect(isUuidV4("3f2b8c1e-5d4a-1b6f-9a8e-1c2d3e4f5a6b")).toBe(false);
    expect(isUuidV4("3f2b8c1e-5d4a-4b6f-7a8e-1c2d3e4f5a6b")).toBe(false);
    expect(isUuidV4(`${uuid}x`)).toBe(false);
  });
});

describe("safeNext", () => {
  it.each([["/app"], ["/app/u/ada"], ["/app?x=1"]])("keeps %s", (next) => {
    expect(safeNext(next)).toBe(next);
  });

  it.each([["//evil.com"], ["/\\evil.com"], ["https://evil.com"], ["app"], [undefined], [""], ["/a\nb"], [`/${"x".repeat(600)}`]])("falls back for %s", (next) => {
    expect(safeNext(next)).toBe("/app");
  });
});
