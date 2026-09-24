import { test } from "node:test";
import assert from "node:assert/strict";
import { POPOVER_SIZE, popoverPosition, shouldShowOnClick } from "../../src/app/position.js";

const workArea = { x: 0, y: 25, width: 1512, height: 920 };
const windowSize = { width: 360, height: 520 };

test("popover size", () => {
  assert.deepEqual(POPOVER_SIZE, { width: 360, height: 520 });
});

test("centres under the tray icon", () => {
  const trayBounds = { x: 1000, y: 0, width: 24, height: 24 };
  assert.deepEqual(popoverPosition({ trayBounds, windowSize, workArea }), { x: 832, y: 30 });
});

test("clamps to the right edge", () => {
  const trayBounds = { x: 1490, y: 0, width: 22, height: 24 };
  assert.deepEqual(popoverPosition({ trayBounds, windowSize, workArea }), { x: 1144, y: 30 });
});

test("clamps to the left edge", () => {
  const trayBounds = { x: 10, y: 0, width: 22, height: 24 };
  assert.deepEqual(popoverPosition({ trayBounds, windowSize, workArea }), { x: 8, y: 30 });
});

test("falls back to the top-right corner without tray bounds", () => {
  const trayBounds = { x: 0, y: 0, width: 0, height: 0 };
  assert.deepEqual(popoverPosition({ trayBounds, windowSize, workArea }), { x: 1144, y: 33 });
});

test("rounds fractional coordinates", () => {
  const trayBounds = { x: 1000.5, y: 0, width: 23, height: 24.5 };
  const { x, y } = popoverPosition({ trayBounds, windowSize, workArea });
  assert.ok(Number.isInteger(x) && Number.isInteger(y));
});

test("shouldShowOnClick ignores the click that caused the blur", () => {
  assert.equal(shouldShowOnClick({ visible: true, lastHiddenAt: 0, now: 1000 }), false);
  assert.equal(shouldShowOnClick({ visible: false, lastHiddenAt: 900, now: 1000 }), false);
  assert.equal(shouldShowOnClick({ visible: false, lastHiddenAt: 500, now: 1000 }), true);
  assert.equal(shouldShowOnClick({ visible: false, lastHiddenAt: null, now: 1000 }), true);
});
