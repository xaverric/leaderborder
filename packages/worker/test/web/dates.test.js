import { describe, expect, it } from "vitest";
import { addDays, dayRange, isoDay, weekdayIndex } from "../../public/js/lib/dates.js";

describe("dates", () => {
  it("formats a local date as YYYY-MM-DD", () => {
    expect(isoDay(new Date(2026, 8, 4, 23, 30))).toBe("2026-09-04");
  });

  it("adds days across month and leap boundaries", () => {
    expect(addDays("2026-03-01", -1)).toBe("2026-02-28");
    expect(addDays("2028-02-28", 1)).toBe("2028-02-29");
    expect(addDays("2026-12-31", 1)).toBe("2027-01-01");
  });

  it("builds an inclusive range ending at a day", () => {
    expect(dayRange("2026-09-24", 3)).toEqual(["2026-09-22", "2026-09-23", "2026-09-24"]);
  });

  it("returns Monday-based weekday indexes", () => {
    expect(weekdayIndex("2026-09-21")).toBe(0);
    expect(weekdayIndex("2026-09-27")).toBe(6);
  });
});
