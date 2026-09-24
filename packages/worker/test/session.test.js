import { describe, expect, it } from "vitest";
import { parseCookies, serializeCookie } from "../src/cookies.js";
import { signValue, verifyValue } from "../src/session.js";

const secret = "s3cret-0123456789abcdef0123456789abcdef";

const flip = (s, i) => s.slice(0, i) + (s[i] === "A" ? "B" : "A") + s.slice(i + 1);

describe("signValue / verifyValue", () => {
  it("roundtrips a payload", async () => {
    const signed = await signValue({ uid: 7, exp: 2000 }, secret);
    expect(await verifyValue(signed, secret, 1000)).toEqual({ uid: 7, exp: 2000 });
  });

  it("rejects a tampered payload", async () => {
    const signed = await signValue({ uid: 7, exp: 2000 }, secret);
    expect(await verifyValue(flip(signed, 2), secret, 1000)).toBeNull();
  });

  it("rejects a forged payload with the original signature", async () => {
    const signed = await signValue({ uid: 7, exp: 2000 }, secret);
    const forged = btoa(JSON.stringify({ uid: 1, exp: 2000 })).replace(/=+$/, "");
    expect(await verifyValue(`${forged}.${signed.split(".")[1]}`, secret, 1000)).toBeNull();
  });

  it("rejects a tampered signature", async () => {
    const signed = await signValue({ uid: 7, exp: 2000 }, secret);
    expect(await verifyValue(flip(signed, signed.length - 3), secret, 1000)).toBeNull();
  });

  it("rejects a different secret", async () => {
    const signed = await signValue({ uid: 7, exp: 2000 }, secret);
    expect(await verifyValue(signed, "other-secret-0123456789abcdef01234567", 1000)).toBeNull();
  });

  it("rejects an expired payload", async () => {
    const signed = await signValue({ uid: 7, exp: 2000 }, secret);
    expect(await verifyValue(signed, secret, 2000)).toBeNull();
  });

  it.each(["", "a", "a.b.c", ".", "!!!.???", undefined, null])("rejects garbage %s", async (value) => {
    expect(await verifyValue(value, secret, 0)).toBeNull();
  });

  it("rejects a missing secret", async () => {
    await expect(signValue({ exp: 1 }, "")).rejects.toThrow();
    expect(await verifyValue("a.b", "", 0)).toBeNull();
  });
});

describe("cookies", () => {
  it("parses a cookie header", () => {
    expect(parseCookies("a=1; lb_session=x.y=; b = 2")).toEqual({ a: "1", lb_session: "x.y=", b: "2" });
  });

  it("parses empty or missing headers", () => {
    expect(parseCookies(null)).toEqual({});
    expect(parseCookies("")).toEqual({});
  });

  it("serializes attributes in a stable order", () => {
    expect(serializeCookie("lb_session", "v", { maxAge: 10, path: "/", httpOnly: true, secure: true, sameSite: "Lax" })).toBe(
      "lb_session=v; Path=/; Max-Age=10; HttpOnly; Secure; SameSite=Lax",
    );
  });

  it("omits Secure when disabled", () => {
    expect(serializeCookie("a", "", { maxAge: 0, path: "/auth", httpOnly: true, secure: false, sameSite: "Lax" })).toBe(
      "a=; Path=/auth; Max-Age=0; HttpOnly; SameSite=Lax",
    );
  });
});
