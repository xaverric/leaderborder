import { describe, expect, it } from "vitest";
import { DEFAULT_FILTERS, filtersFromSearch, leaderboardQuery } from "../../public/js/lib/query.js";

describe("filtersFromSearch", () => {
  it("reads valid filters", () => {
    expect(filtersFromSearch("?period=month&metric=cost&client=codex")).toEqual({
      period: "month",
      metric: "cost",
      client: "codex",
      model: "",
    });
  });

  it("falls back to defaults for invalid values", () => {
    expect(filtersFromSearch("?period=year&metric=vibes&client=<x>")).toEqual(DEFAULT_FILTERS);
    expect(DEFAULT_FILTERS).toEqual({ period: "week", metric: "tokens", client: "", model: "" });
  });
});

describe("leaderboardQuery", () => {
  it("serialises filters and omits empty ones", () => {
    expect(leaderboardQuery({ period: "month", metric: "cost", client: "codex", model: "" })).toBe(
      "period=month&metric=cost&client=codex",
    );
    expect(leaderboardQuery({ period: "week", metric: "tokens", client: "", model: "claude-opus-5" })).toBe(
      "period=week&metric=tokens&model=claude-opus-5",
    );
  });
});
