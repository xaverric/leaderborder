import { describe, expect, it } from "vitest";
import { parseRoute, routeHref, routeMode } from "../../public/js/lib/route.js";

describe("parseRoute", () => {
  it.each([
    ["/app", "", { name: "leaderboard" }],
    ["/app/", "", { name: "leaderboard" }],
    ["/app/u/ada", "", { name: "user", login: "ada" }],
    ["/app/u/ada-lovelace/", "", { name: "user", login: "ada-lovelace" }],
    ["/app/devices", "", { name: "devices" }],
    ["/app/nope", "", { name: "not_found" }],
    ["/app/u/bad%20login", "", { name: "not_found" }],
    ["/app.html", "", { name: "leaderboard" }],
    ["/app.html", "#/", { name: "leaderboard" }],
    ["/app.html", "#/u/grace", { name: "user", login: "grace" }],
    ["/app.html", "#/devices", { name: "devices" }],
    ["/app.html", "#/u/", { name: "not_found" }],
  ])("%s %s", (pathname, hash, expected) => {
    expect(parseRoute(pathname, hash)).toEqual(expected);
  });
});

describe("routeMode", () => {
  it("uses hash routing on the static file and path routing under /app", () => {
    expect(routeMode("/app.html")).toBe("hash");
    expect(routeMode("/")).toBe("hash");
    expect(routeMode("/app")).toBe("path");
    expect(routeMode("/app/u/ada")).toBe("path");
  });
});

describe("routeHref", () => {
  it("builds path hrefs", () => {
    expect(routeHref({ name: "leaderboard" }, "path")).toBe("/app");
    expect(routeHref({ name: "user", login: "ada" }, "path")).toBe("/app/u/ada");
    expect(routeHref({ name: "devices" }, "path")).toBe("/app/devices");
  });

  it("builds hash hrefs", () => {
    expect(routeHref({ name: "leaderboard" }, "hash")).toBe("#/");
    expect(routeHref({ name: "user", login: "ada" }, "hash")).toBe("#/u/ada");
    expect(routeHref({ name: "devices" }, "hash")).toBe("#/devices");
  });
});
