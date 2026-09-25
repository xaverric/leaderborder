import { describe, expect, it } from "vitest";
import { DEFAULT_FILTERS, filtersFromSearch, leaderboardQuery, userFiltersFromSearch, userQuery } from "../../public/js/lib/query.js";

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

describe("user page filters", () => {
  const today = "2026-09-24";
  const spans = [1, 7, 30, 365];
  const defaults = { end: today, span: 7, metric: "tokens", client: "", model: "" };

  it("reads a day, window, metric and filters", () => {
    expect(userFiltersFromSearch("?day=2026-09-10&span=1&metric=model_time&client=claude&model=claude-opus-5", { today, spans })).toEqual({
      end: "2026-09-10",
      span: 1,
      metric: "model_time",
      client: "claude",
      model: "claude-opus-5",
    });
  });

  it("falls back for future, too old or malformed values", () => {
    expect(userFiltersFromSearch("?day=2026-09-25&span=3&metric=vibes&client=<x>", { today, spans })).toEqual(defaults);
    expect(userFiltersFromSearch("?day=2025-09-24", { today, spans }).end).toBe(today);
    expect(userFiltersFromSearch("?day=2025-09-25", { today, spans }).end).toBe("2025-09-25");
    expect(userFiltersFromSearch("?day=24.9.2026", { today, spans }).end).toBe(today);
  });

  it("serialises only what differs from the defaults", () => {
    expect(userQuery(defaults, today)).toBe("");
    expect(userQuery({ ...defaults, end: "2026-09-10", span: 1, metric: "prompts", client: "codex" }, today)).toBe("day=2026-09-10&span=1&metric=prompts&client=codex");
  });
});
