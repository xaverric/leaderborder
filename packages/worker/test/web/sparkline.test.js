import { describe, expect, it } from "vitest";
import { sparklinePath } from "../../public/js/lib/sparkline.js";

describe("sparklinePath", () => {
  it("scales values into the padded box", () => {
    expect(sparklinePath([0, 10, 5], { width: 100, height: 20, pad: 2 })).toBe("M2 18L50 2L98 10");
  });

  it("draws a flat baseline when all values are zero", () => {
    expect(sparklinePath([0, 0], { width: 10, height: 10, pad: 1 })).toBe("M1 9L9 9");
  });

  it("draws a horizontal line for a single value", () => {
    expect(sparklinePath([5], { width: 10, height: 10, pad: 1 })).toBe("M1 1L9 1");
  });

  it("returns an empty path without values", () => {
    expect(sparklinePath([], { width: 10, height: 10 })).toBe("");
  });
});
