import { describe, expect, it } from "vitest";
import { createDeviceToken, hashToken, isDeviceTokenFormat } from "../src/tokens.js";

describe("device tokens", () => {
  it("creates lb_ tokens with 43 base64url chars", () => {
    expect(createDeviceToken()).toMatch(/^lb_[A-Za-z0-9_-]{43}$/);
  });

  it("creates unique tokens", () => {
    expect(createDeviceToken()).not.toBe(createDeviceToken());
  });

  it("hashes to stable sha256 hex", async () => {
    const hash = await hashToken("lb_abc");
    expect(hash).toMatch(/^[0-9a-f]{64}$/);
    expect(await hashToken("lb_abc")).toBe(hash);
    expect(await hashToken("abc")).toBe("ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");
  });

  it("checks token format", () => {
    expect(isDeviceTokenFormat(createDeviceToken())).toBe(true);
    expect(isDeviceTokenFormat("lb_short")).toBe(false);
    expect(isDeviceTokenFormat(`xx_${"a".repeat(43)}`)).toBe(false);
    expect(isDeviceTokenFormat(undefined)).toBe(false);
  });
});
