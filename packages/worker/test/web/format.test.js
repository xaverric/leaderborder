import { describe, expect, it } from "vitest";
import {
  compactParts,
  formatCompact,
  formatDay,
  formatDecimal,
  formatDuration,
  formatInteger,
  formatMetric,
  formatRange,
  formatUsd,
  relativeTime,
} from "../../public/js/lib/format.js";

describe("formatCompact", () => {
  it.each([
    [1_234_567_890, "1.2B"],
    [340_000_000, "340M"],
    [12_400, "12.4K"],
    [812, "812"],
    [0, "0"],
    [999_950, "1M"],
    [1_500_000_000_000, "1.5T"],
    [10_050_000_000, "10.1B"],
    [-2500, "-2.5K"],
  ])("%s -> %s", (input, expected) => {
    expect(formatCompact(input)).toBe(expected);
  });

  it("returns a dash for non-finite input", () => {
    expect(formatCompact(Number.NaN)).toBe("-");
    expect(formatCompact(undefined)).toBe("-");
  });
});

describe("formatUsd", () => {
  it("rounds large amounts to whole dollars", () => {
    expect(formatUsd(1234.5)).toBe("$1,235");
  });

  it("keeps cents below 100", () => {
    expect(formatUsd(12.4)).toBe("$12.40");
    expect(formatUsd(0.004)).toBe("$0.00");
  });

  it("returns a dash for non-finite input", () => {
    expect(formatUsd(null)).toBe("-");
  });
});

describe("formatMetric", () => {
  it("uses dollars for cost and compact numbers otherwise", () => {
    expect(formatMetric("cost", 42)).toBe("$42.00");
    expect(formatMetric("tokens", 42_000)).toBe("42K");
    expect(formatMetric("tokens_nocache", 1_000_000)).toBe("1M");
    expect(formatMetric("prompts", 1234)).toBe("1.2K");
  });

  it("uses durations for model time", () => {
    expect(formatMetric("model_time", 5_400_000)).toBe("1h 30m");
  });
});

describe("formatDuration", () => {
  it.each([
    [0, "0s"],
    [42_400, "42s"],
    [59_600, "1m"],
    [754_000, "13m"],
    [3_600_000, "1h"],
    [12_000_000, "3h 20m"],
    [187_800_000, "52h 10m"],
    [370_000_000, "102h"],
  ])("%s ms -> %s", (ms, expected) => {
    expect(formatDuration(ms)).toBe(expected);
  });

  it("returns a dash when time was not measured", () => {
    expect(formatDuration(null)).toBe("-");
    expect(formatDuration(undefined)).toBe("-");
    expect(formatDuration(-1)).toBe("-");
  });
});

describe("formatDecimal", () => {
  it("keeps one decimal", () => {
    expect(formatDecimal(4.25)).toBe("4.3");
    expect(formatDecimal(6)).toBe("6");
    expect(formatDecimal(null)).toBe("-");
  });
});

describe("formatInteger", () => {
  it("groups thousands", () => {
    expect(formatInteger(1234567)).toBe("1,234,567");
  });
});

describe("formatDay and formatRange", () => {
  it("formats a calendar day", () => {
    expect(formatDay("2026-09-24")).toBe("Sep 24, 2026");
  });

  it("formats a range without the year", () => {
    expect(formatRange({ start: "2026-09-18", end: "2026-09-24" })).toBe("Sep 18 - Sep 24");
  });

  it("collapses a single-day range", () => {
    expect(formatRange({ start: "2026-09-24", end: "2026-09-24" })).toBe("Sep 24");
  });
});

describe("relativeTime", () => {
  const now = new Date("2026-09-24T12:00:00Z");

  it.each([
    ["2026-09-24T11:59:40Z", "just now"],
    ["2026-09-24T11:55:00Z", "5 min ago"],
    ["2026-09-24T09:00:00Z", "3 h ago"],
    ["2026-09-22T12:00:00Z", "2 d ago"],
    [null, "never"],
  ])("%s -> %s", (iso, expected) => {
    expect(relativeTime(iso, now)).toBe(expected);
  });
});

describe("compactParts", () => {
  it("splits a compact number into value and suffix", () => {
    expect(compactParts(12_403_118_220)).toEqual({ sign: "", value: 12.4, suffix: "B", divisor: 1e9, decimals: 1 });
    expect(compactParts(340_000_000)).toEqual({ sign: "", value: 340, suffix: "M", divisor: 1e6, decimals: 0 });
    expect(compactParts(999_950)).toEqual({ sign: "", value: 1, suffix: "M", divisor: 1e6, decimals: 0 });
    expect(compactParts(42)).toEqual({ sign: "", value: 42, suffix: "", divisor: 1, decimals: 0 });
    expect(compactParts(Number.NaN)).toBeNull();
  });
});
