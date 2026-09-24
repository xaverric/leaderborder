import { test } from "node:test";
import assert from "node:assert/strict";
import { computerName } from "../../src/core/device.js";

const execFileReturning = (error, stdout, calls = []) => (file, args, options, callback) => {
  calls.push({ file, args });
  callback(error, stdout, "");
};

test("computerName uses scutil ComputerName", async () => {
  const calls = [];
  assert.equal(await computerName({ execFile: execFileReturning(null, "Octo's MacBook\n", calls), hostname: () => "h" }), "Octo's MacBook");
  assert.deepEqual(calls[0], { file: "scutil", args: ["--get", "ComputerName"] });
});

test("computerName falls back to hostname", async () => {
  assert.equal(await computerName({ execFile: execFileReturning(new Error("x"), ""), hostname: () => "octo.local" }), "octo.local");
  assert.equal(await computerName({ execFile: execFileReturning(null, "  \n"), hostname: () => "octo.local" }), "octo.local");
});

test("computerName falls back to Mac when nothing is known", async () => {
  assert.equal(await computerName({ execFile: execFileReturning(new Error("x"), ""), hostname: () => "" }), "Mac");
});

test("computerName caps the name at 60 characters", async () => {
  const name = await computerName({ execFile: execFileReturning(null, "x".repeat(80)), hostname: () => "h" });
  assert.equal(name.length, 60);
});
