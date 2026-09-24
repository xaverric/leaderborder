import { describe, expect, it } from "vitest";
import { githubProfileUrl } from "../../public/js/lib/github.js";

describe("githubProfileUrl", () => {
  it("links valid GitHub logins to their profile", () => {
    expect(githubProfileUrl("ada")).toBe("https://github.com/ada");
    expect(githubProfileUrl("ada-lovelace")).toBe("https://github.com/ada-lovelace");
  });

  it("returns null for anything that is not a GitHub login", () => {
    expect(githubProfileUrl("ada#42")).toBeNull();
    expect(githubProfileUrl("-ada")).toBeNull();
    expect(githubProfileUrl("ada-")).toBeNull();
    expect(githubProfileUrl("a/b")).toBeNull();
    expect(githubProfileUrl("")).toBeNull();
    expect(githubProfileUrl(undefined)).toBeNull();
    expect(githubProfileUrl("x".repeat(40))).toBeNull();
  });
});
