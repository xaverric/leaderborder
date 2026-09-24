import { describe, expect, it } from "vitest";
import { activityFacts, buildHeatmap, levelFor } from "../../public/js/lib/heatmap.js";

describe("levelFor", () => {
  it("maps zero and negatives to level 0", () => {
    expect(levelFor(0, 100)).toBe(0);
    expect(levelFor(-5, 100)).toBe(0);
  });

  it("buckets into quartiles of the max", () => {
    expect(levelFor(1, 100)).toBe(1);
    expect(levelFor(25, 100)).toBe(1);
    expect(levelFor(26, 100)).toBe(2);
    expect(levelFor(75, 100)).toBe(3);
    expect(levelFor(100, 100)).toBe(4);
  });

  it("returns 0 when max is 0", () => {
    expect(levelFor(5, 0)).toBe(0);
  });
});

describe("buildHeatmap", () => {
  const daily = [
    { day: "2026-09-22", tokens: 100 },
    { day: "2026-09-24", tokens: 400 },
  ];

  it("fills missing days with zero and aligns weeks to Monday", () => {
    const map = buildHeatmap(daily, { end: "2026-09-24", days: 10 });
    expect(map.weeks).toHaveLength(2);
    expect(map.weeks[0][0]).toBeNull();
    expect(map.weeks[0][1]).toEqual({ day: "2026-09-15", value: 0, level: 0 });
    expect(map.weeks[1][1]).toEqual({ day: "2026-09-22", value: 100, level: 1 });
    expect(map.weeks[1][3]).toEqual({ day: "2026-09-24", value: 400, level: 4 });
    expect(map.weeks[1]).toHaveLength(4);
    expect(map.max).toBe(400);
    expect(map.total).toBe(500);
    expect(map.activeDays).toBe(2);
  });

  it("reads a custom key", () => {
    const map = buildHeatmap([{ day: "2026-09-24", costUsd: 3 }], { end: "2026-09-24", days: 1, key: "costUsd" });
    expect(map.weeks.flat().filter(Boolean)).toEqual([{ day: "2026-09-24", value: 3, level: 4 }]);
  });

  it("labels a column when the month of its last day changes", () => {
    expect(buildHeatmap([], { end: "2026-10-25", days: 42 }).months).toEqual([
      { col: 0, label: "Sep" },
      { col: 2, label: "Oct" },
    ]);
  });

  it("drops a leading label that would collide with the next one", () => {
    expect(buildHeatmap([], { end: "2026-10-04", days: 14 }).months).toEqual([{ col: 1, label: "Oct" }]);
  });

  it("ignores rows outside the window", () => {
    const map = buildHeatmap([{ day: "2020-01-01", tokens: 9 }], { end: "2026-09-24", days: 7 });
    expect(map.total).toBe(0);
  });
});

describe("activityFacts", () => {
  it("sums the window, averages over all days and finds the busiest day", () => {
    const daily = [
      { day: "2026-09-20", tokens: 0 },
      { day: "2026-09-22", tokens: 30 },
      { day: "2026-09-23", tokens: 90 },
      { day: "2026-09-24", tokens: 60 },
      { day: "2026-08-01", tokens: 999 },
    ];
    expect(activityFacts(daily, { end: "2026-09-24", days: 6 })).toEqual({
      total: 180,
      days: 6,
      activeDays: 3,
      average: 30,
      busiest: { day: "2026-09-23", value: 90 },
    });
  });

  it("returns no busiest day for an empty window", () => {
    expect(activityFacts([], { end: "2026-09-24", days: 90 })).toEqual({ total: 0, days: 90, activeDays: 0, average: 0, busiest: null });
  });
});
