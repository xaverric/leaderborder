import { describe, expect, it } from "vitest";
import { addDays, dayRange, localDay, periodRange } from "../src/periods.js";

const prague = "Europe/Prague";

describe("localDay", () => {
  it("uses the given time zone", () => {
    const instant = new Date("2026-09-30T22:30:00Z");
    expect(localDay(instant, prague)).toBe("2026-10-01");
    expect(localDay(instant, "UTC")).toBe("2026-09-30");
    expect(localDay(instant, "America/Los_Angeles")).toBe("2026-09-30");
  });

  it("handles winter offset", () => {
    expect(localDay(new Date("2026-12-31T23:30:00Z"), prague)).toBe("2027-01-01");
    expect(localDay(new Date("2026-12-31T22:59:00Z"), prague)).toBe("2026-12-31");
  });
});

describe("addDays", () => {
  it("crosses month, leap and year boundaries", () => {
    expect(addDays("2026-03-02", -6)).toBe("2026-02-24");
    expect(addDays("2028-03-01", -1)).toBe("2028-02-29");
    expect(addDays("2027-01-03", -6)).toBe("2026-12-28");
    expect(addDays("2026-12-31", 1)).toBe("2027-01-01");
  });
});

describe("periodRange", () => {
  it("computes day, week, month in the leaderboard zone", () => {
    const now = new Date("2026-09-30T22:30:00Z");
    expect(periodRange("day", now, prague)).toEqual({ start: "2026-10-01", end: "2026-10-01" });
    expect(periodRange("week", now, prague)).toEqual({ start: "2026-09-25", end: "2026-10-01" });
    expect(periodRange("month", now, prague)).toEqual({ start: "2026-10-01", end: "2026-10-01" });
    expect(periodRange("month", now, "UTC")).toEqual({ start: "2026-09-01", end: "2026-09-30" });
    expect(periodRange("week", now, "UTC")).toEqual({ start: "2026-09-24", end: "2026-09-30" });
  });

  it("crosses a month boundary for week", () => {
    expect(periodRange("week", new Date("2026-03-02T10:00:00Z"), prague)).toEqual({ start: "2026-02-24", end: "2026-03-02" });
    expect(periodRange("week", new Date("2028-03-01T10:00:00Z"), prague)).toEqual({ start: "2028-02-24", end: "2028-03-01" });
  });

  it("returns an open start for all", () => {
    expect(periodRange("all", new Date("2026-09-24T10:00:00Z"), prague)).toEqual({ start: null, end: "2026-09-24" });
  });
});

describe("dayRange", () => {
  it("lists inclusive days", () => {
    expect(dayRange("2026-02-27", "2026-03-02")).toEqual(["2026-02-27", "2026-02-28", "2026-03-01", "2026-03-02"]);
    expect(dayRange("2026-03-02", "2026-03-02")).toEqual(["2026-03-02"]);
    expect(dayRange("2026-03-03", "2026-03-02")).toEqual([]);
  });
});
