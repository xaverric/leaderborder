import { test } from "node:test";
import assert from "node:assert/strict";
import { defaultDeviceName, parseDeviceName, MAX_NAME_LENGTH } from "../../src/core/device.js";

test("defaultDeviceName is a generic name with the CPU architecture", () => {
  assert.equal(defaultDeviceName({ arch: "arm64" }), "Mac (arm64)");
  assert.equal(defaultDeviceName({ arch: "x64" }), "Mac (x64)");
  assert.equal(defaultDeviceName(), `Mac (${process.arch})`);
});

test("parseDeviceName trims and accepts printable names up to the limit", () => {
  assert.equal(parseDeviceName("  Work Mac  "), "Work Mac");
  assert.equal(parseDeviceName("Octo's MacBook Pro"), "Octo's MacBook Pro");
  assert.equal(parseDeviceName("Praha kancelář"), "Praha kancelář");
  assert.equal(parseDeviceName("x".repeat(MAX_NAME_LENGTH)), "x".repeat(MAX_NAME_LENGTH));
});

test("parseDeviceName rejects empty, too long and non-printable names", () => {
  assert.equal(parseDeviceName(""), null);
  assert.equal(parseDeviceName("   "), null);
  assert.equal(parseDeviceName(undefined), null);
  assert.equal(parseDeviceName(null), null);
  assert.equal(parseDeviceName("x".repeat(MAX_NAME_LENGTH + 1)), null);
  assert.equal(parseDeviceName("Mac\u001b[31m"), null);
  assert.equal(parseDeviceName("Mac\nMac"), null);
  assert.equal(parseDeviceName("Mac​Mac"), null);
});
