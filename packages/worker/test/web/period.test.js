import { describe, expect, it } from "vitest";
import { METRICS, PERIODS, metricKey, metricLabel, periodLabel } from "../../public/js/lib/period.js";

describe("period helpers", () => {
  it("lists periods and metrics in display order", () => {
    expect(PERIODS).toEqual(["day", "week", "month", "all"]);
    expect(METRICS).toEqual(["tokens", "tokens_nocache", "cost"]);
  });

  it.each([
    ["day", "Today"],
    ["week", "Last 7 days"],
    ["month", "This month"],
    ["all", "All time"],
  ])("labels %s", (period, label) => {
    expect(periodLabel(period)).toBe(label);
  });

  it("labels metrics", () => {
    expect(metricLabel("tokens")).toBe("Tokens");
    expect(metricLabel("tokens_nocache")).toBe("Tokens without cache");
    expect(metricLabel("cost")).toBe("Cost");
  });

  it("maps metrics to response keys", () => {
    expect(metricKey("tokens")).toBe("tokens");
    expect(metricKey("tokens_nocache")).toBe("tokensNoCache");
    expect(metricKey("cost")).toBe("costUsd");
  });
});
