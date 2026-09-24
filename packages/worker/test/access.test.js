import { describe, expect, it } from "vitest";
import { githubScope, isAllowed, needsOrgs, parseList } from "../src/access.js";

const env = (orgs = "", logins = "") => ({ ALLOWED_GITHUB_ORGS: orgs, ALLOWED_GITHUB_LOGINS: logins });

describe("parseList", () => {
  it("splits, trims, lowercases and drops empties", () => {
    expect(parseList(" Acme, ,unicorn ,")).toEqual(["acme", "unicorn"]);
    expect(parseList("")).toEqual([]);
    expect(parseList(undefined)).toEqual([]);
  });
});

describe("isAllowed", () => {
  it("denies everyone when both lists are empty unless PUBLIC_ACCESS is set", () => {
    expect(isAllowed({ login: "anyone", orgs: [] }, env())).toBe(false);
    expect(isAllowed({ login: "anyone", orgs: [] }, { ...env(), PUBLIC_ACCESS: "1" })).toBe(true);
    expect(isAllowed({ login: "anyone", orgs: [] }, { ...env(), PUBLIC_ACCESS: "yes" })).toBe(false);
  });

  it("requests read:org only when organizations are configured", () => {
    expect(githubScope(env("acme"))).toBe("read:org");
    expect(githubScope(env("", "ada"))).toBe("");
  });

  it("matches logins case-insensitively", () => {
    expect(isAllowed({ login: "Ada", orgs: [] }, env("", "ada,linus"))).toBe(true);
    expect(isAllowed({ login: "grace", orgs: [] }, env("", "ada,linus"))).toBe(false);
  });

  it("matches org membership", () => {
    expect(isAllowed({ login: "grace", orgs: ["Acme"] }, env("acme"))).toBe(true);
    expect(isAllowed({ login: "grace", orgs: ["other"] }, env("acme"))).toBe(false);
    expect(isAllowed({ login: "grace", orgs: [] }, env("acme"))).toBe(false);
  });

  it("allows login or org when both lists are set", () => {
    const both = env("acme", "ada");
    expect(isAllowed({ login: "ada", orgs: [] }, both)).toBe(true);
    expect(isAllowed({ login: "ken", orgs: ["acme"] }, both)).toBe(true);
    expect(isAllowed({ login: "ken", orgs: ["x"] }, both)).toBe(false);
  });
});

describe("needsOrgs", () => {
  it("is true only when orgs are configured", () => {
    expect(needsOrgs(env("acme"))).toBe(true);
    expect(needsOrgs(env("", "ada"))).toBe(false);
  });
});
